// Each case must give exactly the Action mutants it lists, through the real instrumenter with the real install. The
// install and the instrumentation run in a before hook, so that an error there fails every case instead of the file.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { before, test } from 'node:test';

import { lzPlaywrightMutators } from '../src/index.ts';
import { resolveFromCore } from '../src/install.ts';
import { cases, type Case } from './cases.ts';
import { routeMockCases } from './route-mock-cases.ts';
import { mutantsOf, type Mutant } from './support/mutants.ts';

const allCases: readonly Case[] = [...cases, ...routeMockCases];

function fileOf(testCase: Case): string {
  return join(import.meta.dirname, 'out', `${testCase.id}.spec.ts`);
}

function source(testCase: Case): string {
  return `import { expect, test } from '@playwright/test';\n\n${testCase.source}\n`;
}

let mutants: readonly Mutant[];

before(async () => {
  const instrumenter = await resolveFromCore();

  await lzPlaywrightMutators();
  mutants = await mutantsOf(
    instrumenter,
    allCases.map((testCase) => ({
      name: fileOf(testCase),
      content: source(testCase),
    })),
  );
});

allCases.forEach((testCase) => {
  test(`${testCase.id}: ${testCase.title}`, () => {
    const actual = mutants
      .filter(({ fileName }) => fileName === fileOf(testCase))
      .map(({ mutatorName, replacement }) => `${mutatorName} ${replacement}`)
      .sort();
    const expected = testCase.expect
      .map(([mutator, replacement]) => `${mutator} ${replacement}`)
      .sort();

    assert.deepEqual(actual, expected);
  });
});
