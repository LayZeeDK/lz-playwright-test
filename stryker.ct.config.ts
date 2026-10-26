import type { PartialStrykerOptions } from '@stryker-mutator/api/core';
import base from './stryker.base.ts';

export default {
  ...base,
  plugins: ['@layzee/stryker-playwright-runner'],
  testRunner: 'playwright',
  playwright: { configFile: 'apps/demo-app/playwright.components.config.mts' },
  mutate: ['apps/demo-app/src/app/price-tag.tsx'],
  coverageAnalysis: 'perTest',
  timeoutMS: 10_000,
  jsonReporter: { fileName: 'reports/ct/mutation.json' },
  tempDirName: '.stryker-tmp-ct',
} satisfies PartialStrykerOptions;
