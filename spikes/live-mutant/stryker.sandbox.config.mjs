// Keeps Stryker's instrumented sandbox of the demo app, with the mutants and ids of stryker.e2e.ui.config.ts.
// Run from the repo root: node node_modules/@stryker-mutator/core/bin/stryker.js run spikes/live-mutant/stryker.sandbox.config.mjs
export default {
  plugins: ['@layzee/lz-stryker-ui-mutators'],
  ignorers: ['lz-stryker-ui-mutators'],
  testRunner: 'command',
  commandRunner: { command: 'node -e "process.exit(0)"' },
  mutate: [
    'apps/demo-app/src/app/app.tsx',
    'apps/demo-app/src/app/price-tag.tsx',
  ],
  coverageAnalysis: 'off',
  concurrency: 1,
  cleanTempDir: false,
  tempDirName: '.stryker-tmp-live',
  ignorePatterns: ['/.nx', '/.claude', '/.stryker-tmp*', '/reports', '/spikes'],
  reporters: ['json'],
  jsonReporter: { fileName: 'spikes/live-mutant/out/mutation.json' },
};
