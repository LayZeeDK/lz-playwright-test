// Every Playwright internal the runner and the worker hook use. `playwright/lib/runner`,
// `playwright/lib/common`, and `playwright-core/lib/coreBundle` are exported but undocumented, so their
// shape is written down here instead of imported. The hook imports this file into every worker, so its
// only runtime import is node:module (playwright-internals.test.ts checks both).
import { createRequire } from 'node:module';

import type { BrowserContext } from '@playwright/test';
import type { FullResult, Reporter } from '@playwright/test/reporter';

type Status = FullResult['status'];

export interface RunTestsParams {
  locations: string[];
  testIds?: string[];
  projects?: string[];
  workers?: number;
  maxFailures?: number;
  timeout?: number;
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

// The compiler keeps this list and the interface above in step.
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

type ParallelMode = 'none' | 'default' | 'serial' | 'parallel';

export const MIN_PLAYWRIGHT: {
  readonly major: number;
  readonly minor: number;
} = { major: 1, minor: 63 };

/** The entry file of a Playwright worker process; the hook installs only there. */
export const WORKER_ENTRY =
  /[\\/]playwright[\\/]lib[\\/]worker[\\/]workerProcessEntry\.js$/;

/**
 * Turns off the aria snapshot Playwright takes of a failed test's page for its error prompt. On a page
 * stuck in a loop it waits out its 5 s timeout and pushes the run past Stryker's.
 */
export const NO_COPY_PROMPT_ENV = 'PLAYWRIGHT_NO_COPY_PROMPT';

/** `playwright-core`'s client instrumentation, as the hook uses it. */
export interface Instrumentation {
  addListener(listener: {
    runAfterCreateBrowserContext?(context: BrowserContext): Promise<void>;
    runBeforeCloseBrowserContext?(context: BrowserContext): Promise<void>;
  }): void;
}

/** What the runner may do with a probed Playwright install. */
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

  return (
    major > MIN_PLAYWRIGHT.major ||
    (major === MIN_PLAYWRIGHT.major && minor >= MIN_PLAYWRIGHT.minor)
  );
}

/** Checks the three modules and returns the typed `Playwright`, or throws naming every internal. */
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

/**
 * Resolves @playwright/test from the config's folder (or the working directory), then playwright and
 * playwright-core from there, refuses versions below MIN_PLAYWRIGHT, and probes the internals.
 */
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
      `The Playwright test runner needs Playwright ${MIN_PLAYWRIGHT.major}.${MIN_PLAYWRIGHT.minor} or later, found ${version}.`,
    );
  }

  return probeInternals(version, {
    runner: playwrightRequire('playwright/lib/runner'),
    common: playwrightRequire('playwright/lib/common'),
    coreBundle: playwrightRequire('playwright-core/lib/coreBundle'),
  });
}

/** For the hook: the client instrumentation of the worker's own playwright-core. */
export function instrumentationOf(
  playwrightRequire: NodeJS.Require,
): Instrumentation {
  const core: { _instrumentation: Instrumentation } =
    playwrightRequire('playwright-core');

  return core._instrumentation;
}

/** The describe mode of a reporter Suite, which is Playwright's internal Suite object. */
export function parallelModeOf(suite: unknown): ParallelMode {
  const mode = (suite as { _parallelMode?: unknown } | undefined)
    ?._parallelMode;

  // Without the field every test would run alone, and serial chains would give false kills.
  if (typeof mode !== 'string') {
    throw new Error(
      'Playwright suites no longer carry Suite._parallelMode, which this runner reads to keep describe.serial groups together.',
    );
  }

  return mode as ParallelMode;
}
