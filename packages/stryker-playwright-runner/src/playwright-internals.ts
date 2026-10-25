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
    projects: { expect?: { timeout?: number } }[];
    webServers: { url?: string; port?: number; ignoreHTTPSErrors?: boolean }[];
  }>;
  runGlobalSetup(reporters: Reporter[]): Promise<{ status: Status }>;
  runGlobalTeardown(): Promise<unknown>;
  runTests(
    reporter: Reporter,
    params: RunTestsParams,
  ): Promise<{ status: Status }>;
  stopTests(): Promise<void>;
}

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
