import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

export default {
  plugins: ['@layzee/stryker-playwright-runner'],
  testRunner: 'playwright',
  playwright: { configFile: 'apps/analog-app-e2e/playwright.config.ts' },
  mutate: ['apps/analog-app/src/app/pages/(home).page.ts'],
  ignorers: ['angular'],
  coverageAnalysis: 'perTest',
  timeoutMS: 15_000,
  concurrency: 1,
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  tempDirName: '.stryker-tmp',
} satisfies PartialStrykerOptions;
