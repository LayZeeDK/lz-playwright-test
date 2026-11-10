import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { csfIgnorer } from '../src/csf-ignorer.ts';
import { instrument } from './support/instrument.ts';

const configDir = fileURLToPath(
  new URL('fixtures/no-main/.storybook', import.meta.url),
);
const staticReason =
  '@layzee/stryker-storybook: Storybook reads this CSF value without running the file, so it stays as written';
const metaReason =
  '@layzee/stryker-storybook: Storybook reads the meta object without running the file, so it stays an object literal';

function setup(play?: 'ignore' | 'mutate') {
  const ignorer = csfIgnorer(
    { lzStorybook: { configDir }, lzStorybookCsf: play ? { play } : {} },
    { info: () => undefined, warn: () => undefined },
  );

  return {
    outcomes: async (code: string, fileName = 'src/a.stories.tsx') =>
      (await instrument(fileName, code, [ignorer])).mutants.map(
        ({ mutatorName, line, ignoreReason }) =>
          `${line} ${mutatorName} ${ignoreReason ?? 'placed'}`,
      ),
  };
}

describe('lz-storybook-csf', () => {
  it('keeps the meta title as written', async () => {
    const { outcomes } = setup('mutate');

    assert.ok(
      (await outcomes("export default { title: 'a/b' };")).includes(
        `1 StringLiteral ${staticReason}`,
      ),
    );
  });

  it("places the mutants of a story's args", async () => {
    const { outcomes } = setup();

    assert.ok(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {\n  args: { label: 'Go' },\n};",
        )
      ).includes('3 StringLiteral placed'),
    );
  });

  it('places every mutant of a file that is not a story file', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      await outcomes("export default { title: 'a/b' };", 'src/a.ts'),
      ['1 ObjectLiteral placed', '1 StringLiteral placed'],
    );
  });

  it('keeps the meta object as written', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      await outcomes("export default { component: B, args: { a: 'x' } };"),
      [
        `1 ObjectLiteral ${metaReason}`,
        `1 ObjectLiteral ${metaReason}`,
        `1 StringLiteral ${metaReason}`,
      ],
    );
  });

  it('keeps a meta object that the default export names', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      await outcomes('const meta = { component: B };\nexport default meta;'),
      [`1 ObjectLiteral ${metaReason}`],
    );
  });
});
