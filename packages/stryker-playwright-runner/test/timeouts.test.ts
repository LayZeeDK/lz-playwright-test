import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertionTimeoutWarning,
  configTimeouts,
  DEFAULT_EXPECT_TIMEOUT_MS,
  MIN_TEST_TIMEOUT_MS,
  mutantRunBudget,
  RUN_START_MS,
  timeoutReason,
} from '../src/timeouts.ts';

const uncapped = { testTimeoutCap: Infinity, expectTimeout: 1000 };

test('the config cap is the largest project timeout, and Infinity when a project has none', () => {
  assert.equal(
    configTimeouts([
      { project: { timeout: 30_000 } },
      { project: { timeout: 10_000 } },
    ]).testTimeoutCap,
    30_000,
  );
  assert.equal(
    configTimeouts([
      { project: { timeout: 30_000 } },
      { project: { timeout: 0 } },
    ]).testTimeoutCap,
    Infinity,
  );
  assert.equal(configTimeouts([]).testTimeoutCap, Infinity);
});

test('the expect timeout is the largest over the projects, with Playwright default where unset', () => {
  assert.equal(
    configTimeouts([
      { expect: { timeout: 1000 }, project: { timeout: 1 } },
      { expect: { timeout: 3000 }, project: { timeout: 1 } },
    ]).expectTimeout,
    3000,
  );
  assert.equal(
    configTimeouts([
      { expect: { timeout: 1000 }, project: { timeout: 1 } },
      { project: { timeout: 1 } },
    ]).expectTimeout,
    DEFAULT_EXPECT_TIMEOUT_MS,
  );
});

test('the assertion warning fires below twice the expect timeout', () => {
  const config = { testTimeoutCap: Infinity, expectTimeout: 5000 };

  assert.equal(
    assertionTimeoutWarning(config, 9999),
    'timeoutMS (9999) is below twice the Playwright expect timeout (5000); killed mutants may be reported as timeouts. Set timeoutMS to at least 10000.',
  );
  assert.equal(assertionTimeoutWarning(config, 10_000), undefined);
});

test('a mutant run gets the timeout less the headroom as its test timeout, and a deadline', () => {
  assert.deepEqual(mutantRunBudget(8000, uncapped), {
    testTimeout: 3000,
    deadlineMs: 6000,
  });
});

test('the test timeout keeps its floor and the config cap', () => {
  assert.equal(
    mutantRunBudget(6000, uncapped).testTimeout,
    MIN_TEST_TIMEOUT_MS,
  );
  assert.equal(
    mutantRunBudget(60_000, { ...uncapped, testTimeoutCap: 10_000 })
      .testTimeout,
    10_000,
  );
});

test('no deadline when it would leave too little time for a test to finish', () => {
  assert.equal(mutantRunBudget(4500, uncapped).deadlineMs, undefined);
});

test('the deadline never comes before a test that starts on time hits its own timeout', () => {
  for (let timeout = 4500; timeout <= 60_000; timeout += 250) {
    const { testTimeout, deadlineMs } = mutantRunBudget(timeout, uncapped);

    if (deadlineMs !== undefined) {
      assert.ok(
        deadlineMs >= RUN_START_MS + (testTimeout ?? 0),
        `timeout ${timeout}: deadline ${deadlineMs}, test timeout ${testTimeout}`,
      );
    }
  }
});

test('a kill outranks a per-test timeout, which counts only in a mutant run', () => {
  assert.equal(
    timeoutReason({ mutantRun: true, killed: true, testTimedOut: true }),
    undefined,
  );
  assert.equal(
    timeoutReason({ mutantRun: true, killed: false, testTimedOut: true }),
    'A test hit its timeout',
  );
  assert.equal(
    timeoutReason({ mutantRun: false, killed: false, testTimedOut: true }),
    undefined,
  );
  assert.equal(
    timeoutReason({ mutantRun: true, killed: false, testTimedOut: false }),
    undefined,
  );
});
