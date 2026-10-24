// The slice of `playwright/lib/runner` and `playwright/lib/common` the runner calls. These modules
// are exported but undocumented, so their shape is written down here instead of imported.
import type { FullResult, Reporter } from '@playwright/test/reporter';

type Status = FullResult['status'];

export interface RunTestsParams {
  locations: string[];
  testIds?: string[];
  projects?: string[];
  workers?: number;
  maxFailures?: number;
  disableConfigReporters?: boolean;
}

export interface TestRunner {
  initialize(params: Record<string, never>): Promise<void>;
  loadConfig(): Promise<{ projects: { project: { expect?: { timeout?: number } } }[] }>;
  runGlobalSetup(reporters: Reporter[]): Promise<{ status: Status }>;
  runGlobalTeardown(): Promise<unknown>;
  runTests(reporter: Reporter, params: RunTestsParams): Promise<{ status: Status }>;
  stopTests(): Promise<void>;
}

export interface RunnerModule {
  testRunner: {
    TestRunner: new (configLocation: unknown, overrides: Record<string, unknown>) => TestRunner;
  };
}

export interface CommonModule {
  configLoader: { resolveConfigLocation(configFile: string | undefined): unknown };
}
