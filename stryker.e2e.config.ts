import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

export default {
  plugins: ['@layzeedk/stryker-playwright-runner'],
  testRunner: 'playwright',
  playwright: { configFile: 'apps/demo-app-e2e/playwright.config.mts' },
  mutate: ['apps/demo-app/src/app/cart.ts'],
  coverageAnalysis: 'perTest',
  timeoutMS: 10_000,
  concurrency: 1,
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'reports/e2e/mutation.json' },
  tempDirName: '.stryker-tmp',
} satisfies PartialStrykerOptions;
