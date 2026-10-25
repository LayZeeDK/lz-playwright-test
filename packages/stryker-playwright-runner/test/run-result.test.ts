// How a finished Playwright run maps to a Stryker result, without a browser.
// Run: node --test packages/stryker-playwright-runner/test/run-result.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  FullResult,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import { DryRunStatus, TestStatus } from '@stryker-mutator/api/test-runner';

import {
  CollectingReporter,
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
    classify(new CollectingReporter(), { testFilter: ['gone'] }).status,
    DryRunStatus.Error,
  );
  assert.equal(classify(new CollectingReporter()).status, DryRunStatus.Error);
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
