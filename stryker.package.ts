import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

import base from './stryker.base.ts';

// The src/index.ts of an @layzee/stryker-node-test-runner checkout; that runner is not on npm.
const { LZ_NODE_TEST_RUNNER: nodeTestRunner } = process.env;

/**
 * The config that mutates the src of `packages/<name>` with that package's node:test files, run from the workspace root.
 * `tests` names the test files in `test/` when only some of them can run against Stryker's instrumented sources.
 */
export function packageConfig(
  name: string,
  tests: readonly string[] = ['*.test.ts'],
): PartialStrykerOptions {
  const dir = `packages/${name}`;
  const reportDir = `reports/mutation/${name}`;
  const testFiles = tests.map((test) => `${dir}/test/${test}`);
  const runner: PartialStrykerOptions =
    nodeTestRunner === undefined || nodeTestRunner === ''
      ? {
          testRunner: 'command',
          commandRunner: {
            command: `node --conditions=@layzee/source --test --test-concurrency=1 ${testFiles.join(' ')}`,
          },
          coverageAnalysis: 'off',
        }
      : {
          testRunner: 'lz-node-test',
          appendPlugins: [nodeTestRunner],
          lzNodeTest: {
            testFiles,
            nodeArgs: ['--conditions=@layzee/source'],
          },
          coverageAnalysis: 'perTest',
        };

  return {
    mutate: [`${dir}/src/**/*.ts`],
    ...runner,
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
