import type { PartialStrykerOptions } from '@stryker-mutator/api/core';
import base from './stryker.base.ts';

export default {
  ...base,
  plugins: ['@layzee/stryker-playwright-runner', '@layzee/stryker-ui-mutators'],
  ignorers: ['ui-mutators'],
  testRunner: 'playwright',
  playwright: { configFile: 'apps/demo-app-e2e/playwright.config.mts' },
  mutate: [
    'apps/demo-app/src/app/app.tsx',
    'apps/demo-app/src/app/price-tag.tsx',
  ],
  coverageAnalysis: 'perTest',
  timeoutMS: 10_000,
  jsonReporter: { fileName: 'reports/e2e-ui/mutation.json' },
} satisfies PartialStrykerOptions;
