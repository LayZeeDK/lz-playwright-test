// Each case must give exactly the MountStory mutants it lists, through the real instrumenter with the real install and
// the opt-in mutator turned on. The install and the instrumentation run in a before hook, so that an error there fails
// every case instead of the file.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { before, test } from 'node:test';

import { lzPlaywrightMutators } from '../src/index.ts';
import { resolveFromCore } from '../src/install.ts';
import type { Case } from './cases.ts';
import { mountStoryCases } from './mount-story-cases.ts';
import { mutantsOf, type Mutant } from './support/mutants.ts';

function fileOf(testCase: Case): string {
  return join(import.meta.dirname, 'out', `${testCase.id}.spec.ts`);
}

function source(testCase: Case): string {
  return `import { expect, test } from '@playwright/experimental-ct-react';\n\n${testCase.source}\n`;
}

let mutants: readonly Mutant[];

before(async () => {
  const instrumenter = await resolveFromCore();

  await lzPlaywrightMutators({ LzPlaywrightMountStory: true });
  mutants = await mutantsOf(
    instrumenter,
    mountStoryCases.map((testCase) => ({
      name: fileOf(testCase),
      content: source(testCase),
    })),
  );
});

mountStoryCases.forEach((testCase) => {
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
