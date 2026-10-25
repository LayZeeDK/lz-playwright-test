import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

export default {
  plugins: ['@layzeedk/stryker-playwright-runner'],
  testRunner: 'playwright',
  mutate: ['src/**/*.js'],
  coverageAnalysis: 'perTest',
  timeoutMS: 10_000,
  concurrency: 1,
  reporters: ['clear-text', 'progress'],
  tempDirName: '.stryker-tmp-pw',
} satisfies PartialStrykerOptions;
