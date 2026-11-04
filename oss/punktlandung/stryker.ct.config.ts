import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

// The component-test case: the feature components that the story specs mount through the gallery, with the
// built-in and the JSX mutators.
export default {
  plugins: [
    '@layzee/stryker-playwright-runner',
    '@layzee/stryker-jsx-mutators',
  ],
  ignorers: ['lz-jsx'],
  testRunner: 'lz-playwright',
  lzPlaywright: {
    configFile: 'playwright.stryker.config.ts',
    survivorTraces: 'reports/lz-playwright-traces',
  },
  // The `#/` imports resolve through the workspace's tsconfig paths and bun's links back to this package, so
  // a sandbox would serve unmutated code.
  inPlace: true,
  mutate: [
    'src/features/noten/ui/{upcoming-block,trend-chart,noten-list,leistung-detail}.tsx',
    'src/features/halbjahre/ui/{halbjahre-management,halbjahr-form,conversion-reference}.tsx',
    'src/features/lernen/ui/learned-for-leistung.tsx',
    'src/features/faecher/ui/{gewichtung-field,fach-form}.tsx',
  ],
  coverageAnalysis: 'perTest',
  timeoutMS: 11_000,
  concurrency: 2,
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  reporters: ['clear-text', 'progress', 'json', 'html', 'lz-playwright-traces'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  htmlReporter: { fileName: 'reports/mutation/mutation.html' },
  ignorePatterns: ['/reports'],
  tempDirName: '.stryker-tmp',
} satisfies PartialStrykerOptions;
