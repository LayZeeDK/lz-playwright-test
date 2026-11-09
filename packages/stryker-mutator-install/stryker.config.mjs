const reportDir = 'reports/mutation/stryker-mutator-install';

export default {
  mutate: ['packages/stryker-mutator-install/src/**/*.ts'],
  testRunner: 'command',
  commandRunner: {
    command:
      'node --conditions=@layzee/source --test --test-concurrency=1 packages/stryker-mutator-install/test/*.test.ts',
  },
  coverageAnalysis: 'off',
  timeoutMS: 30000,
  checkers: ['typescript'],
  tsconfigFile: 'packages/stryker-mutator-install/tsconfig.lib.json',
  thresholds: { high: 100, low: 100, break: 100 },
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: `${reportDir}/mutation.html` },
  jsonReporter: { fileName: `${reportDir}/mutation.json` },
  tempDirName: '.stryker-tmp',
  ignorePatterns: [
    '/.nx',
    '/.claude',
    '/.audit',
    '/.scratch',
    '/.stryker-tmp*',
    '/reports',
    '/apps/*/dist',
    '/packages/*/dist',
    '!/packages/stryker-mutator-install/dist',
  ],
};
