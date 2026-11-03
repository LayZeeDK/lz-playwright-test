import type { PartialStrykerOptions } from '@stryker-mutator/api/core';
import base from './stryker.base.ts';

export default {
  ...base,
  appendPlugins: [
    '@layzee/stryker-playwright-runner',
    '@layzee/stryker-playwright-mutators',
  ],
  ignorers: ['lz-jsx'],
  testRunner: 'lz-playwright',
  lzPlaywright: {
    configFile: 'apps/demo-app-e2e/playwright.config.mts',
  },
  mutate: [
    'apps/demo-app/src/app/app.tsx',
    'apps/demo-app/src/app/price-tag.tsx',
  ],
  coverageAnalysis: 'perTest',
  timeoutMS: 11_000,
  // One mutant below the last measured score (31 of 65), since a browser run can flip one mutant.
  thresholds: { high: 80, low: 60, break: 46 },
  jsonReporter: { fileName: 'reports/e2e-ui/mutation.json' },
  htmlReporter: { fileName: 'reports/e2e-ui/mutation.html' },
} satisfies PartialStrykerOptions;
