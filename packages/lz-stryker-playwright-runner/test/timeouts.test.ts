import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';

import {
  armDeadline,
  assertionTimeoutWarning,
  configTimeouts,
  defaultExpectTimeoutMs,
  minTestTimeoutMs,
  mutantRunBudget,
  runStartMs,
  stopHeadroomMs,
  stopRetryMs,
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
  assert.deepEqual(configTimeouts([]), {
    testTimeoutCap: Infinity,
    expectTimeout: defaultExpectTimeoutMs,
  });
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
    defaultExpectTimeoutMs,
  );
});

test('the assertion warning fires below the expect timeout plus the run start and stop headroom', () => {
  const config = { testTimeoutCap: Infinity, expectTimeout: 5000 };

  assert.equal(
    assertionTimeoutWarning(config, 10_599),
    "timeoutMS (10599) is below the Playwright expect timeout (5000) plus the runner's 5600 ms to start and stop a run; killed mutants may be reported as timeouts. Set timeoutMS to at least 10600.",
  );
  assert.equal(assertionTimeoutWarning(config, 10_600), undefined);
});

test('at the lowest timeoutMS the warning accepts, a test gets the whole expect timeout with no Stryker overhead', () => {
  const config = { testTimeoutCap: Infinity, expectTimeout: 5000 };
  const lowest = config.expectTimeout + runStartMs + stopHeadroomMs;

  assert.equal(assertionTimeoutWarning(config, lowest), undefined);
  assert.equal(
    mutantRunBudget(lowest, config).testTimeout,
    config.expectTimeout,
  );
});

test('a mutant run gets the timeout less the headroom as its test timeout, and a deadline', () => {
  assert.deepEqual(mutantRunBudget(8000, uncapped), {
    testTimeout: 2400,
    deadlineMs: 5400,
  });
});

test('the test timeout keeps its floor and the config cap', () => {
  assert.equal(mutantRunBudget(6000, uncapped).testTimeout, minTestTimeoutMs);
  assert.equal(
    mutantRunBudget(60_000, { ...uncapped, testTimeoutCap: 10_000 })
      .testTimeout,
    10_000,
  );
});

test('no deadline when it would leave too little time for a test to finish', () => {
  const shortest = runStartMs + minTestTimeoutMs;

  assert.equal(mutantRunBudget(4500, uncapped).deadlineMs, undefined);
  assert.equal(
    mutantRunBudget(shortest + stopHeadroomMs - 1, uncapped).deadlineMs,
    undefined,
  );
  assert.equal(
    mutantRunBudget(shortest + stopHeadroomMs, uncapped).deadlineMs,
    shortest,
  );
});

test('the deadline never comes before a test that starts on time hits its own timeout', () => {
  for (let timeout = 4500; timeout <= 60_000; timeout += 250) {
    const { testTimeout, deadlineMs } = mutantRunBudget(timeout, uncapped);

    if (deadlineMs !== undefined) {
      assert.ok(
        deadlineMs >= runStartMs + (testTimeout ?? 0),
        `timeout ${timeout}: deadline ${deadlineMs}, test timeout ${testTimeout}`,
      );
    }
  }
});

const noTimeout = {
  mutantRun: true,
  killed: false,
  testTimedOut: false,
  stoppedAtDeadline: false,
};

test('a kill outranks a per-test timeout, which counts only in a mutant run', () => {
  assert.equal(
    timeoutReason({ ...noTimeout, killed: true, testTimedOut: true }),
    undefined,
  );
  assert.equal(
    timeoutReason({ ...noTimeout, testTimedOut: true }),
    'A test hit its timeout',
  );
  assert.equal(
    timeoutReason({ ...noTimeout, mutantRun: false, testTimedOut: true }),
    undefined,
  );
  assert.equal(timeoutReason(noTimeout), undefined);
});

test('a deadline stop is a Timeout in either run kind, unless a test killed the mutant', () => {
  const reason =
    "The run reached the runner's deadline before Stryker's timeout";

  assert.equal(
    timeoutReason({ ...noTimeout, stoppedAtDeadline: true }),
    reason,
  );
  assert.equal(
    timeoutReason({ ...noTimeout, mutantRun: false, stoppedAtDeadline: true }),
    reason,
  );
  assert.equal(
    timeoutReason({
      ...noTimeout,
      stoppedAtDeadline: true,
      testTimedOut: true,
    }),
    reason,
  );
  assert.equal(
    timeoutReason({ ...noTimeout, stoppedAtDeadline: true, killed: true }),
    undefined,
  );
});

// A deadline over a fake clock that the mocked timers move.
function armed(t: TestContext, at: number | undefined) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let clock = 0;
  const calls: number[] = [];
  const deadline = armDeadline(
    at,
    async () => {
      calls.push(clock);
    },
    () => clock,
  );
  const tick = (ms: number) => {
    clock += ms;
    t.mock.timers.tick(ms);
  };

  return { deadline, calls, tick };
}

test('a deadline calls stop when it passes, and not before', (t) => {
  const { deadline, calls, tick } = armed(t, 6000);

  tick(5999);

  assert.deepEqual(calls, []);
  assert.equal(deadline.firedAt, undefined);

  tick(1);

  assert.deepEqual(calls, [6000]);
  assert.equal(deadline.firedAt, 6000);
  deadline.disarm();
});

test('a deadline repeats stop until it is disarmed, since Playwright ignores it during config load', (t) => {
  const { deadline, calls, tick } = armed(t, 1000);

  tick(1000);
  tick(stopRetryMs - 1);

  assert.deepEqual(calls, [1000]);

  tick(1);
  tick(stopRetryMs);
  deadline.disarm();
  tick(stopRetryMs * 10);

  assert.deepEqual(calls, [1000, 1100, 1200]);
});

test('a deadline disarmed before it passes never calls stop', (t) => {
  const { deadline, calls, tick } = armed(t, 1000);

  deadline.disarm();
  tick(5000);

  assert.deepEqual(calls, []);
  assert.equal(deadline.firedAt, undefined);
});

test('no deadline never calls stop', (t) => {
  const { deadline, calls, tick } = armed(t, undefined);

  tick(2 ** 31);

  assert.deepEqual(calls, []);
  assert.equal(deadline.firedAt, undefined);
  deadline.disarm();
});

test('a deadline further off than setTimeout can wait is clamped, not fired at once', (t) => {
  const { deadline, calls, tick } = armed(t, 2 ** 33);

  tick(1);

  assert.deepEqual(calls, []);

  tick(2 ** 31 - 2);

  assert.equal(calls.length, 1);
  deadline.disarm();
});
