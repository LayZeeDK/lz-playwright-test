import type { PartialStrykerOptions } from '@stryker-mutator/api/core';
import base from './stryker.base.ts';

export default {
  ...base,
  appendPlugins: ['@layzee/lz-stryker-playwright-runner'],
  testRunner: 'lz-stryker-playwright',
  lzStrykerPlaywright: {
    configFile: 'apps/demo-app-e2e/playwright.config.mts',
  },
  mutate: ['apps/demo-app/src/app/cart.ts'],
  coverageAnalysis: 'perTest',
  timeoutMS: 11_000,
  // One mutant below the last measured score (27 of 32), since a browser run can flip one mutant.
  thresholds: { high: 80, low: 60, break: 81 },
  jsonReporter: { fileName: 'reports/e2e/mutation.json' },
  htmlReporter: { fileName: 'reports/e2e/mutation.html' },
} satisfies PartialStrykerOptions;
