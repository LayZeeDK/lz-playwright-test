export default {
  concurrency: 1,
  reporters: ['clear-text', 'progress', 'json'],
  plugins: [
    '@layzee/stryker-playwright-runner',
    '@layzee/stryker-jsx-mutators',
  ],
  ignorers: ['lz-jsx'],
  testRunner: 'lz-playwright',
  lzPlaywright: { configFile: 'playwright.config.mjs' },
  mutate: ['app/src/app/app.tsx', 'app/src/app/price-tag.tsx'],
  coverageAnalysis: 'perTest',
  timeoutMS: 11_000,
  jsonReporter: { fileName: 'reports/mutation.json' },
};
