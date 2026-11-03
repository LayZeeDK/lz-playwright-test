// Forces Stryker's own timeout to fire before Playwright's per-test timeout (floor 2000 ms).
import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

export default {
  plugins: ['@layzee/stryker-playwright-runner'],
  testRunner: 'lz-playwright',
  mutate: ['src/**/*.js'],
  coverageAnalysis: 'perTest',
  timeoutMS: 1,
  timeoutFactor: 0,
  concurrency: 1,
  reporters: ['clear-text'],
  tempDirName: '.stryker-tmp-forced',
} satisfies PartialStrykerOptions;
