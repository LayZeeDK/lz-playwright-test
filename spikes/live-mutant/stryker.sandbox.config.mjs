// Keeps Stryker's instrumented sandbox of the demo app, with the mutants and ids of stryker.e2e.ui.config.ts.
// Run from the repo root: node node_modules/@stryker-mutator/core/bin/stryker.js run spikes/live-mutant/stryker.sandbox.config.mjs
import ui from '../../stryker.e2e.ui.config.ts';

export default {
  ...ui,
  testRunner: 'command',
  commandRunner: { command: 'node -e "process.exit(0)"' },
  coverageAnalysis: 'off',
  cleanTempDir: false,
  tempDirName: '.stryker-tmp-live',
  // Stryker copies the project into the sandbox; reports and spikes are outputs the served app never needs.
  ignorePatterns: [...ui.ignorePatterns, '/reports', '/spikes'],
  reporters: ['json'],
  jsonReporter: { fileName: 'spikes/live-mutant/out/mutation.json' },
};
