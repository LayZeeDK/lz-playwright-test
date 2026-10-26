import type { PartialStrykerOptions } from '@stryker-mutator/api/core';
import base from './stryker.base.ts';

export default {
  ...base,
  plugins: ['@layzee/stryker-playwright-runner'],
  testRunner: 'playwright',
  playwright: { configFile: 'apps/demo-app-e2e/playwright.config.mts' },
  mutate: ['apps/demo-app/src/app/cart.ts'],
  coverageAnalysis: 'perTest',
  timeoutMS: 10_000,
  jsonReporter: { fileName: 'reports/e2e/mutation.json' },
} satisfies PartialStrykerOptions;
