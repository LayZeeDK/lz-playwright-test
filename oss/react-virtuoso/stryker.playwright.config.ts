import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

export default {
  plugins: ['@layzee/stryker-playwright-runner', '@layzee/stryker-jsx-mutators'],
  ignorers: ['lz-jsx'],
  testRunner: 'lz-playwright',
  lzPlaywright: { configFile: 'playwright.config.ts' },
  mutate: [
    'src/Virtuoso.tsx',
    'src/TableVirtuoso.tsx',
    'src/VirtuosoGrid.tsx',
    'examples/grouped.tsx',
    'examples/window-table.tsx',
    'examples/gap.tsx',
    'examples/horizontal-rtl.tsx',
    'examples/collapsible-long-item.tsx',
  ],
  coverageAnalysis: 'perTest',
  timeoutMS: 11_000,
  dryRunTimeoutMinutes: 15,
  concurrency: 1,
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  tempDirName: '.stryker-tmp',
  symlinkNodeModules: false,
} satisfies PartialStrykerOptions;
