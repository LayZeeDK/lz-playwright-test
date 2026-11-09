const reportDir = 'reports/mutation/stryker-jsx-mutators';

export default {
  mutate: ['packages/stryker-jsx-mutators/src/**/*.ts'],
  testRunner: 'command',
  commandRunner: {
    command:
      'node --conditions=@layzee/source --test --test-concurrency=1 packages/stryker-jsx-mutators/test/*.test.ts',
  },
  coverageAnalysis: 'off',
  timeoutMS: 30000,
  checkers: ['typescript'],
  tsconfigFile: 'packages/stryker-jsx-mutators/tsconfig.lib.json',
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
    '!/packages/stryker-jsx-mutators/dist',
  ],
};
