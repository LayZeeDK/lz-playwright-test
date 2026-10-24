import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';
import { commonTokens } from '@stryker-mutator/api/plugin';
import {
  determineHitLimitReached,
  DryRunStatus,
  TestStatus,
  toMutantRunResult,
} from '@stryker-mutator/api/test-runner';

const HOOK = fileURLToPath(new URL('./worker-hook.cjs', import.meta.url)).replaceAll('\\', '/');
const OUTCOME = { expected: TestStatus.Success, flaky: TestStatus.Success, unexpected: TestStatus.Failed, skipped: TestStatus.Skipped };

/**
 * Hosts Playwright Test in-process through `playwright/lib/runner` (exported, undocumented; present in
 * 1.62 and 1.64). Global setup and `webServer` start once in init(); each run forks fresh workers,
 * which inherit process.env, so per-run settings travel to the worker hook as environment variables.
 */
export class PlaywrightTestRunner {
  static inject = [commonTokens.options, commonTokens.logger];

  runCounter = 0;

  constructor(options, log) {
    this.options = options.playwright ?? {};
    this.timeoutMS = options.timeoutMS;
    this.log = log;
  }

  capabilities() {
    return { reloadEnvironment: true };
  }

  async init() {
    const configFile = this.options.configFile ? path.resolve(this.options.configFile) : undefined;
    const playwrightRequire = createRequire(createRequire(configFile ?? path.resolve('package.json')).resolve('@playwright/test'));
    const { testRunner } = playwrightRequire('playwright/lib/runner');
    const { configLoader } = playwrightRequire('playwright/lib/common');

    process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --require "${HOOK}"`.trim();
    process.env.STRYKER_PW_NAMESPACE = INSTRUMENTER_CONSTANTS.NAMESPACE;
    process.env.PLAYWRIGHT_HTML_OPEN = 'never';

    this.playwright = new testRunner.TestRunner(configLoader.resolveConfigLocation(configFile), {
      outputDir: fs.mkdtempSync(path.join(os.tmpdir(), 'stryker-pw-output-')),
      use: { screenshot: 'off', trace: 'off', video: 'off' },
    });
    await this.playwright.initialize({});
    await this.warnAboutAssertionTimeouts();

    const reporter = new CollectingReporter();
    const { status } = await this.playwright.runGlobalSetup([reporter]);

    if (status !== 'passed') {
      throw new Error(`Playwright global setup ${status}:\n${reporter.errors.join('\n')}`);
    }
  }

  // A killed test fails only after its auto-waiting assertion gives up, but Stryker sizes its timeout
  // from passing tests, so a short timeoutMS turns kills into timeouts.
  async warnAboutAssertionTimeouts() {
    const config = await this.playwright.loadConfig();
    const expectTimeout = Math.max(...config.projects.map(({ project }) => project.expect?.timeout ?? 5000));

    if (this.timeoutMS < expectTimeout * 2) {
      this.log.warn(
        `timeoutMS (${this.timeoutMS}) is below twice the Playwright expect timeout (${expectTimeout}); killed mutants may be reported as timeouts. Set timeoutMS to at least ${expectTimeout * 2}.`,
      );
    }
  }

  async dispose() {
    await this.playwright?.runGlobalTeardown();
  }

  async dryRun({ timeout, disableBail, coverageAnalysis }) {
    const run = await this.run({ timeout, disableBail, coverageAnalysis });

    if (run.status !== DryRunStatus.Complete || coverageAnalysis === 'off') {
      return run;
    }

    if (!run.snapshots.some((snapshot) => snapshot.mutantCoverage)) {
      return {
        status: DryRunStatus.Error,
        errorMessage:
          'No page loaded instrumented code. Is the webServer serving the Stryker sandbox? A server that was already running (reuseExistingServer) serves the original sources.',
      };
    }

    return { status: run.status, tests: run.tests, mutantCoverage: mergeCoverage(run.snapshots) };
  }

  async mutantRun({ activeMutant, testFilter, hitLimit, timeout, disableBail }) {
    const run = await this.run({ activeMutant: activeMutant.id, testFilter, hitLimit, timeout, disableBail });
    const hitCount = run.snapshots?.reduce((sum, snapshot) => sum + (snapshot.hitCount ?? 0), 0);
    this.log.debug(
      `Mutant ${activeMutant.id}: ${run.status}, hitCount ${hitCount}/${hitLimit}, ${run.tests?.length} tests, ${JSON.stringify(run.snapshots?.map((s) => s.hitCount))}`,
    );

    return toMutantRunResult(determineHitLimitReached(hitCount, hitLimit) ?? run);
  }

  async run({ activeMutant, testFilter, hitLimit, timeout, disableBail, coverageAnalysis = 'off' }) {
    const outDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `stryker-pw-${process.env.STRYKER_MUTATOR_WORKER ?? 0}-${this.runCounter++}-`),
    );
    setEnv('STRYKER_PW_OUT_DIR', outDir);
    setEnv('__STRYKER_ACTIVE_MUTANT__', activeMutant);
    setEnv('STRYKER_PW_HIT_LIMIT', hitLimit?.toString());
    setEnv('STRYKER_PW_COVERAGE', coverageAnalysis);

    const reporter = new CollectingReporter();
    const run = this.playwright.runTests(reporter, {
      locations: [],
      testIds: testFilter,
      projects: this.options.projects,
      workers: this.options.workers ?? 1,
      maxFailures: disableBail ? undefined : 1,
      disableConfigReporters: true,
    });
    // Stop on our own before Stryker's timeout, so Stryker does not restart this process (which would
    // restart the webServer too). A stop that takes longer is awaited by the next runTests call.
    let timer;
    const timedOut = new Promise((resolve) => {
      timer = setTimeout(resolve, Math.max(timeout - 2000, 1), 'timeout');
    });

    try {
      const outcome = await Promise.race([run, timedOut]);

      if (outcome === 'timeout') {
        await Promise.race([this.playwright.stopTests(), sleep(1500)]);

        return { status: DryRunStatus.Timeout, reason: `Playwright did not finish within ${timeout} ms` };
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
  tests = [];
  errors = [];

  printsToStdio() {
    return false;
  }

  onTestEnd(test, result) {
    const status = OUTCOME[test.outcome()];
    const titles = test.titlePath().slice(1).filter(Boolean);
    const testResult = {
      id: test.id,
      name: `[${titles[0]}] › ${titles.slice(1).join(' › ')}`,
      status,
      timeSpentMs: result.duration,
      fileName: test.location.file,
      startPosition: { line: test.location.line - 1, column: test.location.column - 1 },
    };

    if (status === TestStatus.Failed) {
      testResult.failureMessage = result.error?.message ?? result.error?.value ?? 'Test failed';
    }

    this.tests.push(testResult);
  }

  onError(error) {
    this.errors.push(error.message ?? String(error));
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function readSnapshots(outDir) {
  return fs
    .readdirSync(outDir)
    .filter((file) => file.endsWith('.ndjson'))
    .flatMap((file) => fs.readFileSync(path.join(outDir, file), 'utf8').split('\n'))
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function mergeCoverage(snapshots) {
  const coverage = { static: {}, perTest: {} };
  const add = (target, hits = {}) => {
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
