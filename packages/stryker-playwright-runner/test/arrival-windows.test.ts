import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DryRunStatus } from '@stryker-mutator/api/test-runner';

import { withEnv } from '../src/process-env.ts';
import { loadPlaywright } from '../src/playwright-internals.ts';
import { parseSnapshotLine } from '../src/protocol.ts';
import { LzPlaywrightCollectingReporter } from '../src/reporter.ts';
import { dryRunResult } from '../src/run-result.ts';
import { untaggedKey } from '../src/server-protocol.ts';
import {
  dryRequest,
  runOutput,
  tempTree,
  withoutPrototypes,
} from './support/doubles.ts';

const packageJson = fileURLToPath(new URL('../package.json', import.meta.url));
const playwrightTest = import.meta.resolve('@playwright/test');

async function runStampingTest(t: TestContext, workerFixtureMs: number) {
  const dir = tempTree(t, 'lz-arrival-windows-', {
    'playwright.config.mjs': "export default { testDir: './tests' };\n",
    'tests/stamp.spec.mjs': [
      `import { test as base } from ${JSON.stringify(playwrightTest)};`,
      "import fs from 'node:fs';",
      'const test = base.extend({',
      '  slow: [',
      '    async ({}, use) => {',
      `      await new Promise((resolve) => setTimeout(resolve, ${workerFixtureMs}));`,
      "      await use('ready');",
      '    },',
      "    { scope: 'worker' },",
      '  ],',
      '});',
      "test('stamps', async ({ slow }, info) => {",
      '  fs.writeFileSync(process.env.LZ_STAMP_FILE, `${info.testId} ${Date.now()}`);',
      '});',
      '',
    ].join('\n'),
  });
  const stampFile = path.join(dir, 'stamp.txt');
  const playwright = await loadPlaywright(packageJson).createTestRunner(
    path.join(dir, 'playwright.config.mjs'),
    {},
  );
  await playwright.loadConfig();
  const reporter = new LzPlaywrightCollectingReporter();

  try {
    await playwright.runGlobalSetup([reporter]);
    const { status } = await withEnv({ LZ_STAMP_FILE: stampFile }, () =>
      playwright.runTests(reporter, {
        locations: [],
        workers: 1,
        disableConfigReporters: true,
      }),
    );
    assert.equal(status, 'passed', reporter.outputTail);
  } finally {
    await playwright.runGlobalTeardown();
  }

  const [testId = '', stamp = ''] = readFileSync(stampFile, 'utf8').split(' ');

  return { reporter, testId, stampedAt: Number(stamp) };
}

test('a server request that arrives while a test runs counts for that test, after a worker fixture that took longer than the duration Playwright reports', async (t) => {
  const { reporter, testId, stampedAt } = await runStampingTest(t, 300);
  const snapshot = parseSnapshotLine(
    JSON.stringify({
      mutantCoverage: {
        static: {},
        perTest: { [untaggedKey(stampedAt)]: { '1': 1 } },
      },
    }),
  );
  assert.ok(snapshot);

  const { result } = dryRunResult(
    runOutput({ reporter, snapshots: [snapshot] }),
    dryRequest(),
  );

  assert.equal(result.status, DryRunStatus.Complete);
  assert.deepEqual(withoutPrototypes(result.mutantCoverage), {
    static: {},
    perTest: { [testId]: { '1': 1 } },
  });
});
