import type { MutantCoverage } from '@stryker-mutator/api/core';

// Playwright forks fresh workers for every run with process.env, so one environment variable carries
// the run's settings from the runner to the worker hook.
export const RUN_SETTINGS = 'STRYKER_PLAYWRIGHT_RUN';

// Each Playwright worker's hook writes its snapshots, one JSON object per line, to a file in outDir
// with this suffix.
export const SNAPSHOT_SUFFIX = '.ndjson';

// How long the hook waits for a frame to answer before it counts the frame as lost. A timed-out test
// spends this long on its hung page, so the runner's timeout headroom includes it.
export const FRAME_READ_TIMEOUT_MS = 2000;

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
