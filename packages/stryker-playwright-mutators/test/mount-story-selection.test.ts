// LzPlaywrightMountStory is opt-in: off unless a config turns it on by name or with `extended`. Each case installs
// the package with its options, through the real instrumenter, and instruments one file that mounts two ids.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  lzPlaywrightMutators,
  type LzPlaywrightMutatorOptions,
} from '../src/index.ts';
import { resolveFromCore } from '../src/install.ts';
import { mutantsOf } from './support/mutants.ts';

const content =
  "import { test } from '@playwright/experimental-ct-react';\n\n" +
  "test('case', async ({ mount }) => {\n  await mount('a');\n  await mount('b');\n});\n";

async function mountStoryMutants(
  options: LzPlaywrightMutatorOptions | undefined,
): Promise<number> {
  const instrumenter = await resolveFromCore();

  await lzPlaywrightMutators(options);
  const mutants = await mutantsOf(instrumenter, [
    { name: join(import.meta.dirname, 'out', 'selection.spec.ts'), content },
  ]);

  return mutants.filter(
    ({ mutatorName }) => mutatorName === 'LzPlaywrightMountStory',
  ).length;
}

test('LzPlaywrightMountStory is off by default', async () => {
  assert.equal(await mountStoryMutants(undefined), 0);
});

test('LzPlaywrightMountStory is on by its name', async () => {
  assert.equal(await mountStoryMutants({ LzPlaywrightMountStory: true }), 2);
});

test('LzPlaywrightMountStory is on with extended', async () => {
  assert.equal(await mountStoryMutants({ extended: true }), 2);
});
