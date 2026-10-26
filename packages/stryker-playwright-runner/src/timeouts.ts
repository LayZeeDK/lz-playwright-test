// Every timeout decision the runner makes.
import { FRAME_READ_TIMEOUT_MS } from './protocol.ts';

/** Config load and worker start before the first test, measured at about 2.7 s. */
export const RUN_START_MS = 3000;
/**
 * What the runner needs after the last test ends and before Stryker's timer fires: the hook's read of a
 * hung frame plus the context close and the worker exit. The same teardown follows a per-test timeout
 * and a deadline stop, so one value serves both.
 */
export const STOP_HEADROOM_MS = FRAME_READ_TIMEOUT_MS;
/** Room for a timed-out test to end before Stryker's timer fires. */
export const TEST_TIMEOUT_HEADROOM_MS = RUN_START_MS + STOP_HEADROOM_MS;
/** Below this, real tests cannot finish, so Stryker's own timer ends the run instead. */
export const MIN_TEST_TIMEOUT_MS = 2000;
/** Playwright's default expect.timeout. */
export const DEFAULT_EXPECT_TIMEOUT_MS = 5000;

/** What the Playwright config says about time. */
export interface ConfigTimeouts {
  /** The largest project timeout; Infinity when any project has none (0) or there are no projects. */
  readonly testTimeoutCap: number;
  /** The largest expect.timeout over the projects. */
  readonly expectTimeout: number;
}

// Every project, setup dependencies included: the one timeout override applies to all that run.
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

/**
 * A killed test fails only after its auto-waiting assertion gives up, but Stryker sizes its timeout from
 * passing tests, so a short timeoutMS turns kills into timeouts.
 */
export function assertionTimeoutWarning(
  config: ConfigTimeouts,
  strykerTimeoutMS: number,
): string | undefined {
  const needed = config.expectTimeout * 2;

  return strykerTimeoutMS < needed
    ? `timeoutMS (${strykerTimeoutMS}) is below twice the Playwright expect timeout (${config.expectTimeout}); killed mutants may be reported as timeouts. Set timeoutMS to at least ${needed}.`
    : undefined;
}

/** The time a run may take. Both undefined for the dry run, which keeps the config's timeouts. */
export interface RunBudget {
  /** Playwright's per-test `timeout` override. */
  readonly testTimeout: number | undefined;
  /** Milliseconds after the run starts at which the runner stops it. */
  readonly deadlineMs: number | undefined;
}

export const DRY_RUN_BUDGET: RunBudget = {
  testTimeout: undefined,
  deadlineMs: undefined,
};

/**
 * The deadline is undefined when it would leave less than RUN_START_MS + MIN_TEST_TIMEOUT_MS: a stop
 * before any test can finish would report Timeout, which Stryker counts as detected. Because
 * TEST_TIMEOUT_HEADROOM_MS = RUN_START_MS + STOP_HEADROOM_MS, deadlineMs >= RUN_START_MS + testTimeout
 * whenever the cap does not apply, so a test that starts on time ends through its own timeout and the
 * deadline only catches one that raised its timeout or started late.
 */
export function mutantRunBudget(
  strykerTimeout: number,
  config: ConfigTimeouts,
): RunBudget {
  const deadlineMs = strykerTimeout - STOP_HEADROOM_MS;

  return {
    testTimeout: Math.min(
      Math.max(strykerTimeout - TEST_TIMEOUT_HEADROOM_MS, MIN_TEST_TIMEOUT_MS),
      config.testTimeoutCap,
    ),
    deadlineMs:
      deadlineMs < RUN_START_MS + MIN_TEST_TIMEOUT_MS ? undefined : deadlineMs,
  };
}

/** The facts about a finished run that decide whether it is a Timeout. */
export interface TimeoutFacts {
  readonly mutantRun: boolean;
  /** Some attempt failed or passed against its expected status. */
  readonly killed: boolean;
  /** Some attempt hit its per-test timeout. */
  readonly testTimedOut: boolean;
}

/**
 * The reason the run is a Timeout, or undefined. A kill outranks a timeout; the dry run reports a
 * timed-out test as the failed test it is.
 */
export function timeoutReason(facts: TimeoutFacts): string | undefined {
  if (facts.killed) {
    return undefined;
  }

  return facts.mutantRun && facts.testTimedOut
    ? 'A test hit its timeout'
    : undefined;
}
