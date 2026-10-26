import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

export default {
  plugins: [
    '@layzee/stryker-playwright-runner',
    '@layzee/stryker-ui-mutators',
    '@stryker-mutator/typescript-checker',
  ],
  ignorers: ['ui-mutators'],
  testRunner: 'playwright',
  playwright: { configFile: 'playwright.config.ts' },
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  mutate: [
    'app/routes/users/index.tsx',
    'app/components/search-bar.tsx',
    'app/routes/users/$username/notes/$noteId.tsx',
    'app/routes/users/$username/notes/_layout.tsx',
  ],
  coverageAnalysis: 'perTest',
  timeoutMS: 10_000,
  concurrency: 1,
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  tempDirName: '.stryker-tmp',
} satisfies PartialStrykerOptions;
