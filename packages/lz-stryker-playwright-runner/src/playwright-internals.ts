import { createRequire } from 'node:module';

import type { BrowserContext } from '@playwright/test';
import type { FullResult, Reporter } from '@playwright/test/reporter';

type Status = FullResult['status'];

export interface RunTestsParams {
  locations: string[];
  testIds?: string[] | undefined;
  projects?: string[] | undefined;
  workers?: number;
  maxFailures?: number | undefined;
  timeout?: number | undefined;
  disableConfigReporters?: boolean;
}

export interface TestRunner {
  initialize(params: Record<string, never>): Promise<void>;
  loadConfig(): Promise<{
    projects: {
      default: boolean;
      expect?: { timeout?: number };
      project: { name: string; timeout: number };
    }[];
    webServers: { url?: string; port?: number; ignoreHTTPSErrors?: boolean }[];
  }>;
  // Resolves to undefined when Playwright throws, after printing the error to stderr.
  listTests(
    reporter: Reporter,
    params: { projects?: string[] },
  ): Promise<{ status: Status } | undefined>;
  runGlobalSetup(reporters: Reporter[]): Promise<{ status: Status }>;
  runGlobalTeardown(): Promise<unknown>;
  runTests(
    reporter: Reporter,
    params: RunTestsParams,
  ): Promise<{ status: Status }>;
  stopTests(): Promise<void>;
}

const TEST_RUNNER_METHOD_SET: Record<keyof TestRunner, true> = {
  initialize: true,
  loadConfig: true,
  listTests: true,
  runGlobalSetup: true,
  runGlobalTeardown: true,
  runTests: true,
  stopTests: true,
};
export const TEST_RUNNER_METHODS = Object.keys(
  TEST_RUNNER_METHOD_SET,
) as (keyof TestRunner)[];

export interface RunnerModule {
  testRunner: {
    TestRunner: new (
      configLocation: unknown,
      overrides: Record<string, unknown>,
    ) => TestRunner;
  };
}

export interface CoreBundleModule {
  utils: {
    isURLAvailable(url: URL, ignoreHTTPSErrors: boolean): Promise<boolean>;
  };
}

export interface CommonModule {
  configLoader: {
    resolveConfigLocation(configFile: string | undefined): unknown;
  };
}

export const MIN_PLAYWRIGHT: {
  readonly major: number;
  readonly minor: number;
} = { major: 1, minor: 63 };

export const WORKER_ENTRY =
  /[\\/]playwright[\\/]lib[\\/]worker[\\/]workerProcessEntry\.js$/;

/**
 * Turns off the aria snapshot Playwright takes of a failed test's page for its error prompt. On a page
 * stuck in a loop it waits out its 5 s timeout and pushes the run past Stryker's.
 */
export const NO_COPY_PROMPT_ENV = 'PLAYWRIGHT_NO_COPY_PROMPT';

export interface Instrumentation {
  addListener(listener: {
    runAfterCreateBrowserContext?(context: BrowserContext): Promise<void>;
    runBeforeCloseBrowserContext?(context: BrowserContext): Promise<void>;
  }): void;
}

export interface Playwright {
  readonly version: string;
  createTestRunner(
    configFile: string | undefined,
    overrides: Record<string, unknown>,
  ): Promise<TestRunner>;
  isURLAvailable: CoreBundleModule['utils']['isURLAvailable'];
}

export function supportsPlaywright(version: string): boolean {
  const [major, minor] = version.split('.').map(Number);

  return major === MIN_PLAYWRIGHT.major && minor >= MIN_PLAYWRIGHT.minor;
}

export function probeInternals(
  version: string,
  modules: {
    runner: Partial<RunnerModule>;
    common: Partial<CommonModule>;
    coreBundle: Partial<CoreBundleModule>;
  },
): Playwright {
  const TestRunner = modules.runner.testRunner?.TestRunner;
  const configLoader = modules.common.configLoader;
  const isURLAvailable = modules.coreBundle.utils?.isURLAvailable;
  const prototype = TestRunner?.prototype as
    | Partial<Record<keyof TestRunner, unknown>>
    | undefined;

  if (
    typeof TestRunner !== 'function' ||
    TEST_RUNNER_METHODS.some(
      (method) => typeof prototype?.[method] !== 'function',
    ) ||
    typeof configLoader?.resolveConfigLocation !== 'function' ||
    typeof isURLAvailable !== 'function'
  ) {
    throw new Error(
      `Playwright ${version} changed the internals this runner calls (playwright/lib/runner TestRunner with ${TEST_RUNNER_METHODS.join(', ')}; playwright/lib/common configLoader; playwright-core coreBundle isURLAvailable).`,
    );
  }

  return {
    version,
    async createTestRunner(configFile, overrides) {
      const runner = new TestRunner(
        configLoader.resolveConfigLocation(configFile),
        overrides,
      );
      await runner.initialize({});

      return runner;
    },
    isURLAvailable,
  };
}

export function loadPlaywright(configFile: string | undefined): Playwright {
  const testRequire = createRequire(
    createRequire(configFile ?? `${process.cwd()}/package.json`).resolve(
      '@playwright/test',
    ),
  );
  // playwright-core is a dependency of playwright, not of @playwright/test, so resolve it from
  // playwright for layouts that do not hoist (pnpm).
  const playwrightRequire = createRequire(
    testRequire.resolve('playwright/package.json'),
  );
  const { version }: { version: string } = playwrightRequire('./package.json');

  if (!supportsPlaywright(version)) {
    throw new Error(
      `The Playwright test runner needs Playwright ${MIN_PLAYWRIGHT.major}.${MIN_PLAYWRIGHT.minor} or a later ${MIN_PLAYWRIGHT.major}.x release, found ${version}.`,
    );
  }

  return probeInternals(version, {
    runner: playwrightRequire('playwright/lib/runner'),
    common: playwrightRequire('playwright/lib/common'),
    coreBundle: playwrightRequire('playwright-core/lib/coreBundle'),
  });
}

export function instrumentationOf(
  playwrightRequire: NodeJS.Require,
): Instrumentation {
  const core: { _instrumentation: Instrumentation } =
    playwrightRequire('playwright-core');

  return core._instrumentation;
}

/** What the timeout manager of Playwright 1.63 and 1.64 runs: the test body, hooks, worker teardown, modifiers. */
const SLOT_TYPES = [
  'test',
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  'teardown',
  'skip',
  'slow',
  'fail',
  'fixme',
] as const;

export type SlotType = (typeof SLOT_TYPES)[number];

export interface RunningSlot {
  readonly type: SlotType;
  /** Whether a fixture of that slot is being set up or torn down. */
  readonly inFixture: boolean;
}

/**
 * What the timeout manager of a TestInfo runs now (TestInfo._timeoutManager._running.runnable).
 * Undefined when there is no TestInfo or its timeout manager runs nothing; throws when a TestInfo has
 * no timeout manager or it runs a type this runner does not know.
 */
export function runningSlotOf(
  testInfo: unknown,
  version: string,
): RunningSlot | undefined {
  if (!isRecord(testInfo)) {
    return undefined;
  }

  const manager = testInfo._timeoutManager;

  if (!isRecord(manager)) {
    throw timeoutManagerChanged(version);
  }

  const running = manager._running;
  const runnable = isRecord(running) ? running.runnable : undefined;

  if (!isRecord(runnable)) {
    return undefined;
  }

  if (!isSlotType(runnable.type)) {
    throw timeoutManagerChanged(version);
  }

  return { type: runnable.type, inFixture: runnable.fixture !== undefined };
}

function timeoutManagerChanged(version: string): Error {
  return new Error(
    `Playwright ${version} changed the internals this runner calls (TestInfo._timeoutManager, which tells a test from the hooks and fixtures that serve a group).`,
  );
}

function isSlotType(value: unknown): value is SlotType {
  return SLOT_TYPES.some((type) => type === value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isSerialSuite(suite: unknown): boolean {
  const mode = isRecord(suite) ? suite._parallelMode : undefined;

  if (typeof mode !== 'string') {
    throw new Error(
      'Playwright suites no longer carry Suite._parallelMode, which this runner reads to keep describe.serial groups together.',
    );
  }

  return mode === 'serial';
}
