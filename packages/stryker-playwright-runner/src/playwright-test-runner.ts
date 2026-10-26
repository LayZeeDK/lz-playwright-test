import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import {
  INSTRUMENTER_CONSTANTS,
  type StrykerOptions,
} from '@stryker-mutator/api/core';
import type { Logger } from '@stryker-mutator/api/logging';
import { commonTokens, tokens } from '@stryker-mutator/api/plugin';
import {
  determineHitLimitReached,
  type DryRunOptions,
  type DryRunResult,
  DryRunStatus,
  type MutantRunOptions,
  type MutantRunResult,
  type TestRunner as StrykerTestRunner,
  toMutantRunResult,
} from '@stryker-mutator/api/test-runner';

import {
  type CommonModule,
  type CoreBundleModule,
  type RunnerModule,
  TEST_RUNNER_METHODS,
  type TestRunner,
} from './playwright-internals.ts';
import {
  FRAME_READ_TIMEOUT_MS,
  RUN_SETTINGS,
  type RunSettings,
  SNAPSHOT_SUFFIX,
  type Snapshot,
} from './protocol.ts';
import {
  CollectingReporter,
  isHitCount,
  listSerialGroups,
  mergeCoverage,
  missingCoverageError,
  projectsThatRun,
  type RunOutput,
  type RunRequest,
  type RunResult,
  toRunResult,
  withSerialGroups,
} from './run-result.ts';

export interface PlaywrightRunnerOptions {
  configFile?: string;
  projects?: string[];
  workers?: number;
}

interface ServerCheck {
  name: string;
  isUp(): Promise<boolean>;
}

type IsUrlAvailable = CoreBundleModule['utils']['isURLAvailable'];

// `.ts` when this module runs from source, `.js` when it runs from the build.
const HOOK = new URL(`./worker-hook${path.extname(import.meta.filename)}`, import.meta.url).href;
const MIN_PLAYWRIGHT = { major: 1, minor: 63 };
// Config load and worker start before the first test, measured at about 2.7 s.
const RUN_START_MS = 3000;
// Leaves room to end a timed-out test before Stryker's own timer kills the worker: the run's start,
// the hook's read of the hung page, and the context close (the last few hundred ms).
const TIMEOUT_HEADROOM_MS = RUN_START_MS + FRAME_READ_TIMEOUT_MS;
// Below this, real tests cannot finish, so Stryker's own timer ends the run instead.
const MIN_TEST_TIMEOUT_MS = 2000;

/**
 * Hosts Playwright Test in-process through `playwright/lib/runner` (exported, undocumented), so it
 * pins a minimum Playwright version and probes the internals it calls.
 */
export class PlaywrightTestRunner implements StrykerTestRunner {
  static inject = tokens(commonTokens.options, commonTokens.logger);

  private readonly options: PlaywrightRunnerOptions;
  private readonly testFiles: string[] | undefined;
  private readonly timeoutMS: number;
  private readonly log: Logger;
  private readonly baseNodeOptions = process.env.NODE_OPTIONS;
  private playwright?: TestRunner;
  private rootDir?: string;
  private outputDir?: string;
  private runsDir?: string;
  private servers: ServerCheck[] = [];
  private serialGroups = new Map<string, string[]>();
  private configTestTimeout = Infinity;
  private runCounter = 0;

  constructor(options: StrykerOptions, log: Logger) {
    this.options =
      (options as StrykerOptions & { playwright?: PlaywrightRunnerOptions })
        .playwright ?? {};
    this.testFiles = options.testFiles;
    this.timeoutMS = options.timeoutMS;
    this.log = log;
  }

  capabilities() {
    return { reloadEnvironment: true };
  }

  async init(): Promise<void> {
    if (this.testFiles?.length) {
      throw new Error(
        'The Playwright test runner does not support the --testFiles option.',
      );
    }

    const configFile = this.options.configFile
      ? path.resolve(this.options.configFile)
      : undefined;
    const testRequire = createRequire(
      createRequire(configFile ?? path.resolve('package.json')).resolve(
        '@playwright/test',
      ),
    );
    // playwright-core is a dependency of playwright, not of @playwright/test, so resolve it from
    // playwright for layouts that do not hoist (pnpm).
    const playwrightRequire = createRequire(
      testRequire.resolve('playwright/package.json'),
    );
    const { version } = playwrightRequire('./package.json') as {
      version: string;
    };
    const [major, minor] = version.split('.').map(Number);
    const supported =
      major > MIN_PLAYWRIGHT.major ||
      (major === MIN_PLAYWRIGHT.major && minor >= MIN_PLAYWRIGHT.minor);

    if (!supported) {
      throw new Error(
        `The Playwright test runner needs Playwright ${MIN_PLAYWRIGHT.major}.${MIN_PLAYWRIGHT.minor} or later, found ${version}.`,
      );
    }

    const { testRunner } = playwrightRequire(
      'playwright/lib/runner',
    ) as Partial<RunnerModule>;
    const { configLoader } = playwrightRequire(
      'playwright/lib/common',
    ) as Partial<CommonModule>;
    const { utils } = playwrightRequire(
      'playwright-core/lib/coreBundle',
    ) as Partial<CoreBundleModule>;
    const isURLAvailable = utils?.isURLAvailable;

    const prototype = testRunner?.TestRunner?.prototype;

    if (
      typeof testRunner?.TestRunner !== 'function' ||
      TEST_RUNNER_METHODS.some(
        (method) => typeof prototype?.[method] !== 'function',
      ) ||
      typeof configLoader?.resolveConfigLocation !== 'function' ||
      typeof isURLAvailable !== 'function'
    ) {
      throw new Error(
        `Playwright ${version} changed the internals this runner calls (playwright/lib/runner TestRunner with ${TEST_RUNNER_METHODS.join(', ')}; playwright/lib/common configLoader; playwright-core coreBundle isURLAvailable).`,
      );
    }

    // Playwright deletes and recreates outputDir on global setup, so both directories live in a private
    // root that it never touches: on a shared /tmp no other user can claim either name in between.
    this.rootDir = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        `stryker-pw-${process.env.STRYKER_MUTATOR_WORKER ?? 0}-`,
      ),
    );
    this.outputDir = path.join(this.rootDir, 'output');
    this.runsDir = path.join(this.rootDir, 'runs');
    fs.mkdirSync(this.runsDir);
    this.playwright = new testRunner.TestRunner(
      configLoader.resolveConfigLocation(configFile),
      {
        outputDir: this.outputDir,
        use: { screenshot: 'off', trace: 'off', video: 'off' },
      },
    );
    await this.playwright.initialize({});

    const config = await this.playwright.loadConfig();
    this.servers = config.webServers.flatMap((server) =>
      serverCheck(server, isURLAvailable),
    );
    this.warnAboutAssertionTimeouts(config);
    // Every project, setup dependencies included: the one timeout override applies to all that run.
    const timeouts = config.projects.map(({ project }) => project.timeout);
    this.configTestTimeout =
      timeouts.length === 0 || timeouts.includes(0)
        ? Infinity
        : Math.max(...timeouts);
    await this.runGlobalSetup(this.playwright);
    // Every Stryker test runner process needs the groups, and only one of them runs the dry run. Listed
    // after global setup, like Playwright's own CLI, because test files may read what it creates.
    this.serialGroups = await listSerialGroups(
      this.playwright,
      projectsThatRun(this.options.projects, config.projects),
    );
  }

  private warnAboutAssertionTimeouts(
    config: Awaited<ReturnType<TestRunner['loadConfig']>>,
  ) {
    // A killed test fails only after its auto-waiting assertion gives up, but Stryker sizes its timeout
    // from passing tests, so a short timeoutMS turns kills into timeouts.
    const expectTimeout = Math.max(
      ...config.projects.map((project) => project.expect?.timeout ?? 5000),
    );

    if (this.timeoutMS < expectTimeout * 2) {
      this.log.warn(
        `timeoutMS (${this.timeoutMS}) is below twice the Playwright expect timeout (${expectTimeout}); killed mutants may be reported as timeouts. Set timeoutMS to at least ${expectTimeout * 2}.`,
      );
    }
  }

  async dispose(): Promise<void> {
    // Stryker disposes a timed-out runner while its run is still going, and kills it 2 s later, so
    // the run's directories go first: the run's own cleanup never comes. The root stays until the
    // workers are gone, because the test that stopTests ends still writes its error context.
    removeDirs([this.runsDir, this.outputDir]);
    await this.playwright?.stopTests();
    await this.playwright?.runGlobalTeardown();
    removeDirs([this.rootDir]);
  }

  async dryRun({
    disableBail,
    coverageAnalysis,
  }: DryRunOptions): Promise<DryRunResult> {
    const run = await this.run({ disableBail, coverageAnalysis });

    if (run.status !== DryRunStatus.Complete) {
      return run;
    }

    const { tests, snapshots } = run;
    const errorMessage = missingCoverageError(tests, snapshots);

    if (errorMessage) {
      return { status: DryRunStatus.Error, errorMessage };
    }

    if (coverageAnalysis === 'off') {
      return { status: run.status, tests };
    }

    this.reportCoverageGaps(snapshots);

    return {
      status: run.status,
      tests,
      mutantCoverage: mergeCoverage(snapshots),
    };
  }

  private reportCoverageGaps(snapshots: Snapshot[]) {
    const lost = snapshots.filter((snapshot) => snapshot.lost).length;
    const shared = snapshots.filter(
      (snapshot) => snapshot.outlivedItsTest && snapshot.mutantCoverage,
    ).length;

    if (lost > 0) {
      this.log.warn(
        `${lost} frame(s) did not answer before their context closed; their coverage is missing, so mutants only they reached show as NoCoverage.`,
      );
    }

    if (shared > 0) {
      this.log.info(
        `${shared} frame(s) belonged to contexts that outlived their test (beforeAll or worker fixtures); their coverage counts as static, so every test runs for those mutants.`,
      );
    }
  }

  async mutantRun({
    activeMutant,
    testFilter,
    hitLimit,
    disableBail,
    timeout,
  }: MutantRunOptions): Promise<MutantRunResult> {
    const testTimeout = Math.max(
      timeout - TIMEOUT_HEADROOM_MS,
      MIN_TEST_TIMEOUT_MS,
    );
    const run = await this.run({
      activeMutant: activeMutant.id,
      testFilter: withSerialGroups(testFilter, this.serialGroups),
      hitLimit,
      disableBail,
      testTimeout: Math.min(testTimeout, this.configTestTimeout),
    });
    const hitCount =
      run.status === DryRunStatus.Complete
        ? run.snapshots.reduce(
            (sum, { hitCount }) => sum + (isHitCount(hitCount) ? hitCount : 0),
            0,
          )
        : undefined;
    this.log.debug(
      `Mutant ${activeMutant.id}: ${run.status}, hitCount ${hitCount}/${hitLimit}`,
    );

    return toMutantRunResult(
      determineHitLimitReached(hitCount, hitLimit) ?? run,
    );
  }

  private async run(request: RunRequest): Promise<RunResult> {
    const playwright = this.playwright!;
    await this.restartDeadServers(playwright);
    let output = await this.runOnce(playwright, request);

    // A server that died during this run fails its tests for a reason the mutant did not cause.
    if (
      output.reporter.anyAttemptFailed() &&
      (await this.restartDeadServers(playwright))
    ) {
      output = await this.runOnce(playwright, request);
    }

    return toRunResult(output, request);
  }

  private async runOnce(
    playwright: TestRunner,
    request: RunRequest,
  ): Promise<RunOutput> {
    const outDir = path.join(this.runsDir!, String(this.runCounter++));
    fs.mkdirSync(outDir);
    const settings: RunSettings = {
      outDir,
      perTest: request.coverageAnalysis === 'perTest',
      hitLimit: request.hitLimit,
    };
    // Only the workers this run forks see these; the webServer started earlier never does.
    const restoreEnv = overrideEnv({
      NODE_OPTIONS: `${this.baseNodeOptions ?? ''} --import "${HOOK}"`.trim(),
      [RUN_SETTINGS]: JSON.stringify(settings),
      [INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE]: request.activeMutant,
      // A failed test's page gets an aria snapshot for Playwright's error prompt, which nobody reads
      // here; on a page stuck in a loop it waits out its 5 s timeout and pushes the run past Stryker's.
      PLAYWRIGHT_NO_COPY_PROMPT: '1',
    });
    const reporter = new CollectingReporter();

    try {
      const { status } = await playwright.runTests(reporter, {
        locations: [],
        testIds: request.testFilter,
        projects: this.options.projects,
        workers: this.options.workers ?? 1,
        maxFailures: request.disableBail ? undefined : 1,
        timeout: request.testTimeout,
        disableConfigReporters: true,
      });
      const snapshotFiles = fs
        .readdirSync(outDir)
        .filter((file) => file.endsWith(SNAPSHOT_SUFFIX));

      return {
        status,
        reporter,
        snapshots: readSnapshots(outDir, snapshotFiles),
        hookInstalled: snapshotFiles.length > 0,
      };
    } finally {
      restoreEnv();
      fs.rmSync(outDir, { recursive: true, force: true, maxRetries: 3 });
    }
  }

  // Playwright watches a webServer only while it starts. One that dies later would fail every
  // remaining test, and Stryker would count each mutant as killed.
  private async restartDeadServers(playwright: TestRunner): Promise<boolean> {
    const up = await Promise.all(this.servers.map((server) => server.isUp()));
    const dead = this.servers.filter((_, index) => !up[index]);

    if (dead.length === 0) {
      return false;
    }

    const names = dead.map((server) => server.name).join(', ');
    this.log.warn(
      `webServer at ${names} stopped answering; rerunning Playwright global setup (global teardown runs first).`,
    );
    await this.runGlobalSetup(playwright);

    return true;
  }

  private async runGlobalSetup(playwright: TestRunner) {
    const reporter = new CollectingReporter();
    const { status } = await playwright.runGlobalSetup([reporter]);

    if (status !== 'passed') {
      throw new Error(
        `Playwright global setup ${status}:\n${reporter.errors.join('\n')}\n${reporter.output}`,
      );
    }
  }
}

// The same test Playwright's webServer plugin uses at startup: an HTTP request for a url, a TCP
// connection for a port.
function serverCheck(
  server: { url?: string; port?: number; ignoreHTTPSErrors?: boolean },
  isURLAvailable: IsUrlAvailable,
): ServerCheck[] {
  if (server.url) {
    const url = new URL(server.url);

    return [
      {
        name: server.url,
        isUp: () => isURLAvailable(url, !!server.ignoreHTTPSErrors),
      },
    ];
  }

  const port = server.port;

  return port === undefined
    ? []
    : [{ name: `port ${port}`, isUp: () => acceptsConnections(port) }];
}

function acceptsConnections(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: 'localhost', port, timeout: 5000 });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

function removeDirs(dirs: (string | undefined)[]) {
  for (const dir of dirs) {
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  }
}

function overrideEnv(values: Record<string, string | undefined>): () => void {
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]]),
  );
  const apply = (next: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(next)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  };
  apply(values);

  return () => apply(previous);
}

function readSnapshots(outDir: string, files: string[]): Snapshot[] {
  return files
    .flatMap((file) =>
      fs.readFileSync(path.join(outDir, file), 'utf8').split('\n'),
    )
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Snapshot];
      } catch {
        // A worker killed mid-write leaves a partial last line.
        return [];
      }
    });
}
