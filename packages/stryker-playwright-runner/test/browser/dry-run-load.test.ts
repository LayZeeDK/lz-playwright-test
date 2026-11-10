import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { Mutant } from '@stryker-mutator/api/core';
import { DryRunStatus } from '@stryker-mutator/api/test-runner';
import { Instrumenter } from '@stryker-mutator/instrumenter';

import { LzPlaywrightTestRunner } from '../../src/lz-playwright-test-runner.ts';
import { logger } from '../support/doubles.ts';
import { startSession, transpile } from './support/session.ts';

const fixture = (file: string) =>
  fileURLToPath(new URL(`./load-fixture/${file}`, import.meta.url));
const { log } = logger();

let unusedMutants: readonly Mutant[];

before(async () => {
  const name = fixture('src/unused.ts');
  const result = await new Instrumenter(log).instrument(
    [{ name, content: readFileSync(name, 'utf8'), mutate: true }],
    { plugins: null, excludedMutations: [], ignorers: [] },
  );
  const [file] = result.files;
  assert.ok(file, 'the instrumented module');
  assert.ok(result.mutants.length > 0, 'the module has mutants');
  unusedMutants = result.mutants;
  writeFileSync(fixture('pages/unused.js'), transpile(file.content));
  rmSync(fixture('test-results'), { recursive: true, force: true });
});

test('a dry run whose page loads instrumented code but reaches no mutant completes without coverage', async () => {
  const session = await startSession(
    fixture('loaded.config.ts'),
    fixture('src/unused.ts'),
    log,
  );

  try {
    const { static: shared, perTest } = session.mutantCoverage;
    const covered = [
      ...Object.keys(shared),
      ...Object.values(perTest).flatMap((hits) => Object.keys(hits)),
    ];

    assert.deepEqual(
      covered.filter((id) => unusedMutants.some((m) => m.id === id)),
      [],
    );
  } finally {
    await session.dispose();
  }
});

test('a dry run on pages without instrumented code is still refused, with a frame and a popup that start on about:blank', async () => {
  const runner = new LzPlaywrightTestRunner(
    {
      lzPlaywright: { configFile: fixture('plain.config.ts') },
      timeoutMS: 10_000,
    },
    log,
  );
  await runner.init();

  try {
    const result = await runner.dryRun({
      timeout: 60_000,
      disableBail: false,
      coverageAnalysis: 'perTest',
    });

    assert.equal(result.status, DryRunStatus.Error, JSON.stringify(result));
    assert.match(result.errorMessage, /^No page loaded instrumented code\./);
  } finally {
    await runner.dispose();
  }
});
