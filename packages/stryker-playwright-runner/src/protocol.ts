import type { MutantCoverage } from '@stryker-mutator/api/core';

// Playwright forks fresh workers for every run with process.env, so one environment variable carries
// the run's settings from the runner to the worker hook.
export const RUN_SETTINGS = 'STRYKER_PLAYWRIGHT_RUN';

// The hook drops a file with this suffix into outDir when it installs, so a run can tell "the hook
// never installed" apart from "no page loaded instrumented code".
export const INSTALLED_SUFFIX = '.installed';

export interface RunSettings {
  outDir: string;
  perTest: boolean;
  hitLimit?: number;
}

/** What the hook reads from one frame before its browser context closes. */
export interface Snapshot {
  mutantCoverage?: MutantCoverage;
  hitCount?: number;
  outlivedItsTest?: boolean;
  /** The frame did not answer in time, so its coverage is unknown. */
  lost?: boolean;
}

export function readRunSettings(
  env: NodeJS.ProcessEnv,
): RunSettings | undefined {
  const raw = env[RUN_SETTINGS];

  return raw === undefined ? undefined : (JSON.parse(raw) as RunSettings);
}
