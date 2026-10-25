import type {
  FullResult,
  TestCase,
  TestError,
} from '@playwright/test/reporter';
import {
  type DryRunOptions,
  type DryRunResult,
  DryRunStatus,
  type TestResult,
  TestStatus,
} from '@stryker-mutator/api/test-runner';

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

/** Records what Playwright reports. How that maps to a Stryker result is up to `toRunResult`. */
export class CollectingReporter {
  readonly errors: string[] = [];
  // The tail of webServer and global setup output, which carries the reason a server failed to start.
  output = '';
  // Playwright reports each attempt of a retried test with the same TestCase, which holds them all.
  readonly testCases = new Map<string, TestCase>();

  printsToStdio() {
    return false;
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

  if (tests.length === 0) {
    return emptyRunResult(reporter, request);
  }

  const failed = tests.some((test) => test.status === TestStatus.Failed);

  if (reporter.errors.length && !failed) {
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

function emptyRunResult(
  reporter: CollectingReporter,
  request: RunRequest,
): RunResult {
  if (reporter.errors.length) {
    return {
      status: DryRunStatus.Error,
      errorMessage: reporter.errors.join('\n'),
    };
  }

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
  // through describe.configure({ retries }), which outranks the retries: 0 override.
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

export function errorText(error: TestError | undefined): string {
  return error?.message ?? error?.value ?? 'Test failed';
}
