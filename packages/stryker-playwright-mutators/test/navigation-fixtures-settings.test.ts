// Own file: node runs each test file in its own process, so the settings of these installs reach no other file's cases.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lzPlaywrightMutators } from '../src/index.ts';
import { resolveFromCore } from '../src/install.ts';
import { mutantsOf } from './support/mutants.ts';

function specOf(fixture: string): string {
  return `import { test } from '@playwright/test';\n\ntest('case', async ({ ${fixture} }) => {\n  await ${fixture}('/');\n});\n`;
}

async function removedFixtures(): Promise<readonly string[]> {
  const fixtures = ['navigate', 'visit', 'go'];
  const mutants = await mutantsOf(
    await resolveFromCore(),
    fixtures.map((fixture) => ({
      name: `${fixture}.spec.ts`,
      content: specOf(fixture),
    })),
  );

  return mutants
    .filter(({ mutatorName }) => mutatorName === 'LzPlaywrightNavigationAction')
    .map(({ fileName }) => fileName.replace('.spec.ts', ''));
}

describe('lzPlaywrightMutators settings', () => {
  it('removes the awaited calls of the fixtures in navigationFixtures, in place of navigate', async () => {
    await lzPlaywrightMutators(undefined, { navigationFixtures: ['visit'] });

    assert.deepEqual(await removedFixtures(), ['visit']);
  });

  it("replaces the list of an earlier call with the list of the next call, and 'navigate' returns without settings", async () => {
    await lzPlaywrightMutators(undefined, { navigationFixtures: ['go'] });

    assert.deepEqual(await removedFixtures(), ['go']);

    await lzPlaywrightMutators();

    assert.deepEqual(await removedFixtures(), ['navigate']);
  });
});
