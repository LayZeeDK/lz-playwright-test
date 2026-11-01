import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

export default {
  plugins: ['@layzee/stryker-playwright-runner'],
  testRunner: 'lz-stryker-playwright',
  mutate: ['src/**/*.js'],
  coverageAnalysis: 'perTest',
  timeoutMS: 11_000,
  concurrency: 1,
  reporters: ['clear-text', 'progress'],
  tempDirName: '.stryker-tmp-pw',
} satisfies PartialStrykerOptions;
