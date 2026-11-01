import type { PartialStrykerOptions } from '@stryker-mutator/api/core';
import base from './stryker.base.ts';

export default {
  ...base,
  appendPlugins: ['@layzee/lz-stryker-playwright-runner'],
  testRunner: 'lz-stryker-playwright',
  lzStrykerPlaywright: {
    configFile: 'apps/demo-app/playwright.components.config.mts',
  },
  mutate: ['apps/demo-app/src/app/price-tag.tsx'],
  coverageAnalysis: 'perTest',
  timeoutMS: 11_000,
  // One mutant below the last measured score (21 of 27), since a browser run can flip one mutant.
  thresholds: { high: 80, low: 60, break: 74 },
  jsonReporter: { fileName: 'reports/ct/mutation.json' },
  htmlReporter: { fileName: 'reports/ct/mutation.html' },
  tempDirName: '.stryker-tmp-ct',
} satisfies PartialStrykerOptions;
