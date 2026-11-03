// Drives LzPlaywrightTestRunner against a fixture whose one test fails every first attempt, with the
// Playwright config's retries: 1. The tests run the app code in the Playwright worker, so no browser starts.
// Run: npx nx run @layzee/stryker-playwright-runner:test-browser
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { Mutant } from '@stryker-mutator/api/core';
import {
  type CompleteDryRunResult,
  DryRunStatus,
  MutantRunStatus,
  TestStatus,
} from '@stryker-mutator/api/test-runner';
import { Instrumenter } from '@stryker-mutator/instrumenter';

import { LzPlaywrightTestRunner } from '../../src/lz-playwright-test-runner.ts';
import { logger } from '../support/doubles.ts';
import { transpile } from './support/session.ts';

const fixture = (file: string) =>
  fileURLToPath(new URL(`./flaky-fixture/${file}`, import.meta.url));
const source = readFileSync(fixture('src/sign.ts'), 'utf8');
const { log, lines } = logger();
const live: LzPlaywrightTestRunner[] = [];
let mutants: readonly Mutant[];
let runner: LzPlaywrightTestRunner;
let dryRun: CompleteDryRunResult;
let flakyTest: CompleteDryRunResult['tests'][number];

async function startRunner(
  lzPlaywright: object = {},
  configFile = fixture('playwright.config.ts'),
) {
  const started = new LzPlaywrightTestRunner(
    { lzPlaywright: { configFile, ...lzPlaywright }, timeoutMS: 11_000 },
    log,
  );
  live.push(started);
  await started.init();

  return started;
}

// The mutant that empties the string literal `text` in sign.ts.
function emptied(text: string): Mutant {
  const lineOf = source.split('\n');
  const found = mutants.find(
    ({ mutatorName, location: { start, end } }) =>
      mutatorName === 'StringLiteral' &&
      lineOf[start.line]?.slice(start.column, end.column) === `'${text}'`,
  );
  assert.ok(found, `a mutant empties '${text}'`);

  return found;
}

async function statusOf(on: LzPlaywrightTestRunner, m: Mutant) {
  const result = await on.mutantRun({
    activeMutant: m,
    testFilter: [flakyTest.id],
    // A wide budget keeps a loaded machine from turning kills and survivors into timeouts.
    timeout: 60_000,
    disableBail: false,
    mutantActivation: 'runtime',
    reloadEnvironment: false,
    sandboxFileName: fixture('src/sign.ts'),
  });

  return result.status;
}

before(async () => {
  const result = await new Instrumenter(log).instrument(
    [{ name: fixture('src/sign.ts'), content: source, mutate: true }],
    { plugins: null, excludedMutations: [], ignorers: [] },
  );
  mutants = result.mutants;
  const [instrumented] = result.files;
  assert.ok(instrumented);
  writeFileSync(fixture('public/sign.js'), transpile(instrumented.content));

  runner = await startRunner();
  const run = await runner.dryRun({
    timeout: 60_000,
    disableBail: false,
    coverageAnalysis: 'perTest',
  });
  assert.equal(run.status, DryRunStatus.Complete, JSON.stringify(run));
  dryRun = run;
  const found = run.tests.find((t) => t.name.endsWith('failed first attempt'));
  assert.ok(found, JSON.stringify(run.tests));
  flakyTest = found;
});

after(async () => {
  await Promise.all(live.map((started) => started.dispose()));
});

test('the dry run passes the test that passed on its retry, and names it', () => {
  assert.deepEqual(
    dryRun.tests.map((t) => t.status),
    [TestStatus.Success, TestStatus.Success],
  );
  assert.deepEqual(
    lines.filter(([level]) => level === 'warn'),
    [
      [
        'warn',
        `1 test(s) passed only on a retry in the dry run: ${flakyTest.name}`,
      ],
    ],
  );
});

test('a mutant the flaky test does not detect survives when the test passes on its retry', async () => {
  assert.equal(
    await statusOf(runner, emptied('negative')),
    MutantRunStatus.Survived,
  );
});

test('a mutant the flaky test detects on every attempt is killed', async () => {
  assert.equal(
    await statusOf(runner, emptied('positive')),
    MutantRunStatus.Killed,
  );
});

test('without retries, the flaky test kills a mutant it does not detect', async () => {
  const withoutRetries = await startRunner({ retries: 0 });

  assert.equal(
    await statusOf(withoutRetries, emptied('negative')),
    MutantRunStatus.Killed,
  );
});

test("with the config's failOnFlakyTests, a test that passes only on its retry kills", async () => {
  const strict = await startRunner({}, fixture('strict.config.ts'));

  assert.equal(
    await statusOf(strict, emptied('negative')),
    MutantRunStatus.Killed,
  );
});
