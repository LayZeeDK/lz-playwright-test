import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import type { TestCase, TestError, TestResult as PlaywrightTestResult } from '@playwright/test/reporter';
import { INSTRUMENTER_CONSTANTS, type MutantCoverage, type StrykerOptions } from '@stryker-mutator/api/core';
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

import type { CommonModule, RunnerModule, TestRunner } from './playwright-internals.ts';
import { ENV, type Snapshot } from './protocol.ts';

export interface PlaywrightRunnerOptions {
  configFile?: string;
  projects?: string[];
  workers?: number;
}

type CoverageAnalysis = DryRunOptions['coverageAnalysis'];
type RunResult =
  | { status: DryRunStatus.Complete; tests: TestResult[]; snapshots: Snapshot[] }
  | Exclude<DryRunResult, { status: DryRunStatus.Complete }>;

interface RunRequest {
  timeout: number;
  disableBail: boolean;
  coverageAnalysis?: CoverageAnalysis;
  activeMutant?: string;
  testFilter?: string[];
  hitLimit?: number;
}

const HOOK = new URL('./worker-hook.ts', import.meta.url).href;
const MIN_PLAYWRIGHT = [1, 63];
const OUTCOME = {
  expected: TestStatus.Success,
  flaky: TestStatus.Success,
  unexpected: TestStatus.Failed,
  skipped: TestStatus.Skipped,
} as const;

/**
 * Hosts Playwright Test in-process through `playwright/lib/runner` (exported, undocumented), so it
 * pins a minimum Playwright version. Global setup and `webServer` start once in init(); each run forks
 * fresh workers, which inherit process.env, so per-run settings travel to the worker hook as
 * environment variables.
 */
export class PlaywrightTestRunner implements StrykerTestRunner {
  static inject = tokens(commonTokens.options, commonTokens.logger);

  private readonly options: PlaywrightRunnerOptions;
  private readonly timeoutMS: number;
  private readonly log: Logger;
  private playwright?: TestRunner;
  private runCounter = 0;

  constructor(options: StrykerOptions, log: Logger) {
    this.options = (options as StrykerOptions & { playwright?: PlaywrightRunnerOptions }).playwright ?? {};
    this.timeoutMS = options.timeoutMS;
    this.log = log;
  }

  capabilities() {
    return { reloadEnvironment: true };
  }

  async init(): Promise<void> {
    const configFile = this.options.configFile ? path.resolve(this.options.configFile) : undefined;
    const playwrightRequire = createRequire(
      createRequire(configFile ?? path.resolve('package.json')).resolve('@playwright/test'),
    );
    const { version } = playwrightRequire('playwright/package.json') as { version: string };
    const [major, minor] = version.split('.').map(Number);

    if (major < MIN_PLAYWRIGHT[0] || (major === MIN_PLAYWRIGHT[0] && minor < MIN_PLAYWRIGHT[1])) {
      throw new Error(`The Playwright test runner needs Playwright ${MIN_PLAYWRIGHT.join('.')} or later, found ${version}.`);
    }

    const { testRunner } = playwrightRequire('playwright/lib/runner') as RunnerModule;
    const { configLoader } = playwrightRequire('playwright/lib/common') as CommonModule;

    process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --import "${HOOK}"`.trim();
    process.env[ENV.namespace] = INSTRUMENTER_CONSTANTS.NAMESPACE;
    process.env.PLAYWRIGHT_HTML_OPEN = 'never';

    this.playwright = new testRunner.TestRunner(configLoader.resolveConfigLocation(configFile), {
      outputDir: fs.mkdtempSync(path.join(os.tmpdir(), 'stryker-pw-output-')),
      use: { screenshot: 'off', trace: 'off', video: 'off' },
    });
    await this.playwright.initialize({});
    await this.warnAboutAssertionTimeouts(this.playwright);

    const reporter = new CollectingReporter();
    const { status } = await this.playwright.runGlobalSetup([reporter]);

    if (status !== 'passed') {
      throw new Error(`Playwright global setup ${status}:\n${reporter.errors.join('\n')}\n${reporter.output}`);
    }
  }

  // A killed test fails only after its auto-waiting assertion gives up, but Stryker sizes its timeout
  // from passing tests, so a short timeoutMS turns kills into timeouts.
  private async warnAboutAssertionTimeouts(playwright: TestRunner) {
    const config = await playwright.loadConfig();
    const expectTimeout = Math.max(...config.projects.map(({ project }) => project.expect?.timeout ?? 5000));

    if (this.timeoutMS < expectTimeout * 2) {
      this.log.warn(
        `timeoutMS (${this.timeoutMS}) is below twice the Playwright expect timeout (${expectTimeout}); killed mutants may be reported as timeouts. Set timeoutMS to at least ${expectTimeout * 2}.`,
      );
    }
  }

  async dispose(): Promise<void> {
    await this.playwright?.runGlobalTeardown();
  }

  async dryRun({ timeout, disableBail, coverageAnalysis }: DryRunOptions): Promise<DryRunResult> {
    const run = await this.run({ timeout, disableBail, coverageAnalysis });

    if (run.status !== DryRunStatus.Complete) {
      return run;
    }

    const { tests, snapshots } = run;

    if (coverageAnalysis === 'off') {
      return { status: run.status, tests };
    }

    const failed = tests.some((test) => test.status === TestStatus.Failed);

    if (!failed && !snapshots.some((snapshot) => snapshot.mutantCoverage)) {
      return {
        status: DryRunStatus.Error,
        errorMessage:
          'No page loaded instrumented code. Is the webServer serving the Stryker sandbox? A server that was already running (reuseExistingServer) serves the original sources.',
      };
    }

    return { status: run.status, tests, mutantCoverage: mergeCoverage(snapshots) };
  }

  async mutantRun({ activeMutant, testFilter, hitLimit, timeout, disableBail }: MutantRunOptions): Promise<MutantRunResult> {
    const run = await this.run({ activeMutant: activeMutant.id, testFilter, hitLimit, timeout, disableBail });
    const hitCount =
      run.status === DryRunStatus.Complete
        ? run.snapshots.reduce((sum, snapshot) => sum + (snapshot.hitCount ?? 0), 0)
        : undefined;
    this.log.debug(`Mutant ${activeMutant.id}: ${run.status}, hitCount ${hitCount}/${hitLimit}`);

    return toMutantRunResult(determineHitLimitReached(hitCount, hitLimit) ?? run);
  }

  private async run(request: RunRequest): Promise<RunResult> {
    const playwright = this.playwright!;
    const outDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `stryker-pw-${process.env.STRYKER_MUTATOR_WORKER ?? 0}-${this.runCounter++}-`),
    );
    setEnv(ENV.outDir, outDir);
    setEnv(ENV.activeMutant, request.activeMutant);
    setEnv(ENV.hitLimit, request.hitLimit?.toString());
    setEnv(ENV.coverage, request.coverageAnalysis ?? 'off');

    const reporter = new CollectingReporter();
    const run = playwright.runTests(reporter, {
      locations: [],
      testIds: request.testFilter,
      projects: this.options.projects,
      workers: this.options.workers ?? 1,
      maxFailures: request.disableBail ? undefined : 1,
      disableConfigReporters: true,
    });
    // Stop on our own before Stryker's timeout, so Stryker does not restart this process (which would
    // restart the webServer too). A stop that takes longer is awaited by the next runTests call.
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(resolve, Math.max(request.timeout - 2000, 1), 'timeout');
    });

    try {
      const outcome = await Promise.race([run, timedOut]);

      if (outcome === 'timeout') {
        await Promise.race([playwright.stopTests(), sleep(1500)]);

        return { status: DryRunStatus.Timeout, reason: `Playwright did not finish within ${request.timeout} ms` };
      }

      const failed = reporter.tests.some((test) => test.status === TestStatus.Failed);

      if (reporter.errors.length && !failed) {
        return { status: DryRunStatus.Error, errorMessage: reporter.errors.join('\n') };
      }

      return { status: DryRunStatus.Complete, tests: reporter.tests, snapshots: readSnapshots(outDir) };
    } finally {
      clearTimeout(timer);
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
}

class CollectingReporter {
  readonly tests: TestResult[] = [];
  readonly errors: string[] = [];
  // The tail of webServer and global setup output, which carries the reason a server failed to start.
  output = '';

  printsToStdio() {
    return false;
  }

  onTestEnd(test: TestCase, result: PlaywrightTestResult) {
    const titles = test.titlePath().slice(1).filter(Boolean);
    const base = {
      id: test.id,
      name: `[${titles[0]}] › ${titles.slice(1).join(' › ')}`,
      timeSpentMs: result.duration,
      fileName: test.location.file,
      startPosition: { line: test.location.line - 1, column: test.location.column - 1 },
    };
    const status = OUTCOME[test.outcome()];

    this.tests.push(
      status === TestStatus.Failed ? { ...base, status, failureMessage: describe(result.error) } : { ...base, status },
    );
  }

  onStdOut(chunk: string | Buffer) {
    this.output = (this.output + chunk.toString()).slice(-4000);
  }

  onStdErr(chunk: string | Buffer) {
    this.onStdOut(chunk);
  }

  onError(error: TestError) {
    this.errors.push(describe(error));
  }
}

function describe(error: TestError | undefined): string {
  return error?.message ?? error?.value ?? 'Test failed';
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function readSnapshots(outDir: string): Snapshot[] {
  return fs
    .readdirSync(outDir)
    .filter((file) => file.endsWith('.ndjson'))
    .flatMap((file) => fs.readFileSync(path.join(outDir, file), 'utf8').split('\n'))
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Snapshot);
}

function mergeCoverage(snapshots: Snapshot[]): MutantCoverage {
  const coverage: MutantCoverage = { static: {}, perTest: {} };
  const add = (target: Record<string, number>, hits: Record<string, number> = {}) => {
    for (const [mutantId, count] of Object.entries(hits)) {
      target[mutantId] = (target[mutantId] ?? 0) + count;
    }
  };

  for (const { mutantCoverage } of snapshots) {
    if (!mutantCoverage) {
      continue;
    }

    add(coverage.static, mutantCoverage.static);

    for (const [id, hits] of Object.entries(mutantCoverage.perTest ?? {})) {
      add((coverage.perTest[id] ??= {}), hits);
    }
  }

  return coverage;
}
