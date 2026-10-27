import { createRequire } from 'node:module';

import type { FullResult, Reporter } from '@playwright/test/reporter';

import type { PageSettings } from './worker-hook.ts';

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
export const TEST_RUNNER_METHODS = Object.keys(TEST_RUNNER_METHOD_SET);

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

/** The members of a Playwright Frame the worker hook calls; the page function reads one global. */
export interface HookedFrame {
  evaluate(fn: (name: string) => unknown, name: string): Promise<unknown>;
  isDetached(): boolean;
}

/** The members of a Playwright Page the worker hook calls; it replaces `close`. */
export interface HookedPage {
  frames(): HookedFrame[];
  close(options?: unknown): Promise<void>;
}

/** The members of a Playwright Browser the worker hook calls; it replaces `close`. */
export interface HookedBrowser {
  contexts(): HookedContext[];
  close(options?: unknown): Promise<void>;
}

/** The members of a Playwright BrowserContext the worker hook calls. */
export interface HookedContext {
  pages(): HookedPage[];
  browser(): HookedBrowser | null;
  on(event: 'page', handler: (page: HookedPage) => void): unknown;
  addInitScript(
    script: (settings: PageSettings) => void,
    settings: PageSettings,
  ): Promise<unknown>;
}

export interface Instrumentation {
  addListener(listener: {
    runAfterCreateBrowserContext?(context: HookedContext): Promise<void>;
    runBeforeCloseBrowserContext?(context: HookedContext): Promise<void>;
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

/**
 * Checks each internal the runner calls; what is left unchecked is the signature of the TestRunner
 * methods, which only a run can tell.
 */
export function probeInternals(
  version: string,
  modules: {
    runner: unknown;
    common: unknown;
    coreBundle: unknown;
  },
): Playwright {
  const { runner, common, coreBundle } = modules;
  const testRunner = isRecord(runner) ? runner.testRunner : undefined;
  const TestRunner = isRecord(testRunner) ? testRunner.TestRunner : undefined;
  const configLoader = isRecord(common) ? common.configLoader : undefined;
  const resolveConfigLocation = isRecord(configLoader)
    ? configLoader.resolveConfigLocation
    : undefined;
  const utils = isRecord(coreBundle) ? coreBundle.utils : undefined;
  const isURLAvailable = isRecord(utils) ? utils.isURLAvailable : undefined;

  if (
    !isTestRunnerClass(TestRunner) ||
    typeof resolveConfigLocation !== 'function' ||
    typeof isURLAvailable !== 'function'
  ) {
    throw new Error(
      `Playwright ${version} changed the internals this runner calls (playwright/lib/runner TestRunner with ${TEST_RUNNER_METHODS.join(', ')}; playwright/lib/common configLoader; playwright-core coreBundle isURLAvailable).`,
    );
  }

  return {
    version,
    async createTestRunner(configFile, overrides) {
      const configLocation: unknown = Reflect.apply(
        resolveConfigLocation,
        configLoader,
        [configFile],
      );
      const created = new TestRunner(configLocation, overrides);
      await created.initialize({});

      return created;
    },
    async isURLAvailable(url, ignoreHTTPSErrors) {
      const available: unknown = await Reflect.apply(
        isURLAvailable,
        undefined,
        [url, ignoreHTTPSErrors],
      );

      return available === true;
    },
  };
}

function isTestRunnerClass(
  value: unknown,
): value is RunnerModule['testRunner']['TestRunner'] {
  if (typeof value !== 'function') {
    return false;
  }

  const prototype: unknown = value.prototype;

  return TEST_RUNNER_METHODS.every(
    (method) => isRecord(prototype) && typeof prototype[method] === 'function',
  );
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
  const manifest: unknown = playwrightRequire('./package.json');
  const version = String(isRecord(manifest) ? manifest.version : undefined);

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

/** The instrumentation of the `playwright-core` module a worker loads. */
export function instrumentationOf(core: unknown): Instrumentation {
  const instrumentation = isRecord(core) ? core._instrumentation : undefined;
  const addListener = isRecord(instrumentation)
    ? instrumentation.addListener
    : undefined;

  if (typeof addListener !== 'function') {
    throw new Error(
      'Playwright changed the internals this runner calls (playwright-core _instrumentation.addListener).',
    );
  }

  return {
    addListener(listener) {
      Reflect.apply(addListener, instrumentation, [listener]);
    },
  };
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
