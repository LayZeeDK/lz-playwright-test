// A `mutate` entry with a line range makes Stryker call the mutators only on nodes inside the range, never on the
// Program. coreInstrument always mutates whole files, so this test drives the instrumenter's class itself.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

import { fieldOf } from '@layzee/stryker-mutator-install';

import { lzPlaywrightMutators } from '../src/index.ts';
import { resolveFromCore } from '../src/install.ts';

const source = [
  "import { test } from '@playwright/test';",
  "test('case', async ({ page }) => {",
  "  page.getByTestId('a');",
  "  page.getByTestId('b');",
  '});',
  '',
].join('\n');

test('the Locator mutators swap values inside a line range of the file', async () => {
  const instrumenter = await resolveFromCore();

  await lzPlaywrightMutators();

  const Instrumenter = fieldOf(
    await import(
      pathToFileURL(join(instrumenter.dir, 'dist', 'src', 'index.js')).href
    ),
    'Instrumenter',
  );

  const instrument =
    typeof Instrumenter === 'function'
      ? fieldOf(Instrumenter.prototype, 'instrument')
      : undefined;

  if (typeof Instrumenter !== 'function' || typeof instrument !== 'function') {
    throw new Error('the instrumenter exports no Instrumenter class');
  }

  const logger = new Proxy({}, { get: () => () => false });
  const result: unknown = await Reflect.apply(
    instrument,
    Reflect.construct(Instrumenter, [logger]),
    [
      [
        {
          name: join(import.meta.dirname, 'out', 'line-range.spec.ts'),
          content: source,
          mutate: [
            { start: { line: 2, column: 0 }, end: { line: 4, column: 0 } },
          ],
        },
      ],
      { plugins: null, excludedMutations: [], ignorers: [] },
    ],
  );
  const mutants = fieldOf(result, 'mutants');

  assert.ok(Array.isArray(mutants));
  assert.deepEqual(
    mutants
      .map(
        (mutant: unknown) =>
          `${String(fieldOf(mutant, 'mutatorName'))} ${String(fieldOf(mutant, 'replacement'))}`,
      )
      .sort(),
    ["LzPlaywrightTestIdLocator 'a'", "LzPlaywrightTestIdLocator 'b'"],
  );
});
