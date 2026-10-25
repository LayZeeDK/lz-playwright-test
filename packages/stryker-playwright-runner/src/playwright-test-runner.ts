import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import type {
  FullResult,
  TestCase,
  TestError,
  TestResult as PlaywrightTestResult,
} from '@playwright/test/reporter';
import {
  INSTRUMENTER_CONSTANTS,
  type MutantCoverage,
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
  type TestResult,
  type TestRunner as StrykerTestRunner,
  TestStatus,
  toMutantRunResult,
} from '@stryker-mutator/api/test-runner';

import type {
  CommonModule,
  CoreBundleModule,
  RunnerModule,
  TestRunner,
} from './playwright-internals.ts';
import {
  FRAME_READ_TIMEOUT_MS,
  RUN_SETTINGS,
  type RunSettings,
  type Snapshot,
} from './protocol.ts';

export interface PlaywrightRunnerOptions {
  configFile?: string;
  projects?: string[];
  workers?: number;
}

type CoverageAnalysis = DryRunOptions['coverageAnalysis'];
type RunResult =
  | {
      status: DryRunStatus.Complete;
      tests: TestResult[];
      snapshots: Snapshot[];
    }
  | Exclude<DryRunResult, { status: DryRunStatus.Complete }>;

interface RunRequest {
  disableBail: boolean;
  coverageAnalysis?: CoverageAnalysis;
  activeMutant?: string;
  testFilter?: string[];
  hitLimit?: number;
  testTimeout?: number;
}

interface RunOutput {
  status: FullResult['status'];
  reporter: CollectingReporter;
  snapshots: Snapshot[];
  hookInstalled: boolean;
}

interface ServerCheck {
  name: string;
  isUp(): Promise<boolean>;
}

type IsUrlAvailable = CoreBundleModule['utils']['isURLAvailable'];

const HOOK = new URL('./worker-hook.ts', import.meta.url).href;
const MIN_PLAYWRIGHT = { major: 1, minor: 63 };
const OUTCOME = {
  expected: TestStatus.Success,
  flaky: TestStatus.Success,
  unexpected: TestStatus.Failed,
  skipped: TestStatus.Skipped,
} as const;
// Leaves room to end a timed-out test before Stryker's own timer kills the worker: about 1.5 s to
// load the config and fork the worker before the test starts, then the hook's read of the hung page
// and the context close after it times out.
const TIMEOUT_HEADROOM_MS = 3000 + FRAME_READ_TIMEOUT_MS;
// Below this, real tests cannot finish, so Stryker's own timer ends the run instead.
const MIN_TEST_TIMEOUT_MS = 2000;

/**
 * Hosts Playwright Test in-process through `playwright/lib/runner` (exported, undocumented), so it
 * pins a minimum Playwright version and probes the internals it calls.
 */
export class PlaywrightTestRunner implements StrykerTestRunner {
  static inject = tokens(commonTokens.options, commonTokens.logger);

  private readonly options: PlaywrightRunnerOptions;
  private readonly timeoutMS: number;
  private readonly log: Logger;
  private readonly baseNodeOptions = process.env.NODE_OPTIONS;
  private playwright?: TestRunner;
  private outputDir?: string;
  private servers: ServerCheck[] = [];
  private runCounter = 0;

  constructor(options: StrykerOptions, log: Logger) {
    this.options =
      (options as StrykerOptions & { playwright?: PlaywrightRunnerOptions })
        .playwright ?? {};
    this.timeoutMS = options.timeoutMS;
    this.log = log;
  }

  capabilities() {
    return { reloadEnvironment: true };
  }

  async init(): Promise<void> {
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

    if (
      typeof testRunner?.TestRunner !== 'function' ||
      typeof configLoader?.resolveConfigLocation !== 'function' ||
      typeof isURLAvailable !== 'function'
    ) {
      throw new Error(
        `Playwright ${version} changed the internals this runner calls (playwright/lib/runner TestRunner, playwright/lib/common configLoader, playwright-core coreBundle isURLAvailable).`,
      );
    }

    this.outputDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'stryker-pw-output-'),
    );
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
    await this.runGlobalSetup(this.playwright);
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
    // Stryker disposes a timed-out runner while its run is still going, and kills it 2 s later.
    await this.playwright?.stopTests();
    await this.playwright?.runGlobalTeardown();

    if (this.outputDir) {
      fs.rmSync(this.outputDir, {
        recursive: true,
        force: true,
        maxRetries: 3,
      });
    }
  }

  async dryRun({
    disableBail,
    coverageAnalysis,
  }: DryRunOptions): Promise<DryRunResult> {
    const run = await this.run({ disableBail, coverageAnalysis });

    if (run.status !== DryRunStatus.Complete || coverageAnalysis === 'off') {
      return run.status === DryRunStatus.Complete
        ? { status: run.status, tests: run.tests }
        : run;
    }

    const { tests, snapshots } = run;
    const failed = tests.some((test) => test.status === TestStatus.Failed);

    if (!failed && !snapshots.some((snapshot) => snapshot.mutantCoverage)) {
      return {
        status: DryRunStatus.Error,
        errorMessage:
          'No page loaded instrumented code. Is the webServer serving the Stryker sandbox? A server that was already running (reuseExistingServer) serves the original sources.',
      };
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
    const run = await this.run({
      activeMutant: activeMutant.id,
      testFilter,
      hitLimit,
      disableBail,
      testTimeout: Math.max(timeout - TIMEOUT_HEADROOM_MS, MIN_TEST_TIMEOUT_MS),
    });
    const hitCount =
      run.status === DryRunStatus.Complete
        ? run.snapshots.reduce(
            (sum, snapshot) => sum + (snapshot.hitCount ?? 0),
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
      output.reporter.failed() &&
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
    const outDir = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        `stryker-pw-${process.env.STRYKER_MUTATOR_WORKER ?? 0}-${this.runCounter++}-`,
      ),
    );
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
    const reporter = new CollectingReporter({
      flakyFails: request.activeMutant !== undefined,
    });

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
      const files = fs.readdirSync(outDir);

      return {
        status,
        reporter,
        snapshots: readSnapshots(outDir, files),
        hookInstalled: files.some((file) => file.endsWith('.ndjson')),
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

export function toRunResult(output: RunOutput, request: RunRequest): RunResult {
  const { status, reporter, snapshots, hookInstalled } = output;
  const { tests } = reporter;
  const isDryRun = request.activeMutant === undefined;

  if (status === 'interrupted') {
    return {
      status: DryRunStatus.Error,
      errorMessage: 'The Playwright run was interrupted',
    };
  }

  if (tests.length === 0) {
    return {
      status: DryRunStatus.Error,
      errorMessage: reporter.errors.length
        ? reporter.errors.join('\n')
        : request.testFilter?.length
          ? `None of the ${request.testFilter.length} selected tests ran; their Playwright test ids no longer match.`
          : 'Playwright ran no tests.',
    };
  }

  if (reporter.errors.length && !reporter.failed()) {
    return {
      status: DryRunStatus.Error,
      errorMessage: reporter.errors.join('\n'),
    };
  }

  if (
    !hookInstalled &&
    tests.some((test) => test.status !== TestStatus.Skipped)
  ) {
    return {
      status: DryRunStatus.Error,
      errorMessage:
        'Tests ran but the Stryker worker hook did not install in any Playwright worker; this Playwright version may have changed its worker entry point.',
    };
  }

  // A test that failed on its own kills the mutant even when another test timed out. The dry run
  // reports a timed-out test as the failure it is.
  if (reporter.timedOut() && !reporter.killed() && !isDryRun) {
    return {
      status: DryRunStatus.Timeout,
      reason: 'A test hit its timeout',
    };
  }

  return { status: DryRunStatus.Complete, tests, snapshots };
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

export class CollectingReporter {
  readonly errors: string[] = [];
  // The tail of webServer and global setup output, which carries the reason a server failed to start.
  output = '';
  // Playwright reports every attempt of a retried test; the last one decides.
  private readonly results = new Map<string, TestResult>();
  private readonly lastErrors = new Map<string, TestError>();
  private readonly timedOutIds = new Set<string>();
  // A test that passes only on a retry still failed against the mutant. Retries reach mutant runs
  // through describe.configure({ retries }), which outranks the retries: 0 override.
  private readonly flakyFails: boolean;

  constructor({ flakyFails = false } = {}) {
    this.flakyFails = flakyFails;
  }

  get tests(): TestResult[] {
    return [...this.results.values()];
  }

  printsToStdio() {
    return false;
  }

  failed(): boolean {
    return this.tests.some((test) => test.status === TestStatus.Failed);
  }

  killed(): boolean {
    return this.tests.some(
      (test) =>
        test.status === TestStatus.Failed && !this.timedOutIds.has(test.id),
    );
  }

  timedOut(): boolean {
    return this.timedOutIds.size > 0;
  }

  onTestEnd(test: TestCase, result: PlaywrightTestResult) {
    const titles = test.titlePath().slice(1).filter(Boolean);
    const base = {
      id: test.id,
      name: `[${titles[0]}] › ${titles.slice(1).join(' › ')}`,
      timeSpentMs: result.duration,
      fileName: test.location.file,
      startPosition: {
        line: test.location.line - 1,
        column: test.location.column - 1,
      },
    };
    const outcome = test.outcome();
    const status =
      outcome === 'flaky' && this.flakyFails
        ? TestStatus.Failed
        : OUTCOME[outcome];

    if (result.status === 'timedOut') {
      this.timedOutIds.add(test.id);
    }

    if (result.error) {
      this.lastErrors.set(test.id, result.error);
    }

    this.results.set(
      test.id,
      status === TestStatus.Failed
        ? {
            ...base,
            status,
            failureMessage: errorText(this.lastErrors.get(test.id)),
          }
        : { ...base, status },
    );
  }

  onStdOut(chunk: string | Buffer) {
    this.output = (this.output + chunk.toString()).slice(-4000);
  }

  onStdErr(chunk: string | Buffer) {
    this.onStdOut(chunk);
  }

  onError(error: TestError) {
    this.errors.push(errorText(error));
  }
}

function errorText(error: TestError | undefined): string {
  return error?.message ?? error?.value ?? 'Test failed';
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
    .filter((file) => file.endsWith('.ndjson'))
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

function mergeCoverage(snapshots: Snapshot[]): MutantCoverage {
  const coverage: MutantCoverage = { static: {}, perTest: {} };
  const add = (
    target: Record<string, number>,
    hits: Record<string, number> = {},
  ) => {
    for (const [mutantId, count] of Object.entries(hits)) {
      target[mutantId] = (target[mutantId] ?? 0) + count;
    }
  };
  const perTestTarget = (snapshot: Snapshot, testId: string) =>
    snapshot.outlivedItsTest
      ? coverage.static
      : (coverage.perTest[testId] ??= {});

  for (const snapshot of snapshots) {
    if (!snapshot.mutantCoverage) {
      continue;
    }

    add(coverage.static, snapshot.mutantCoverage.static);

    for (const [testId, hits] of Object.entries(
      snapshot.mutantCoverage.perTest ?? {},
    )) {
      add(perTestTarget(snapshot, testId), hits);
    }
  }

  return coverage;
}
