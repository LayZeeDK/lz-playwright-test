const reportDir = 'reports/mutation/stryker-playwright-mutators';

export default {
  mutate: ['packages/stryker-playwright-mutators/src/**/*.ts'],
  testRunner: 'command',
  commandRunner: {
    command:
      'node --conditions=@layzee/source --test packages/stryker-playwright-mutators/test/*.test.ts',
  },
  coverageAnalysis: 'off',
  checkers: ['typescript'],
  tsconfigFile: 'packages/stryker-playwright-mutators/tsconfig.lib.json',
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
    '!/packages/stryker-playwright-mutators/dist',
  ],
};
