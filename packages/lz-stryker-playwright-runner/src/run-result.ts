import type { FullResult, TestCase } from '@playwright/test/reporter';
import type { MutantCoverage } from '@stryker-mutator/api/core';
import {
  type CompleteDryRunResult,
  determineHitLimitReached,
  type DryRunResult,
  DryRunStatus,
  type ErrorDryRunResult,
  type MutantRunResult,
  type TestResult,
  TestStatus,
  toMutantRunResult,
} from '@stryker-mutator/api/test-runner';

import { nullPrototypeRecord, type Snapshot } from './protocol.ts';
import {
  type LzStrykerCollectingReporter,
  errorText,
  type ReportedTest,
} from './reporter.ts';
import type {
  DryRunRequest,
  MutantRunRequest,
  RunRequest,
} from './run-request.ts';
import { timeoutReason } from './timeouts.ts';

export type RunResult =
  | (Omit<CompleteDryRunResult, 'mutantCoverage'> & {
      readonly snapshots: readonly Snapshot[];
    })
  | Exclude<DryRunResult, { readonly status: DryRunStatus.Complete }>;

export type RunStatus = FullResult['status'] | 'deadline';

export interface RunOutput {
  readonly status: RunStatus;
  readonly reporter: LzStrykerCollectingReporter;
  readonly snapshots: readonly Snapshot[];
  readonly hookInstalled: boolean;
  readonly installErrors: readonly string[];
}

export interface CoverageGaps {
  readonly lostFrames: number;
  readonly sharedFrames: number;
}

const statusByOutcome: Record<ReturnType<TestCase['outcome']>, TestStatus> = {
  expected: TestStatus.Success,
  flaky: TestStatus.Success,
  unexpected: TestStatus.Failed,
  skipped: TestStatus.Skipped,
};

export interface AttemptSummary {
  /** An attempt ended other than expected, skipped aside: timed out and interrupted count. */
  readonly anyFailed: boolean;
  /**
   * An attempt failed or passed against its expectation. A timed-out, interrupted or skipped attempt
   * kills no mutant; the test a deadline stop interrupts ends as skipped.
   */
  readonly killed: boolean;
  readonly timedOut: boolean;
}

export function attemptSummary(
  testCases: Iterable<ReportedTest>,
): AttemptSummary {
  const attempts = [...testCases].flatMap((test) =>
    test.results.map(({ status }) => ({
      status,
      unexpected: status !== test.expectedStatus,
    })),
  );

  return {
    anyFailed: attempts.some(
      ({ status, unexpected }) => unexpected && status !== 'skipped',
    ),
    killed: attempts.some(
      ({ status, unexpected }) =>
        unexpected && (status === 'failed' || status === 'passed'),
    ),
    timedOut: attempts.some(({ status }) => status === 'timedOut'),
  };
}

export function mayHaveLostItsServer(output: RunOutput): boolean {
  return (
    output.status !== 'deadline' &&
    attemptSummary(output.reporter.testCases.values()).anyFailed
  );
}

export function toRunResult(output: RunOutput, request: RunRequest): RunResult {
  const { status, reporter, snapshots, hookInstalled, installErrors } = output;
  const isMutantRun = request.kind === 'mutant';
  const testCases = [...reporter.testCases.values()];
  const tests = testCases.map((test) => toTestResult(test, isMutantRun));
  const { killed, timedOut } = attemptSummary(testCases);
  const reason = timeoutReason({
    mutantRun: isMutantRun,
    killed,
    testTimedOut: timedOut,
    stoppedAtDeadline: status === 'deadline',
  });

  if (status === 'interrupted') {
    return errorRun('The Playwright run was interrupted');
  }

  // Before the empty-run rules: a stop during the config load leaves no tests at all.
  if (status === 'deadline' && reason) {
    return { status: DryRunStatus.Timeout, reason };
  }

  if (reporter.errors.length && !anyTestFailed(tests)) {
    return errorRun(reporter.errors.join('\n'));
  }

  // Playwright catches its own internal errors, prints them, and fails the run without reporting them.
  if (status === 'failed' && tests.length === 0) {
    return errorRun(
      'Playwright failed without running a test; rerun Stryker with --logLevel trace to see its error.',
    );
  }

  if (tests.length === 0) {
    return emptyRunResult(request);
  }

  // A worker that dies at the hook's install is to Playwright only a crash; the hook left the cause.
  if (installErrors.length > 0) {
    return errorRun(
      `The Stryker worker hook failed to install in a Playwright worker: ${[...new Set(installErrors)].join('\n')}`,
    );
  }

  if (!hookInstalled && anyRan(tests)) {
    return errorRun(
      'Tests ran but the Stryker worker hook did not install in any Playwright worker; this Playwright version may have changed its worker entry point.',
    );
  }

  if (reason) {
    return { status: DryRunStatus.Timeout, reason };
  }

  return { status: DryRunStatus.Complete, tests, snapshots };
}

export function missingCoverageError(
  tests: readonly TestResult[],
  snapshots: readonly Snapshot[],
): string | undefined {
  if (
    !anyRan(tests) ||
    anyTestFailed(tests) ||
    snapshots.some((snapshot) => snapshot.coverage)
  ) {
    return undefined;
  }

  if (snapshots.length === 0) {
    return 'Tests ran, but no instrumented code ran, neither in a page nor in a Playwright worker. The dry run needs at least one test that runs the app code, in a page or by importing it.';
  }

  const { lostFrames } = coverageGaps(snapshots);

  if (lostFrames === snapshots.length) {
    return `No page reported coverage: all ${lostFrames} frame(s) did not answer before their context closed.`;
  }

  return 'No page loaded instrumented code. Is the webServer serving the Stryker sandbox? A server that was already running (reuseExistingServer) serves the original sources.';
}

// The output maps have no prototype, so a test id such as __proto__ from a page stays an own key.
export function mergeCoverage(snapshots: readonly Snapshot[]): MutantCoverage {
  const merged: MutantCoverage = {
    static: nullPrototypeRecord(),
    perTest: nullPrototypeRecord(),
  };
  const add = (
    target: Record<string, number>,
    hits: Record<string, number>,
  ) => {
    Object.entries(hits).forEach(([mutantId, count]) => {
      target[mutantId] = (target[mutantId] ?? 0) + count;
    });
  };

  snapshots.forEach(({ coverage, outlivedItsTest }) => {
    if (!coverage) {
      return;
    }

    add(merged.static, coverage.static);
    Object.entries(coverage.perTest).forEach(([testId, hits]) => {
      add(
        outlivedItsTest
          ? merged.static
          : (merged.perTest[testId] ??= nullPrototypeRecord()),
        hits,
      );
    });
  });

  return merged;
}

export function coverageGaps(snapshots: readonly Snapshot[]): CoverageGaps {
  return {
    lostFrames: snapshots.filter((snapshot) => snapshot.lost).length,
    sharedFrames: snapshots.filter(
      (snapshot) => snapshot.outlivedItsTest && snapshot.coverage,
    ).length,
  };
}

function sumHitCounts(snapshots: readonly Snapshot[]): number {
  return snapshots.reduce((sum, { hitCount }) => sum + hitCount, 0);
}

export function dryRunResult(
  output: RunOutput,
  request: DryRunRequest,
): { result: DryRunResult; gaps: CoverageGaps | undefined } {
  const run = toRunResult(output, request);

  if (run.status !== DryRunStatus.Complete) {
    return { result: run, gaps: undefined };
  }

  const { status, tests, snapshots } = run;
  const errorMessage = missingCoverageError(tests, snapshots);

  if (errorMessage) {
    return { result: errorRun(errorMessage), gaps: undefined };
  }

  if (request.coverageAnalysis === 'off') {
    return { result: { status, tests }, gaps: undefined };
  }

  return {
    result: { status, tests, mutantCoverage: mergeCoverage(snapshots) },
    gaps: coverageGaps(snapshots),
  };
}

export function mutantRunResult(
  output: RunOutput,
  request: MutantRunRequest,
): { result: MutantRunResult; hitCount: number } {
  const hitCount = sumHitCounts(output.snapshots);

  return {
    result: toMutantRunResult(
      determineHitLimitReached(hitCount, request.hitLimit) ??
        toRunResult(output, request),
    ),
    hitCount,
  };
}

function emptyRunResult(request: RunRequest): RunResult {
  // Stryker fails an empty dry run itself unless allowEmpty is set.
  if (request.kind === 'dry') {
    return { status: DryRunStatus.Complete, tests: [], snapshots: [] };
  }

  if (request.testFilter?.length) {
    return errorRun(
      `None of the ${request.testFilter.length} selected tests ran; their Playwright test ids no longer match.`,
    );
  }

  return errorRun('Playwright ran no tests.');
}

function errorRun(errorMessage: string): ErrorDryRunResult {
  return { status: DryRunStatus.Error, errorMessage };
}

function anyRan(tests: readonly TestResult[]): boolean {
  return tests.some((test) => test.status !== TestStatus.Skipped);
}

function anyTestFailed(tests: readonly TestResult[]): boolean {
  return tests.some((test) => test.status === TestStatus.Failed);
}

function toTestResult(test: ReportedTest, isMutantRun: boolean): TestResult {
  // The root suite's title is the empty first one.
  const titles = test.titlePath().filter(Boolean);
  const last = test.results.at(-1);
  const outcome = test.outcome();
  // A test that passes only on a retry still failed against the mutant. Retries reach mutant runs
  // through describe.configure({ retries }), which outranks the retries: 0 that Playwright's
  // runTests sets.
  const status =
    outcome === 'flaky' && isMutantRun
      ? TestStatus.Failed
      : statusByOutcome[outcome];
  const base = {
    id: test.id,
    name: `[${titles[0]}] › ${titles.slice(1).join(' › ')}`,
    timeSpentMs: last?.duration ?? 0,
    fileName: test.location.file,
    startPosition: {
      line: test.location.line - 1,
      column: test.location.column - 1,
    },
  };

  if (status !== TestStatus.Failed) {
    return { ...base, status };
  }

  return {
    ...base,
    status,
    failureMessage: errorText(
      test.results.findLast((result) => result.error)?.error,
    ),
  };
}
