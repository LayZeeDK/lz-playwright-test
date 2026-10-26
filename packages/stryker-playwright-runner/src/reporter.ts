import type { Suite, TestCase, TestError } from '@playwright/test/reporter';

export class CollectingReporter {
  readonly errors: string[] = [];
  outputTail = '';
  // Playwright reports each attempt of a retried test with the same TestCase, which holds them all.
  readonly testCases = new Map<string, TestCase>();
  private suite?: Pick<Suite, 'allTests'>;

  printsToStdio() {
    return false;
  }

  onBegin(_config: unknown, suite: Pick<Suite, 'allTests'>) {
    this.suite = suite;
  }

  get listedTests(): TestCase[] {
    return this.suite?.allTests() ?? [];
  }

  onTestEnd(test: TestCase) {
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
