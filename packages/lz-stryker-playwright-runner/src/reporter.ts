import type {
  TestCase,
  TestError,
  TestResult,
} from '@playwright/test/reporter';

/** The members of a Playwright TestResult the runner reads. */
export interface ReportedAttempt {
  readonly status: TestResult['status'];
  readonly duration: number;
  readonly error?: TestError | undefined;
}

/** The members of a Playwright TestCase the runner reads; `parent` is its Suite. */
export interface ReportedTest {
  readonly id: string;
  readonly expectedStatus: TestCase['expectedStatus'];
  readonly results: readonly ReportedAttempt[];
  readonly location: Readonly<TestCase['location']>;
  readonly parent: unknown;
  titlePath(): string[];
  outcome(): ReturnType<TestCase['outcome']>;
}

export interface ReportedSuite {
  allTests(): readonly ReportedTest[];
}

export class LzStrykerCollectingReporter {
  readonly errors: string[] = [];
  outputTail = '';
  // Playwright reports each attempt of a retried test with the same TestCase, which holds them all.
  readonly testCases = new Map<string, ReportedTest>();
  private suite?: ReportedSuite;

  printsToStdio() {
    return false;
  }

  onBegin(_config: unknown, suite: ReportedSuite) {
    this.suite = suite;
  }

  get listedTests(): readonly ReportedTest[] {
    return this.suite?.allTests() ?? [];
  }

  onTestEnd(test: ReportedTest) {
    this.testCases.set(test.id, test);
  }

  onStdOut(chunk: string | Buffer) {
    this.outputTail = (this.outputTail + chunk.toString()).slice(-4000);
  }

  onStdErr(chunk: string | Buffer) {
    this.onStdOut(chunk);
  }

  onError(error: TestError) {
    this.errors.push(errorText(error));
  }
}

export function errorText(error: TestError | undefined): string {
  return error?.message ?? error?.value ?? 'Test failed';
}
