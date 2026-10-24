import type { MutantCoverage } from '@stryker-mutator/api/core';

// The runner forks no workers itself: Playwright does, with process.env, so these variables are the
// whole channel from the runner to the worker hook.
export const ENV = {
  activeMutant: '__STRYKER_ACTIVE_MUTANT__',
  coverage: 'STRYKER_PW_COVERAGE',
  hitLimit: 'STRYKER_PW_HIT_LIMIT',
  namespace: 'STRYKER_PW_NAMESPACE',
  outDir: 'STRYKER_PW_OUT_DIR',
} as const;

/** What the hook reads from one frame before its browser context closes. */
export interface Snapshot {
  mutantCoverage?: MutantCoverage;
  hitCount?: number;
}
