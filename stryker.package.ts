import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

import base from './stryker.base.ts';

/** The config that mutates the src of `packages/<name>` with that package's node:test files, run from the workspace root. */
export function packageConfig(name: string): PartialStrykerOptions {
  const dir = `packages/${name}`;
  const reportDir = `reports/mutation/${name}`;

  return {
    mutate: [`${dir}/src/**/*.ts`],
    testRunner: 'command',
    commandRunner: {
      command: `node --conditions=@layzee/source --test --test-concurrency=1 ${dir}/test/*.test.ts`,
    },
    coverageAnalysis: 'off',
    timeoutMS: 30000,
    checkers: ['typescript'],
    tsconfigFile: `${dir}/tsconfig.lib.json`,
    thresholds: { high: 100, low: 100, break: 100 },
    reporters: base.reporters,
    htmlReporter: { fileName: `${reportDir}/mutation.html` },
    jsonReporter: { fileName: `${reportDir}/mutation.json` },
    tempDirName: '.stryker-tmp',
    ignorePatterns: [
      ...base.ignorePatterns,
      '/.audit',
      '/.scratch',
      '/reports',
      '/apps/*/dist',
      '/packages/*/dist',
      `!/${dir}/dist`,
    ],
  };
}
