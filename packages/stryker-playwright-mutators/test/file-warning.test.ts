// Own file: node runs each test file in its own process, so the install changes this process's instrumenter only.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { install, resolveFromCore } from '../src/install.ts';
import { mutatorSets } from '../src/mutators.ts';
import { mutantsOf } from './support/mutants.ts';

const plain =
  'export function add(a: number, b: number) {\n  return a + b;\n}\n';
const spec =
  "import { test } from '@playwright/test';\n\ntest('a', async ({ page }) => {\n  await page.goto('/');\n});\n";

describe('the warning for a file that is not Playwright test code, through the real instrumenter', () => {
  it('warns once for a plain file and never for a spec file, also when the plain file is instrumented again', async () => {
    const warnings: string[] = [];
    const instrumenter = await resolveFromCore();

    await install(
      mutatorSets,
      undefined,
      resolveFromCore,
      (message) => warnings.push(message),
      () => undefined,
    );
    await mutantsOf(instrumenter, [
      { name: 'plain.ts', content: plain },
      { name: 'a.spec.ts', content: spec },
    ]);

    assert.deepEqual(
      warnings.map((message) => message.split(':')[0]),
      ['plain.ts'],
    );

    await mutantsOf(instrumenter, [{ name: 'plain.ts', content: plain }]);

    assert.equal(warnings.length, 1);
  });
});
