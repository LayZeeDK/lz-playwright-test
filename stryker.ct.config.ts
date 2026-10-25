import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

export default {
  plugins: ['@layzee/stryker-playwright-runner'],
  testRunner: 'playwright',
  playwright: { configFile: 'apps/demo-app/playwright.components.config.mts' },
  mutate: ['apps/demo-app/src/app/price-tag.tsx'],
  coverageAnalysis: 'perTest',
  timeoutMS: 10_000,
  concurrency: 1,
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'reports/ct/mutation.json' },
  tempDirName: '.stryker-tmp-ct',
} satisfies PartialStrykerOptions;
