import type {
  FullConfig,
  TestCase,
  TestError,
  TestResult,
} from '@playwright/test/reporter';

import { raiseRetries } from './playwright-internals.ts';

export interface ReportedAttempt {
  readonly status: TestResult['status'];
  readonly startTime?: Date | undefined;
  readonly duration: number;
  readonly error?: TestError | undefined;
  readonly attachments: readonly Pick<
    TestResult['attachments'][number],
    'name' | 'path'
  >[];
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

export interface TestWindow {
  readonly testId: string;
  readonly start: number;
  readonly end: number;
}

export class LzPlaywrightCollectingReporter {
  readonly errors: string[] = [];
  retriesNotRaised: string | undefined;
  failOnFlakyTests = false;
  outputTail = '';
  // Playwright reports each attempt of a retried test with the same TestCase, which holds them all.
  readonly testCases = new Map<string, ReportedTest>();
  readonly windows: TestWindow[] = [];
  readonly #retriesByProject: ReadonlyMap<string, number>;
  readonly #now: () => number;
  #suite: ReportedSuite | undefined;

  constructor(
    retriesByProject: ReadonlyMap<string, number> = new Map(),
    now: () => number = Date.now,
  ) {
    this.#retriesByProject = retriesByProject;
    this.#now = now;
  }

  printsToStdio() {
    return false;
  }

  onBegin(
    { failOnFlakyTests }: Pick<FullConfig, 'failOnFlakyTests'>,
    suite: ReportedSuite,
  ) {
    this.failOnFlakyTests = failOnFlakyTests;
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
    const startTime = test.results.at(-1)?.startTime;

    if (startTime !== undefined) {
      this.windows.push({
        testId: test.id,
        start: startTime.getTime(),
        end: this.#now(),
      });
    }
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
