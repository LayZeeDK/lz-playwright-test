import { frameReadTimeoutMs } from './protocol.ts';

// Config load and worker start before the first test, measured at about 2.7 s.
export const runStartMs = 3000;
// A deadline stop measured 2078-2096 ms in 8 of 9 runs: the hung frame's read plus context close and worker exit.
export const stopHeadroomMs = frameReadTimeoutMs + 600;
export const minTestTimeoutMs = 2000;
export const stopRetryMs = 100;
// Playwright's default expect.timeout.
export const defaultExpectTimeoutMs = 5000;

export interface ConfigTimeouts {
  readonly testTimeoutCap: number;
  readonly expectTimeout: number;
}

export function configTimeouts(
  projects: readonly {
    expect?: { timeout?: number | undefined } | undefined;
    project: { timeout: number };
  }[],
): ConfigTimeouts {
  if (projects.length === 0) {
    return {
      testTimeoutCap: Infinity,
      expectTimeout: defaultExpectTimeoutMs,
    };
  }

  const timeouts = projects.map(({ project }) => project.timeout);
  const expectTimeouts = projects.map(
    ({ expect }) => expect?.timeout ?? defaultExpectTimeoutMs,
  );

  return {
    testTimeoutCap: timeouts.includes(0) ? Infinity : Math.max(...timeouts),
    expectTimeout: Math.max(...expectTimeouts),
  };
}

export function assertionTimeoutWarning(
  config: ConfigTimeouts,
  strykerTimeoutMS: number,
): string | undefined {
  // Stryker measures no start overhead when tests run on more than one Playwright worker.
  const runHeadroomMs = runStartMs + stopHeadroomMs;
  const needed = config.expectTimeout + runHeadroomMs;

  return strykerTimeoutMS < needed
    ? `timeoutMS (${strykerTimeoutMS}) is below the Playwright expect timeout (${config.expectTimeout}) plus the runner's ${runHeadroomMs} ms to start and stop a run; killed mutants may be reported as timeouts. Set timeoutMS to at least ${needed}.`
    : undefined;
}

export interface RunBudget {
  readonly testTimeout: number | undefined;
  readonly deadlineMs: number | undefined;
}

export const dryRunBudget: RunBudget = {
  testTimeout: undefined,
  deadlineMs: undefined,
};

export function mutantRunBudget(
  strykerTimeout: number,
  config: ConfigTimeouts,
): RunBudget {
  const deadlineMs = strykerTimeout - stopHeadroomMs;
  const testRoomMs = deadlineMs - runStartMs;

  return {
    testTimeout: Math.min(
      Math.max(testRoomMs, minTestTimeoutMs),
      config.testTimeoutCap,
    ),
    deadlineMs: testRoomMs < minTestTimeoutMs ? undefined : deadlineMs,
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
const maxTimerDelayMs = 2 ** 31 - 1;

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
      retry = setInterval(call, stopRetryMs);
    },
    Math.min(Math.max(0, at - now()), maxTimerDelayMs),
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
