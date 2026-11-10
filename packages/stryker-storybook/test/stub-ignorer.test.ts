import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { stubIgnorer } from '../src/stub-ignorer.ts';
import { spyStubReason } from '../src/stub-verdict.ts';
import { instrument } from './support/instrument.ts';

const fixtures = fileURLToPath(new URL('fixtures/', import.meta.url));

function resetCase(name: string): string {
  return readFileSync(
    join(fixtures, 'reset-cases', `${name}.stories.tsx.txt`),
    'utf8',
  );
}

async function setup(fixture: string, fileName: string, content: string) {
  const ignorer = stubIgnorer(
    { lzStorybook: { configDir: join(fixtures, fixture, '.storybook') } },
    { info: () => undefined, warn: () => undefined },
  );
  const { mutants } = await instrument(
    join(fixtures, fixture, 'src', fileName),
    content,
    [ignorer],
  );
  const lines = content.split('\n');

  return {
    reasonsOf: (text: string, occurrence = 0) => {
      const line =
        lines
          .map((source, index) => (source.includes(text) ? index + 1 : 0))
          .filter((index) => index > 0)[occurrence] ?? 0;

      return mutants
        .filter((mutant) => mutant.line === line && mutant.replacement === '""')
        .map((mutant) => mutant.ignoreReason);
    },
  };
}

describe('stubIgnorer', () => {
  it('gives the erased reason to a mutant inside a stub the reset erases', async () => {
    const { reasonsOf } = await setup(
      'no-main',
      'F01AllDefault.stories.tsx',
      resetCase('F01AllDefault'),
    );

    assert.deepEqual(reasonsOf("mockReturnValue('stubbed')"), [
      spyStubReason('erased'),
    ]);
  });

  it('leaves the mutants outside the stub placed', async () => {
    const { reasonsOf } = await setup(
      'no-main',
      'F01AllDefault.stories.tsx',
      resetCase('F01AllDefault'),
    );

    assert.deepEqual(reasonsOf("toHaveTextContent('stubbed')"), [
      undefined,
      undefined,
    ]);
  });

  it('gives the order-dependent reason to a stub that only some orders erase', async () => {
    const { reasonsOf } = await setup(
      'no-main',
      'F04OffBeforeDefault.stories.tsx',
      resetCase('F04OffBeforeDefault'),
    );

    assert.deepEqual(reasonsOf("mockReturnValue('stubbed')"), [
      spyStubReason('order-dependent'),
    ]);
  });

  it('gives the unknown reason to a stub in a file whose reset setting cannot be read', async () => {
    const { reasonsOf } = await setup(
      'no-main',
      'F11Imported.stories.tsx',
      resetCase('F11Imported'),
    );

    assert.deepEqual(reasonsOf("mockReturnValue('stubbed')"), [
      spyStubReason('unknown'),
    ]);
  });

  it('reads the reset setting from the preview in the config folder', async () => {
    const { reasonsOf } = await setup(
      'preview-off',
      'F01AllDefault.stories.tsx',
      resetCase('F01AllDefault'),
    );

    assert.deepEqual(reasonsOf("mockReturnValue('stubbed')"), [undefined]);
  });

  it('leaves a stub the reset keeps placed', async () => {
    const { reasonsOf } = await setup(
      'no-main',
      'F02MetaOff.stories.tsx',
      resetCase('F02MetaOff'),
    );

    assert.deepEqual(reasonsOf("mockReturnValue('stubbed')"), [undefined]);
  });

  describe('with the mock transformer in viteFinal', () => {
    it('leaves a stub the reset erases placed', async () => {
      const { reasonsOf } = await setup(
        'transformer',
        'Stub.stories.tsx',
        resetCase('F01AllDefault'),
      );

      assert.deepEqual(reasonsOf("mockReturnValue('stubbed')"), [undefined]);
    });

    it('gives the once-not-rewritten reason to an erased *Once stub', async () => {
      const { reasonsOf } = await setup(
        'transformer',
        'Stub.stories.tsx',
        resetCase('F01AllDefault').replaceAll(
          'mockReturnValue(',
          'mockReturnValueOnce(',
        ),
      );

      assert.deepEqual(reasonsOf("mockReturnValueOnce('stubbed')"), [
        spyStubReason('once-not-rewritten'),
      ]);
    });

    it('leaves a *Once stub the reset keeps placed', async () => {
      const { reasonsOf } = await setup(
        'transformer',
        'Stub.stories.tsx',
        resetCase('F02MetaOff').replaceAll(
          'mockReturnValue(',
          'mockReturnValueOnce(',
        ),
      );

      assert.deepEqual(reasonsOf("mockReturnValueOnce('stubbed')"), [
        undefined,
      ]);
    });
  });

  it('leaves the mutants of an expression around the stub placed', async () => {
    const { reasonsOf } = await setup(
      'no-main',
      'F01AllDefault.stories.tsx',
      resetCase('F01AllDefault').replace(
        "mockReturnValue('stubbed')",
        "mockReturnValue('stubbed') ?? 'fallback'",
      ),
    );

    assert.deepEqual(reasonsOf("mockReturnValue('stubbed')"), [
      spyStubReason('erased'),
      undefined,
    ]);
  });

  it('leaves a file that is not a story file alone', async () => {
    const { reasonsOf } = await setup(
      'no-main',
      'F01AllDefault.tsx',
      resetCase('F01AllDefault'),
    );

    assert.deepEqual(reasonsOf("mockReturnValue('stubbed')"), [undefined]);
  });

  it("counts the stories that the tag filter of Stryker's Vitest config tests", async () => {
    const content = [
      "import { fn } from 'storybook/test';",
      'export default { parameters: { test: { restoreMocks: false } } };',
      "export const A = { tags: ['flaky'], parameters: { test: { mockReset: true } } };",
      "export const B = { args: { g: fn().mockReturnValue('stubbed') } };",
    ].join('\n');
    const ignorer = stubIgnorer(
      {
        lzStorybook: { configDir: join(fixtures, 'vitest-tags', '.storybook') },
        vitest: {
          configFile: join(fixtures, 'vitest-tags', 'vitest.config.ts'),
        },
      },
      { info: () => undefined, warn: () => undefined },
    );

    const { mutants } = await instrument(
      join(fixtures, 'vitest-tags', 'src', 'Button.stories.tsx'),
      content,
      [ignorer],
    );

    assert.deepEqual(
      mutants
        .filter((mutant) => mutant.line === 4 && mutant.replacement === '""')
        .map((mutant) => mutant.ignoreReason),
      [undefined],
    );
  });
});
