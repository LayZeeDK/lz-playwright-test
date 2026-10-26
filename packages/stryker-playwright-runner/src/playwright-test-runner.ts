import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import {
  INSTRUMENTER_CONSTANTS,
  type StrykerOptions,
} from '@stryker-mutator/api/core';
import type { Logger } from '@stryker-mutator/api/logging';
import { commonTokens, tokens } from '@stryker-mutator/api/plugin';
import type {
  DryRunOptions,
  DryRunResult,
  MutantRunOptions,
  MutantRunResult,
  TestRunner as StrykerTestRunner,
} from '@stryker-mutator/api/test-runner';

import { readRunnerOptions, type RunnerOptions } from './options.ts';
import {
  loadPlaywright,
  NO_COPY_PROMPT_ENV,
  type Playwright,
  type TestRunner,
} from './playwright-internals.ts';
import { readSnapshotDir, RUN_SETTINGS } from './protocol.ts';
import {
  CollectingReporter,
  type CoverageGaps,
  dryRunRequest,
  dryRunResult,
  listSerialGroups,
  mayHaveLostItsServer,
  mutantRunRequest,
  mutantRunResult,
  projectsThatRun,
  type RunOutput,
  type RunRequest,
  runSettings,
} from './run-result.ts';
import {
  assertionTimeoutWarning,
  type ConfigTimeouts,
  configTimeouts,
} from './timeouts.ts';

interface ServerCheck {
  name: string;
  isUp(): Promise<boolean>;
}

// `.ts` when this module runs from source, `.js` when it runs from the build.
const HOOK = new URL(
  `./worker-hook${path.extname(import.meta.filename)}`,
  import.meta.url,
).href;

/**
 * Hosts Playwright Test in-process through its undocumented TestRunner, which
 * playwright-internals.ts loads, checks and types.
 */
export class PlaywrightTestRunner implements StrykerTestRunner {
  static inject = tokens(commonTokens.options, commonTokens.logger);

  private readonly strykerOptions: StrykerOptions;
  private readonly log: Logger;
  private readonly baseNodeOptions = process.env.NODE_OPTIONS;
  private options?: RunnerOptions;
  private playwright?: TestRunner;
  private rootDir?: string;
  private outputDir?: string;
  private runsDir?: string;
  private servers: ServerCheck[] = [];
  private serialGroups = new Map<string, string[]>();
  private timeouts?: ConfigTimeouts;
  private runCounter = 0;

  constructor(options: StrykerOptions, log: Logger) {
    this.strykerOptions = options;
    this.log = log;
  }

  capabilities() {
    return { reloadEnvironment: true };
  }

  async init(): Promise<void> {
    const options = readRunnerOptions(this.strykerOptions);
    this.options = options;
    const pw = loadPlaywright(options.configFile);

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
    this.playwright = await pw.createTestRunner(options.configFile, {
      outputDir: this.outputDir,
      use: { screenshot: 'off', trace: 'off', video: 'off' },
    });

    const config = await this.playwright.loadConfig();
    this.servers = config.webServers.flatMap((server) =>
      serverCheck(server, pw.isURLAvailable),
    );
    this.timeouts = configTimeouts(config.projects);
    const warning = assertionTimeoutWarning(
      this.timeouts,
      options.strykerTimeoutMS,
    );

    if (warning) {
      this.log.warn(warning);
    }

    await this.runGlobalSetup(this.playwright);
    // Every Stryker test runner process needs the groups, and only one of them runs the dry run. Listed
    // after global setup, like Playwright's own CLI, because test files may read what it creates.
    this.serialGroups = await listSerialGroups(
      this.playwright,
      projectsThatRun(options.projects, config.projects),
    );
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

  async dryRun(options: DryRunOptions): Promise<DryRunResult> {
    const request = dryRunRequest(options);
    const { result, gaps } = dryRunResult(await this.run(request), request);

    if (gaps) {
      logCoverageGaps(this.log, gaps);
    }

    return result;
  }

  async mutantRun(options: MutantRunOptions): Promise<MutantRunResult> {
    const request = mutantRunRequest(options, {
      serialGroups: this.serialGroups,
      timeouts: this.timeouts!,
    });
    const { result, hitCount } = mutantRunResult(
      await this.run(request),
      request,
    );
    this.log.debug(
      `Mutant ${request.activeMutant}: ${result.status}, hitCount ${hitCount}/${request.hitLimit}`,
    );

    return result;
  }

  private async run(request: RunRequest): Promise<RunOutput> {
    const playwright = this.playwright!;
    await this.restartDeadServers(playwright);
    let output = await this.runOnce(playwright, request);

    // A server that died during this run fails its tests for a reason the mutant did not cause.
    if (
      mayHaveLostItsServer(output) &&
      (await this.restartDeadServers(playwright))
    ) {
      output = await this.runOnce(playwright, request);
    }

    return output;
  }

  private async runOnce(
    playwright: TestRunner,
    request: RunRequest,
  ): Promise<RunOutput> {
    const outDir = path.join(this.runsDir!, String(this.runCounter++));
    fs.mkdirSync(outDir);
    // Only the workers this run forks see these; the webServer started earlier never does.
    const restoreEnv = overrideEnv({
      NODE_OPTIONS: `${this.baseNodeOptions ?? ''} --import "${HOOK}"`.trim(),
      [RUN_SETTINGS]: JSON.stringify(runSettings(request, outDir)),
      [INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE]:
        request.kind === 'mutant' ? request.activeMutant : undefined,
      [NO_COPY_PROMPT_ENV]: '1',
    });
    const reporter = new CollectingReporter();

    try {
      const { status } = await playwright.runTests(reporter, {
        locations: [],
        testIds: request.kind === 'mutant' ? request.testFilter : undefined,
        projects: this.options!.projects,
        workers: this.options!.workers,
        maxFailures: request.disableBail ? undefined : 1,
        timeout: request.budget.testTimeout,
        disableConfigReporters: true,
      });

      return { status, reporter, ...readSnapshotDir(outDir) };
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
  isURLAvailable: Playwright['isURLAvailable'],
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

function logCoverageGaps(
  log: Logger,
  { lostFrames, sharedFrames }: CoverageGaps,
) {
  if (lostFrames > 0) {
    log.warn(
      `${lostFrames} frame(s) did not answer before their context closed; their coverage is missing, so mutants only they reached show as NoCoverage.`,
    );
  }

  if (sharedFrames > 0) {
    log.info(
      `${sharedFrames} frame(s) belonged to contexts that outlived their test (beforeAll or worker fixtures); their coverage counts as static, so every test runs for those mutants.`,
    );
  }
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
