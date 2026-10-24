/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  plugins: ['@spr/stryker-playwright-runner'],
  testRunner: 'playwright',
  playwright: { configFile: 'apps/demo-app-e2e/playwright.config.mts' },
  mutate: ['apps/demo-app/src/app/cart.ts'],
  coverageAnalysis: 'perTest',
  concurrency: 1,
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'reports/e2e/mutation.json' },
  tempDirName: '.stryker-tmp',
};
