import type {
  FullResult,
  Suite,
  TestCase,
  TestError,
} from '@playwright/test/reporter';
import type { MutantCoverage } from '@stryker-mutator/api/core';
import {
  type DryRunOptions,
  type DryRunResult,
  DryRunStatus,
  type TestResult,
  TestStatus,
} from '@stryker-mutator/api/test-runner';

import { parallelModeOf, type TestRunner } from './playwright-internals.ts';
import type { Snapshot } from './protocol.ts';

type CoverageAnalysis = DryRunOptions['coverageAnalysis'];

export type RunResult =
  | {
      status: DryRunStatus.Complete;
      tests: TestResult[];
      snapshots: Snapshot[];
    }
  | Exclude<DryRunResult, { status: DryRunStatus.Complete }>;

export interface RunRequest {
  disableBail: boolean;
  coverageAnalysis?: CoverageAnalysis;
  activeMutant?: string;
  testFilter?: string[];
  hitLimit?: number;
  testTimeout?: number;
}

export interface RunOutput {
  status: FullResult['status'];
  reporter: CollectingReporter;
  snapshots: Snapshot[];
  hookInstalled: boolean;
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

export function toRunResult(output: RunOutput, request: RunRequest): RunResult {
  const { status, reporter, snapshots, hookInstalled } = output;
  const isMutantRun = request.activeMutant !== undefined;
  const testCases = [...reporter.testCases.values()];
  const tests = testCases.map((test) => toTestResult(test, isMutantRun));

  if (status === 'interrupted') {
    return {
      status: DryRunStatus.Error,
      errorMessage: 'The Playwright run was interrupted',
    };
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

  // An attempt that failed on its own kills the mutant even when another attempt, or another test,
  // timed out. The dry run reports a timed-out test as the failure it is.
  const killed = testCases.some((test) =>
    test.results.some(
      (result) =>
        result.status !== test.expectedStatus &&
        (result.status === 'failed' || result.status === 'passed'),
    ),
  );
  const timedOut = testCases.some((test) =>
    test.results.some((result) => result.status === 'timedOut'),
  );

  if (isMutantRun && timedOut && !killed) {
    return {
      status: DryRunStatus.Timeout,
      reason: 'A test hit its timeout',
    };
  }

  return { status: DryRunStatus.Complete, tests, snapshots };
}

export function missingCoverageError(
  tests: TestResult[],
  snapshots: Snapshot[],
): string | undefined {
  const ran = tests.some((test) => test.status !== TestStatus.Skipped);
  const failed = tests.some((test) => test.status === TestStatus.Failed);

  if (!ran || failed || snapshots.some((snapshot) => snapshot.mutantCoverage)) {
    return undefined;
  }

  if (snapshots.length === 0) {
    return 'Tests ran, but none opened a page, so no page loaded instrumented code. The dry run needs at least one test that loads the app in a page.';
  }

  const lost = snapshots.filter((snapshot) => snapshot.lost).length;

  if (lost === snapshots.length && lost > 0) {
    return `No page reported coverage: all ${lost} frame(s) did not answer before their context closed.`;
  }

  return 'No page loaded instrumented code. Is the webServer serving the Stryker sandbox? A server that was already running (reuseExistingServer) serves the original sources.';
}

export function isHitCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

// Coverage comes from pages, so a key such as __proto__ or a count that is not a hit count must not
// reach the merged object.
export function mergeCoverage(snapshots: Snapshot[]): MutantCoverage {
  const coverage: MutantCoverage = {
    static: Object.create(null),
    perTest: Object.create(null),
  };
  const add = (
    target: Record<string, number>,
    hits: Record<string, number> | null | undefined,
  ) => {
    for (const [mutantId, count] of Object.entries(hits ?? {})) {
      if (isHitCount(count)) {
        target[mutantId] = (target[mutantId] ?? 0) + count;
      }
    }
  };
  const perTestTarget = (snapshot: Snapshot, testId: string) =>
    snapshot.outlivedItsTest
      ? coverage.static
      : (coverage.perTest[testId] ??= Object.create(null));

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

function emptyRunResult(request: RunRequest): RunResult {
  if (request.testFilter?.length) {
    return {
      status: DryRunStatus.Error,
      errorMessage: `None of the ${request.testFilter.length} selected tests ran; their Playwright test ids no longer match.`,
    };
  }

  // Stryker fails an empty dry run itself unless allowEmpty is set.
  if (request.activeMutant === undefined) {
    return { status: DryRunStatus.Complete, tests: [], snapshots: [] };
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
