import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

export default {
  plugins: ['@spr/stryker-playwright-runner'],
  testRunner: 'playwright',
  playwright: { configFile: 'apps/ngx-yeti-e2e/playwright.config.mts', projects: ['chromium'], workers: 2 },
  dryRunTimeoutMinutes: 20,
  mutate: ['packages/ngx-yeti/cluster/src/cluster.ts'],
  ignorers: ['angular'],
  coverageAnalysis: 'perTest',
  timeoutMS: 15_000,
  concurrency: 1,
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  tempDirName: '.stryker-tmp',
} satisfies PartialStrykerOptions;
