import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

// The component-test case: the hook's source, mounted as gallery stories by plain @playwright/test tests.
export default {
  plugins: ['@layzee/stryker-playwright-runner'],
  testRunner: 'lz-playwright',
  lzPlaywright: {
    configFile: 'playwright.stryker.config.ts',
    survivorTraces: 'reports/lz-playwright-traces',
  },
  // Stryker 10.1.1 rewrites the sandbox's tsconfig.json through TypeScript's JS API, which TypeScript 7 (this
  // repo's version) no longer has; it skips that step in place.
  inPlace: true,
  mutate: ['src/index.ts'],
  coverageAnalysis: 'perTest',
  timeoutMS: 10_000,
  concurrency: 2,
  reporters: ['clear-text', 'progress', 'json', 'html', 'lz-playwright-traces'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  htmlReporter: { fileName: 'reports/mutation/mutation.html' },
  ignorePatterns: ['/reports'],
  tempDirName: '.stryker-tmp',
} satisfies PartialStrykerOptions;
