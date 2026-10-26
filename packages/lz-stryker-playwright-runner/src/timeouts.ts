import { FRAME_READ_TIMEOUT_MS } from './protocol.ts';

// Config load and worker start before the first test, measured at about 2.7 s.
export const RUN_START_MS = 3000;
// A deadline stop measured 2078-2096 ms in 8 of 9 runs: the hung frame's read plus context close and worker exit.
export const STOP_HEADROOM_MS = FRAME_READ_TIMEOUT_MS + 600;
export const MIN_TEST_TIMEOUT_MS = 2000;
export const STOP_RETRY_MS = 100;
// Playwright's default expect.timeout.
export const DEFAULT_EXPECT_TIMEOUT_MS = 5000;

export interface ConfigTimeouts {
  readonly testTimeoutCap: number;
  readonly expectTimeout: number;
}

export function configTimeouts(
  projects: readonly {
    expect?: { timeout?: number };
    project: { timeout: number };
  }[],
): ConfigTimeouts {
  const timeouts = projects.map(({ project }) => project.timeout);
  const expectTimeouts = projects.map(
    ({ expect }) => expect?.timeout ?? DEFAULT_EXPECT_TIMEOUT_MS,
  );

  return {
    testTimeoutCap:
      timeouts.length === 0 || timeouts.includes(0)
        ? Infinity
        : Math.max(...timeouts),
    expectTimeout: expectTimeouts.length
      ? Math.max(...expectTimeouts)
      : DEFAULT_EXPECT_TIMEOUT_MS,
  };
}

export function assertionTimeoutWarning(
  config: ConfigTimeouts,
  strykerTimeoutMS: number,
): string | undefined {
  const needed = config.expectTimeout * 2;

  return strykerTimeoutMS < needed
    ? `timeoutMS (${strykerTimeoutMS}) is below twice the Playwright expect timeout (${config.expectTimeout}); killed mutants may be reported as timeouts. Set timeoutMS to at least ${needed}.`
    : undefined;
}

export interface RunBudget {
  readonly testTimeout: number | undefined;
  readonly deadlineMs: number | undefined;
}

export const DRY_RUN_BUDGET: RunBudget = {
  testTimeout: undefined,
  deadlineMs: undefined,
};

export function mutantRunBudget(
  strykerTimeout: number,
  config: ConfigTimeouts,
): RunBudget {
  const deadlineMs = strykerTimeout - STOP_HEADROOM_MS;
  const testRoomMs = deadlineMs - RUN_START_MS;

  return {
    testTimeout: Math.min(
      Math.max(testRoomMs, MIN_TEST_TIMEOUT_MS),
      config.testTimeoutCap,
    ),
    deadlineMs: testRoomMs < MIN_TEST_TIMEOUT_MS ? undefined : deadlineMs,
  };
}

export interface TimeoutFacts {
  readonly mutantRun: boolean;
  readonly killed: boolean;
  readonly testTimedOut: boolean;
  readonly stoppedAtDeadline: boolean;
}

export function timeoutReason(facts: TimeoutFacts): string | undefined {
  if (facts.killed) {
    return undefined;
  }

  if (facts.stoppedAtDeadline) {
    return "The run reached the runner's deadline before Stryker's timeout";
  }

  return facts.mutantRun && facts.testTimedOut
    ? 'A test hit its timeout'
    : undefined;
}

export interface ArmedDeadline {
  readonly firedAt: number | undefined;
  disarm(): void;
}

// setTimeout fires at once for a longer delay.
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

// Playwright's stopTests() does nothing while runTests is still loading the config, and a second call
// is harmless.
export function armDeadline(
  at: number | undefined,
  stop: () => Promise<void>,
  now: () => number = () => performance.now(),
): ArmedDeadline {
  if (at === undefined) {
    return { firedAt: undefined, disarm: () => undefined };
  }

  let firedAt: number | undefined;
  let retry: NodeJS.Timeout | undefined;
  const call = () => void stop().catch(() => undefined);
  const timer = setTimeout(
    () => {
      firedAt = now();
      call();
      retry = setInterval(call, STOP_RETRY_MS);
    },
    Math.min(Math.max(0, at - now()), MAX_TIMER_DELAY_MS),
  );

  return {
    get firedAt() {
      return firedAt;
    },
    disarm() {
      clearTimeout(timer);
      clearInterval(retry);
    },
  };
}
