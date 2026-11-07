import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { Mutant } from '@stryker-mutator/api/core';
import { MutantRunStatus } from '@stryker-mutator/api/test-runner';
import { Instrumenter } from '@stryker-mutator/instrumenter';

import { logger } from '../support/doubles.ts';
import { type Session, startSession, transpile } from './support/session.ts';

const fixture = (file: string) =>
  fileURLToPath(new URL(`./callback-fixture/${file}`, import.meta.url));
const { log } = logger();
const title = 'doubles in the page';

let session: Session;
let callbackMutant: Mutant;

before(async () => {
  const source = readFileSync(fixture('src/callback.spec.ts'), 'utf8');
  const result = await new Instrumenter(log).instrument(
    [{ name: fixture('src/callback.spec.ts'), content: source, mutate: true }],
    { plugins: null, excludedMutations: [], ignorers: [] },
  );
  const found = result.mutants.find(
    (m) => m.mutatorName === 'ArithmeticOperator',
  );
  const [spec] = result.files;
  assert.ok(found, 'the mutant inside the page.evaluate callback');
  assert.ok(spec, 'the instrumented spec');
  callbackMutant = found;
  rmSync(fixture('public'), { recursive: true, force: true });
  rmSync(fixture('test-results'), { recursive: true, force: true });
  mkdirSync(fixture('public'));
  writeFileSync(fixture('public/callback.spec.js'), transpile(spec.content));

  session = await startSession(
    fixture('playwright.config.ts'),
    fixture('src/callback.spec.ts'),
    log,
  );
});

after(async () => {
  await session?.dispose();
});

test('the dry run covers a mutant inside a page.evaluate callback for the test that runs it', () => {
  const { perTest } = session.mutantCoverage;

  assert.ok(perTest[session.testId(title)]?.[callbackMutant.id]);
});

test('a mutant inside a page.evaluate callback is killed by the test that runs it', async () => {
  const result = await session.mutantRun(callbackMutant, {
    testFilter: [session.testId(title)],
  });

  assert.equal(result.status, MutantRunStatus.Killed, JSON.stringify(result));
  assert.deepEqual(result.killedBy, [session.testId(title)]);
});
