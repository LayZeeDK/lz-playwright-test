import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

export default {
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
  concurrency: 1,
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'reports/e2e-ui/mutation.json' },
  tempDirName: '.stryker-tmp',
  // A copied .nx/workspace-data sends the sandbox's Nx to this workspace's daemon, which refuses it.
  ignorePatterns: ['/.nx', '/.claude', '/.stryker-tmp-*'],
} satisfies PartialStrykerOptions;
