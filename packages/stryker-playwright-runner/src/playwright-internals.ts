// The slice of `playwright/lib/runner`, `playwright/lib/common`, and `playwright-core/lib/coreBundle`
// the runner calls. These modules are exported but undocumented, so their shape is written down here
// instead of imported.
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
export const TEST_RUNNER_METHODS = Object.keys({
  initialize: true,
  loadConfig: true,
  listTests: true,
  runGlobalSetup: true,
  runGlobalTeardown: true,
  runTests: true,
  stopTests: true,
} satisfies Record<keyof TestRunner, true>) as (keyof TestRunner)[];

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

// The reporter's Suite objects are Playwright's internal ones, which carry the describe mode.
export interface SuiteInternals {
  _parallelMode?: 'none' | 'default' | 'serial' | 'parallel';
}

export interface CommonModule {
  configLoader: {
    resolveConfigLocation(configFile: string | undefined): unknown;
  };
}
