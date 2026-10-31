import type { PartialStrykerOptions } from '@stryker-mutator/api/core';
import base from './stryker.base.ts';

export default {
  ...base,
  plugins: ['@layzee/lz-stryker-playwright-runner'],
  testRunner: 'lz-stryker-playwright',
  lzStrykerPlaywright: {
    configFile: 'apps/demo-app/playwright.components.config.mts',
  },
  mutate: ['apps/demo-app/src/app/price-tag.tsx'],
  coverageAnalysis: 'perTest',
  timeoutMS: 10_000,
  jsonReporter: { fileName: 'reports/ct/mutation.json' },
  htmlReporter: { fileName: 'reports/ct/mutation.html' },
  tempDirName: '.stryker-tmp-ct',
} satisfies PartialStrykerOptions;
