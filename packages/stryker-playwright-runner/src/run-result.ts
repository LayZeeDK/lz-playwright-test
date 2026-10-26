import type {
  FullResult,
  Suite,
  TestCase,
  TestError,
} from '@playwright/test/reporter';
import type { MutantCoverage } from '@stryker-mutator/api/core';
import {
  determineHitLimitReached,
  type DryRunOptions,
  type DryRunResult,
  DryRunStatus,
  type MutantRunOptions,
  type MutantRunResult,
  type TestResult,
  TestStatus,
  toMutantRunResult,
} from '@stryker-mutator/api/test-runner';

import { parallelModeOf, type TestRunner } from './playwright-internals.ts';
import type { RunSettings, Snapshot } from './protocol.ts';
import {
  type ConfigTimeouts,
  DRY_RUN_BUDGET,
  mutantRunBudget,
  type RunBudget,
  timeoutReason,
} from './timeouts.ts';

/** A Complete result that still carries the snapshots for the dry-run and mutant-run folds. */
export type RunResult =
  | {
      status: DryRunStatus.Complete;
      tests: TestResult[];
      snapshots: Snapshot[];
    }
  | Exclude<DryRunResult, { status: DryRunStatus.Complete }>;

export type RunRequest = DryRunRequest | MutantRunRequest;

export interface DryRunRequest {
  readonly kind: 'dry';
  readonly disableBail: boolean;
  readonly coverageAnalysis: DryRunOptions['coverageAnalysis'];
  readonly budget: RunBudget;
}

export interface MutantRunRequest {
  readonly kind: 'mutant';
  readonly disableBail: boolean;
  readonly activeMutant: string;
  /** Already widened to whole describe.serial groups. */
  readonly testFilter: string[] | undefined;
  readonly hitLimit: number | undefined;
  readonly budget: RunBudget;
}

/**
 * Playwright's status, plus 'deadline': the runner's own timer stopped the run. An 'interrupted' that
 * reaches the folds is never the runner's doing.
 */
export type RunStatus = FullResult['status'] | 'deadline';

export interface RunOutput {
  readonly status: RunStatus;
  readonly reporter: CollectingReporter;
  readonly snapshots: Snapshot[];
  readonly hookInstalled: boolean;
}

/** The counts the dry run logs. */
export interface CoverageGaps {
  readonly lostFrames: number;
  readonly sharedFrames: number;
}

const OUTCOME = {
  expected: TestStatus.Success,
  flaky: TestStatus.Success,
  unexpected: TestStatus.Failed,
  skipped: TestStatus.Skipped,
} as const;

/** Records what Playwright reports, for `toRunResult` after a run and `listSerialGroups` after a listing. */
export class CollectingReporter {
  readonly errors: string[] = [];
  // The tail of webServer and global setup output, which carries the reason a server failed to start.
  output = '';
  // Playwright reports each attempt of a retried test with the same TestCase, which holds them all.
  readonly testCases = new Map<string, TestCase>();
  private suite?: Suite;

  printsToStdio() {
    return false;
  }

  onBegin(_config: unknown, suite: Suite) {
    this.suite = suite;
  }

  // Every test Playwright loaded, run or not.
  get listedTests(): TestCase[] {
    return this.suite?.allTests() ?? [];
  }

  anyAttemptFailed(): boolean {
    return [...this.testCases.values()].some((test) =>
      test.results.some(
        (result) =>
          result.status !== test.expectedStatus && result.status !== 'skipped',
      ),
    );
  }

  onTestEnd(test: TestCase) {
    this.testCases.set(test.id, test);
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

// The projects runTests runs: the option's, else the default ones. Given no names, listTests would also
// load the default: false projects.
export function projectsThatRun(
  option: string[] | undefined,
  projects: { default: boolean; project: { name: string } }[],
): string[] {
  return option?.length
    ? option
    : projects
        .filter((project) => project.default)
        .map(({ project }) => project.name);
}

export async function listSerialGroups(
  playwright: Pick<TestRunner, 'listTests'>,
  projects: string[],
): Promise<Map<string, string[]>> {
  const reporter = new CollectingReporter();
  const result = await playwright.listTests(reporter, { projects });

  if (!result) {
    throw new Error(
      'Playwright threw while listing the tests. Rerun Stryker with --logLevel trace to see its error.',
    );
  }

  if (result.status !== 'passed') {
    throw new Error(
      `Playwright could not list the tests (${result.status}):\n${reporter.errors.join('\n')}`,
    );
  }

  // A file that fails to load leaves the status "passed", and its serial groups would be missing.
  if (reporter.errors.length) {
    throw new Error(
      `Playwright could not load every test file:\n${reporter.errors.join('\n')}`,
    );
  }

  return serialGroups(reporter.listedTests);
}

/**
 * The tests of each `describe.serial` group, keyed by every test in it. A later test in a serial
 * group depends on the ones before it, so it cannot run alone.
 */
export function serialGroups(
  testCases: Iterable<TestCase>,
): Map<string, string[]> {
  const bySuite = new Map<object, string[]>();
  const byTest = new Map<string, string[]>();

  for (const test of testCases) {
    let group: object | undefined;

    for (
      let suite: Suite | undefined = test.parent;
      suite;
      suite = suite.parent
    ) {
      if (parallelModeOf(suite) === 'serial') {
        group = suite;
      }
    }

    if (group) {
      const ids = bySuite.get(group) ?? [];
      ids.push(test.id);
      bySuite.set(group, ids);
      byTest.set(test.id, ids);
    }
  }

  return byTest;
}

export function withSerialGroups(
  testFilter: string[] | undefined,
  groups: Map<string, string[]>,
): string[] | undefined {
  return (
    testFilter && [
      ...new Set(testFilter.flatMap((id) => groups.get(id) ?? [id])),
    ]
  );
}

export function dryRunRequest({
  disableBail,
  coverageAnalysis,
}: DryRunOptions): DryRunRequest {
  return { kind: 'dry', disableBail, coverageAnalysis, budget: DRY_RUN_BUDGET };
}

export function mutantRunRequest(
  {
    activeMutant,
    testFilter,
    hitLimit,
    disableBail,
    timeout,
  }: MutantRunOptions,
  session: {
    readonly serialGroups: Map<string, string[]>;
    readonly timeouts: ConfigTimeouts;
  },
): MutantRunRequest {
  return {
    kind: 'mutant',
    disableBail,
    activeMutant: activeMutant.id,
    testFilter: withSerialGroups(testFilter, session.serialGroups),
    hitLimit,
    budget: mutantRunBudget(timeout, session.timeouts),
  };
}

/** What the hook needs to know about this run. */
export function runSettings(request: RunRequest, outDir: string): RunSettings {
  return request.kind === 'dry'
    ? { outDir, perTest: request.coverageAnalysis === 'perTest' }
    : { outDir, perTest: false, hitLimit: request.hitLimit };
}

/**
 * A failed attempt may come from a server that died during the run. Never after the deadline: the
 * stopped test counts as failed, and the budget is spent.
 */
export function mayHaveLostItsServer(output: RunOutput): boolean {
  return output.status !== 'deadline' && output.reporter.anyAttemptFailed();
}

export function toRunResult(output: RunOutput, request: RunRequest): RunResult {
  const { status, reporter, snapshots, hookInstalled } = output;
  const isMutantRun = request.kind === 'mutant';
  const testCases = [...reporter.testCases.values()];
  const tests = testCases.map((test) => toTestResult(test, isMutantRun));
  // An attempt that failed on its own kills the mutant even when another attempt, or another test,
  // timed out. The test a deadline stop interrupts ends as skipped, so it is no kill.
  const reason = timeoutReason({
    mutantRun: isMutantRun,
    killed: testCases.some((test) =>
      test.results.some(
        (result) =>
          result.status !== test.expectedStatus &&
          (result.status === 'failed' || result.status === 'passed'),
      ),
    ),
    testTimedOut: testCases.some((test) =>
      test.results.some((result) => result.status === 'timedOut'),
    ),
    stoppedAtDeadline: status === 'deadline',
  });

  if (status === 'interrupted') {
    return {
      status: DryRunStatus.Error,
      errorMessage: 'The Playwright run was interrupted',
    };
  }

  // Before the empty-run rules: a stop during the config load leaves no tests at all.
  if (status === 'deadline' && reason) {
    return { status: DryRunStatus.Timeout, reason };
  }

  const failed = tests.some((test) => test.status === TestStatus.Failed);

  if (reporter.errors.length && !failed) {
    return {
      status: DryRunStatus.Error,
      errorMessage: reporter.errors.join('\n'),
    };
  }

  // Playwright catches its own internal errors, prints them, and fails the run without reporting them.
  if (status === 'failed' && tests.length === 0) {
    return {
      status: DryRunStatus.Error,
      errorMessage:
        'Playwright failed without running a test; rerun Stryker with --logLevel trace to see its error.',
    };
  }

  if (tests.length === 0) {
    return emptyRunResult(request);
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

  if (reason) {
    return { status: DryRunStatus.Timeout, reason };
  }

  return { status: DryRunStatus.Complete, tests, snapshots };
}

export function missingCoverageError(
  tests: readonly TestResult[],
  snapshots: readonly Snapshot[],
): string | undefined {
  const ran = tests.some((test) => test.status !== TestStatus.Skipped);
  const failed = tests.some((test) => test.status === TestStatus.Failed);

  if (!ran || failed || snapshots.some((snapshot) => snapshot.coverage)) {
    return undefined;
  }

  if (snapshots.length === 0) {
    return 'Tests ran, but no instrumented code ran, neither in a page nor in a Playwright worker. The dry run needs at least one test that runs the app code, in a page or by importing it.';
  }

  const lost = snapshots.filter((snapshot) => snapshot.lost).length;

  if (lost === snapshots.length && lost > 0) {
    return `No page reported coverage: all ${lost} frame(s) did not answer before their context closed.`;
  }

  return 'No page loaded instrumented code. Is the webServer serving the Stryker sandbox? A server that was already running (reuseExistingServer) serves the original sources.';
}

// The output maps have no prototype, so a test id such as __proto__ from a page stays an own key.
export function mergeCoverage(snapshots: readonly Snapshot[]): MutantCoverage {
  const merged: MutantCoverage = {
    static: Object.create(null),
    perTest: Object.create(null),
  };
  const add = (
    target: Record<string, number>,
    hits: Record<string, number>,
  ) => {
    for (const [mutantId, count] of Object.entries(hits)) {
      target[mutantId] = (target[mutantId] ?? 0) + count;
    }
  };

  for (const { coverage, outlivedItsTest } of snapshots) {
    if (!coverage) {
      continue;
    }

    add(merged.static, coverage.static);

    for (const [testId, hits] of Object.entries(coverage.perTest)) {
      add(
        outlivedItsTest
          ? merged.static
          : (merged.perTest[testId] ??= Object.create(null)),
        hits,
      );
    }
  }

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

export function sumHitCounts(snapshots: readonly Snapshot[]): number {
  return snapshots.reduce((sum, { hitCount }) => sum + hitCount, 0);
}

/**
 * The missing-coverage check runs with coverage off too. `gaps` is set only when coverage was merged,
 * for the shell to log.
 */
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
    return {
      result: { status: DryRunStatus.Error, errorMessage },
      gaps: undefined,
    };
  }

  if (request.coverageAnalysis === 'off') {
    return { result: { status, tests }, gaps: undefined };
  }

  return {
    result: { status, tests, mutantCoverage: mergeCoverage(snapshots) },
    gaps: coverageGaps(snapshots),
  };
}

/**
 * The hit limit outranks every other result, and the count is summed on every status: a limit that a
 * test file trips while it loads leaves a run without tests, which would otherwise be an Error.
 */
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
    return {
      status: DryRunStatus.Error,
      errorMessage: `None of the ${request.testFilter.length} selected tests ran; their Playwright test ids no longer match.`,
    };
  }

  return {
    status: DryRunStatus.Error,
    errorMessage: 'Playwright ran no tests.',
  };
}

function toTestResult(test: TestCase, isMutantRun: boolean): TestResult {
  const titles = test.titlePath().slice(1).filter(Boolean);
  const last = test.results.at(-1);
  const outcome = test.outcome();
  // A test that passes only on a retry still failed against the mutant. Retries reach mutant runs
  // through describe.configure({ retries }), which outranks the retries: 0 that Playwright's
  // runTests sets.
  const status =
    outcome === 'flaky' && isMutantRun ? TestStatus.Failed : OUTCOME[outcome];
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

function errorText(error: TestError | undefined): string {
  return error?.message ?? error?.value ?? 'Test failed';
}
