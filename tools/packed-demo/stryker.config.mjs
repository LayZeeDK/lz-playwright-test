export default {
  concurrency: 1,
  reporters: ['clear-text', 'progress', 'json'],
  plugins: [
    '@layzee/lz-stryker-playwright-runner',
    '@layzee/lz-stryker-ui-mutators',
  ],
  ignorers: ['lz-stryker-ui-mutators'],
  testRunner: 'lz-stryker-playwright',
  lzStrykerPlaywright: { configFile: 'playwright.config.mjs' },
  mutate: ['app/src/app/app.tsx', 'app/src/app/price-tag.tsx'],
  coverageAnalysis: 'perTest',
  timeoutMS: 11_000,
  jsonReporter: { fileName: 'reports/mutation.json' },
};
