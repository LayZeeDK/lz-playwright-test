// How a finished Playwright run maps to a Stryker result, without a browser.
// Run: node --test packages/stryker-playwright-runner/test/run-result.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  FullResult,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import type { StrykerOptions } from '@stryker-mutator/api/core';
import type { Logger } from '@stryker-mutator/api/logging';
import { DryRunStatus, TestStatus } from '@stryker-mutator/api/test-runner';

import { PlaywrightTestRunner } from '../src/playwright-test-runner.ts';
import {
  CollectingReporter,
  listSerialGroups,
  missingCoverageError,
  projectsThatRun,
  serialGroups,
  toRunResult,
  withSerialGroups,
} from '../src/run-result.ts';

type Outcome = ReturnType<TestCase['outcome']>;

// Playwright passes the same TestCase for every attempt and appends each attempt to its results.
function attempt(
  reporter: CollectingReporter,
  id: string,
  outcome: Outcome,
  status: TestResult['status'],
  expectedStatus: TestCase['expectedStatus'] = 'passed',
) {
  const testCase =
    reporter.testCases.get(id) ??
    ({
      id,
      expectedStatus,
      results: [],
      titlePath: () => ['', 'e2e', 'app.spec.ts', id],
      location: { file: 'app.spec.ts', line: 1, column: 1 },
    } as unknown as TestCase);
  testCase.results.push({
    status,
    duration: 10,
    error: status === 'passed' ? undefined : { message: `${id} ${status}` },
  } as unknown as TestResult);
  Object.assign(testCase, { outcome: () => outcome });
  reporter.onTestEnd(testCase);
}

function classify(
  reporter: CollectingReporter,
  {
    status = 'failed',
    mutant = true,
    hookInstalled = true,
    testFilter,
  }: {
    status?: FullResult['status'];
    mutant?: boolean;
    hookInstalled?: boolean;
    testFilter?: string[];
  } = {},
) {
  return toRunResult(
    { status, reporter, snapshots: [], hookInstalled },
    {
      disableBail: true,
      activeMutant: mutant ? '1' : undefined,
      testFilter,
    },
  );
}

test('a mutant run fails a test that passes only on a retry', () => {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'failed');
  attempt(reporter, 'a', 'flaky', 'passed');

  const result = classify(reporter, { status: 'passed' });

  assert.deepEqual(
    result.status === DryRunStatus.Complete &&
      result.tests.map((t) => [
        t.id,
        t.status,
        t.status === TestStatus.Failed ? t.failureMessage : undefined,
      ]),
    [['a', TestStatus.Failed, 'a failed']],
  );
});

test('the dry run counts a test that passes on a retry as passing', () => {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'failed');
  attempt(reporter, 'a', 'flaky', 'passed');

  const result = classify(reporter, { status: 'passed', mutant: false });

  assert.deepEqual(
    result.status === DryRunStatus.Complete &&
      result.tests.map((t) => t.status),
    [TestStatus.Success],
  );
});

test('a kill outranks a timeout in the same run', () => {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'timedOut');
  attempt(reporter, 'b', 'unexpected', 'failed');

  assert.equal(classify(reporter).status, DryRunStatus.Complete);
});

test('a retried test that fails an assertion kills the mutant even when another attempt timed out', () => {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'timedOut');
  attempt(reporter, 'a', 'unexpected', 'failed');

  assert.equal(classify(reporter).status, DryRunStatus.Complete);
});

test('a timeout alone makes a mutant run a Timeout', () => {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'timedOut');
  attempt(reporter, 'b', 'expected', 'passed');

  assert.equal(classify(reporter).status, DryRunStatus.Timeout);
});

test('a test.fail() test that fails as expected is no kill, so a timeout stays a Timeout', () => {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'timedOut');
  attempt(reporter, 'b', 'expected', 'failed', 'failed');

  assert.equal(classify(reporter).status, DryRunStatus.Timeout);
});

test('the dry run reports a timed-out test as a failed test', () => {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'unexpected', 'timedOut');

  const result = classify(reporter, { mutant: false });

  assert.deepEqual(
    result.status === DryRunStatus.Complete &&
      result.tests.map((t) => t.status),
    [TestStatus.Failed],
  );
});

test('a mutant run without test results is an error, filtered or not', () => {
  assert.equal(
    classify(new CollectingReporter(), {
      status: 'passed',
      testFilter: ['gone'],
    }).status,
    DryRunStatus.Error,
  );
  assert.equal(
    classify(new CollectingReporter(), { status: 'passed' }).status,
    DryRunStatus.Error,
  );
});

test('an unfiltered dry run without tests completes empty, so Stryker applies allowEmpty', () => {
  const result = classify(new CollectingReporter(), {
    status: 'passed',
    mutant: false,
  });

  assert.deepEqual(result, {
    status: DryRunStatus.Complete,
    tests: [],
    snapshots: [],
  });
});

test('a run that Playwright failed without a test or an error is an error, not an empty run', () => {
  const result = classify(new CollectingReporter(), {
    status: 'failed',
    mutant: false,
  });

  assert.deepEqual(result, {
    status: DryRunStatus.Error,
    errorMessage:
      'Playwright failed without running a test; rerun Stryker with --logLevel trace to see its error.',
  });
});

test('a dry run with coverage off still fails when no page loaded instrumented code', async () => {
  const runner = new PlaywrightTestRunner(
    { timeoutMS: 10_000 } as unknown as StrykerOptions,
    {} as Logger,
  );
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'expected', 'passed');
  Object.assign(runner, {
    run: async () => classify(reporter, { status: 'passed', mutant: false }),
  });

  const result = await runner.dryRun({
    timeout: 60_000,
    disableBail: false,
    coverageAnalysis: 'off',
  });

  assert.equal(result.status, DryRunStatus.Error);
});

test('the missing-coverage error names lost frames when every frame was lost', () => {
  const passed = {
    id: 'a',
    name: 'a',
    status: TestStatus.Success,
    timeSpentMs: 10,
  } as const;

  assert.match(
    missingCoverageError([passed], [{ lost: true }, { lost: true }]) ?? '',
    /all 2 frame\(s\) did not answer/,
  );
});

test('a run of skipped tests needs no hook', () => {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'skipped', 'skipped');

  assert.equal(
    classify(reporter, { status: 'passed', hookInstalled: false }).status,
    DryRunStatus.Complete,
  );
});

test('tests that ran without the hook are an error', () => {
  const reporter = new CollectingReporter();
  attempt(reporter, 'a', 'expected', 'passed');

  assert.equal(
    classify(reporter, { status: 'passed', hookInstalled: false }).status,
    DryRunStatus.Error,
  );
});

test('a mutant run selects every test of a describe.serial group, not one test alone', () => {
  const file = { parent: undefined };
  const serial = { _parallelMode: 'serial', parent: file };
  const nestedSerial = { _parallelMode: 'serial', parent: serial };
  const plain = { _parallelMode: 'default', parent: file };
  const testCase = (id: string, parent: object) =>
    ({ id, parent }) as unknown as TestCase;
  const groups = serialGroups([
    testCase('create', serial),
    testCase('edit', nestedSerial),
    testCase('alone', plain),
  ]);

  assert.deepEqual(withSerialGroups(['edit'], groups), ['create', 'edit']);
  assert.deepEqual(withSerialGroups(['alone', 'create'], groups), [
    'alone',
    'create',
    'edit',
  ]);
  assert.equal(withSerialGroups(undefined, groups), undefined);
});

test('serial grouping fails loudly when Playwright suites lose _parallelMode', () => {
  const renamed = { parent: undefined } as unknown as Suite;

  assert.throws(
    () => serialGroups([{ id: 'a', parent: renamed } as unknown as TestCase]),
    { message: /Suite\._parallelMode/ },
  );
});

// Stands in for Playwright's TestRunner: reports the given errors and tests, then resolves to result.
function listing(
  result: { status: FullResult['status'] } | undefined,
  errors: string[] = [],
  tests: TestCase[] = [],
) {
  const calls: string[][] = [];
  const playwright = {
    async listTests(
      reporter: CollectingReporter,
      params: { projects?: string[] },
    ) {
      calls.push(params.projects ?? []);
      errors.forEach((message) => reporter.onError({ message }));
      reporter.onBegin(undefined, {
        allTests: () => tests,
      } as unknown as Suite);

      return result;
    },
  };

  return { playwright, calls };
}

test('without a projects option, listing covers the default projects, which are what a run runs', () => {
  const projects = [
    { default: true, project: { name: 'chromium' } },
    { default: false, project: { name: 'smoke' } },
    { default: true, project: { name: 'setup' } },
  ];

  assert.deepEqual(projectsThatRun(undefined, projects), ['chromium', 'setup']);
  assert.deepEqual(projectsThatRun([], projects), ['chromium', 'setup']);
  assert.deepEqual(projectsThatRun(['smoke'], projects), ['smoke']);
});

test('listing passes the projects to Playwright and groups the describe.serial tests it lists', async () => {
  const serial = { _parallelMode: 'serial', parent: undefined };
  const tests = ['create', 'edit'].map(
    (id) => ({ id, parent: serial }) as unknown as TestCase,
  );
  const { playwright, calls } = listing({ status: 'passed' }, [], tests);

  const groups = await listSerialGroups(playwright, ['chromium']);

  assert.deepEqual(groups.get('edit'), ['create', 'edit']);
  assert.deepEqual(calls, [['chromium']]);
});

test('listing fails when a test file does not load, though the status says passed', async () => {
  const { playwright } = listing({ status: 'passed' }, [
    'SyntaxError in a.spec.ts',
  ]);

  await assert.rejects(listSerialGroups(playwright, []), {
    message: /could not load every test file:\nSyntaxError in a\.spec\.ts/,
  });
});

test('listing fails with the status Playwright reports', async () => {
  const { playwright } = listing({ status: 'failed' }, ['config error']);

  await assert.rejects(listSerialGroups(playwright, []), {
    message: /could not list the tests \(failed\):\nconfig error/,
  });
});

test('listing fails and points at the trace log when Playwright throws', async () => {
  const { playwright } = listing(undefined);

  await assert.rejects(listSerialGroups(playwright, []), {
    message: /--logLevel trace/,
  });
});

test('init refuses --testFiles before it loads the Playwright config', async () => {
  const options = {
    testFiles: ['a.spec.ts'],
    timeoutMS: 10_000,
    playwright: { configFile: 'missing.playwright.config.ts' },
  };
  const runner = new PlaywrightTestRunner(
    options as unknown as StrykerOptions,
    {} as Logger,
  );

  await assert.rejects(runner.init(), { message: /--testFiles/ });
});
