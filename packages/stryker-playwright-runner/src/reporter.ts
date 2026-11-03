import type {
  TestCase,
  TestError,
  TestResult,
} from '@playwright/test/reporter';

import { raiseRetries } from './playwright-internals.ts';

export interface ReportedAttempt {
  readonly status: TestResult['status'];
  readonly duration: number;
  readonly error?: TestError | undefined;
}

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

export class LzPlaywrightCollectingReporter {
  readonly errors: string[] = [];
  retriesNotRaised: string | undefined;
  outputTail = '';
  // Playwright reports each attempt of a retried test with the same TestCase, which holds them all.
  readonly testCases = new Map<string, ReportedTest>();
  readonly #retriesByProject: ReadonlyMap<string, number>;
  #suite: ReportedSuite | undefined;

  constructor(retriesByProject: ReadonlyMap<string, number> = new Map()) {
    this.#retriesByProject = retriesByProject;
  }

  printsToStdio() {
    return false;
  }

  onBegin(_config: unknown, suite: ReportedSuite) {
    this.#suite = suite;

    if ([...this.#retriesByProject.values()].some(Boolean)) {
      try {
        raiseRetries(suite, this.#retriesByProject);
      } catch (error) {
        this.retriesNotRaised = String(error);
      }
    }
  }

  get listedTests(): readonly ReportedTest[] {
    return this.#suite?.allTests() ?? [];
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
