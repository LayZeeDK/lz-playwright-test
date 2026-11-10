import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { metaReason, setup, staticReason } from './support/csf-ignorer.ts';

describe('lz-storybook-csf', () => {
  it('keeps the meta title as written', async () => {
    const { outcomes } = setup('mutate');

    assert.deepEqual(await outcomes("export default { title: 'a/b' };"), [
      '1 ObjectLiteral placed',
      `1 StringLiteral ${staticReason}`,
    ]);
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

  it('keeps a meta object that the default export names through another name', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      await outcomes(
        'const base = { component: B };\nconst meta = base;\nexport default meta;',
      ),
      [`1 ObjectLiteral ${metaReason}`],
    );
  });

  it('places the mutants of a file whose default export names a binding cycle', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      await outcomes(
        'const a = b;\nconst b = a;\nexport default a;\nexport const n = 1 + 1;',
      ),
      ['4 ArithmeticOperator placed'],
    );
  });

  it('keeps a meta object under satisfies as written', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      await outcomes("export default { args: { a: 'x' } } satisfies Meta;"),
      [
        `1 ObjectLiteral ${metaReason}`,
        `1 ObjectLiteral ${metaReason}`,
        `1 StringLiteral ${metaReason}`,
      ],
    );
  });

  it('keeps a meta object under satisfies that the default export names', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      await outcomes(
        'const meta = { component: B } satisfies Meta;\nexport default meta;',
      ),
      [`1 ObjectLiteral ${metaReason}`],
    );
  });

  it('keeps a meta object exported as default by name as written', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      await outcomes(
        "const meta = {\n  title: 'a/b',\n};\nexport { meta as default };",
      ),
      [`1 ObjectLiteral ${metaReason}`, `2 StringLiteral ${metaReason}`],
    );
  });

  it('keeps the object passed to preview.meta() as written', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "import preview from '#.storybook/preview';\nconst meta = preview.meta({\n  title: 'a/b',\n});\nexport const A = meta.story();",
        )
      ).filter((outcome) => /^[23] /.test(outcome)),
      [`2 ObjectLiteral ${metaReason}`, `3 StringLiteral ${metaReason}`],
    );
  });

  it('keeps the object passed to preview.type().meta() as written', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "import preview from '#.storybook/preview';\nconst meta = preview.type<{ args: A }>().meta({\n  title: 'a/b',\n});\nexport const A = meta.story();",
        )
      ).filter((outcome) => /^[23] /.test(outcome)),
      [`2 ObjectLiteral ${metaReason}`, `3 StringLiteral ${metaReason}`],
    );
  });

  it('keeps the object passed to preview.meta() as written when the file also exports preview', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "import preview from '#.storybook/preview';\nconst meta = preview.meta({\n  title: 'a/b',\n});\nexport const A = meta.story();\nexport { preview };",
        )
      ).filter((outcome) => /^[23] /.test(outcome)),
      [`2 ObjectLiteral ${metaReason}`, `3 StringLiteral ${metaReason}`],
    );
  });

  it('places the object passed to .meta() on an import from a file in a preview folder', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "import sb from '../preview/sb';\nconst meta = sb.meta({\n  title: 'a/b',\n});",
        )
      ).filter((outcome) => /^[23] /.test(outcome)),
      ['2 ObjectLiteral placed', '3 StringLiteral placed'],
    );
  });

  it("places a title in a story's args", async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {\n  args: { title: 'Go' },\n};",
        )
      ).filter((outcome) => /^3 StringLiteral/.test(outcome)),
      ['3 StringLiteral placed'],
    );
  });

  it('keeps the meta id as written', async () => {
    const { outcomes } = setup('mutate');

    assert.deepEqual(
      (await outcomes("export default {\n  id: 'a-b',\n};")).filter((outcome) =>
        outcome.startsWith('2 '),
      ),
      [`2 StringLiteral ${staticReason}`],
    );
  });

  it('keeps the meta tags as written', async () => {
    const { outcomes } = setup('mutate');

    assert.deepEqual(
      (await outcomes("export default {\n  tags: ['a'],\n};")).filter(
        (outcome) => outcome.startsWith('2 '),
      ),
      [`2 ArrayDeclaration ${staticReason}`, `2 StringLiteral ${staticReason}`],
    );
  });

  it("keeps a story's tags as written", async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {\n  tags: ['!test'],\n};",
        )
      ).filter((outcome) => outcome.startsWith('3 ')),
      [`3 ArrayDeclaration ${staticReason}`, `3 StringLiteral ${staticReason}`],
    );
  });

  it('keeps the tags that the meta names as written', async () => {
    const { outcomes } = setup('mutate');

    assert.deepEqual(
      (await outcomes("const tags = ['a'];\nexport default { tags };")).filter(
        (outcome) => outcome.startsWith('1 '),
      ),
      [`1 ArrayDeclaration ${staticReason}`, `1 StringLiteral ${staticReason}`],
    );
  });

  it('keeps a title that the meta names as written', async () => {
    const { outcomes } = setup('mutate');

    assert.deepEqual(
      (
        await outcomes("const title = 'a/b';\nexport default { title };")
      ).filter((outcome) => outcome.startsWith('1 ')),
      [`1 StringLiteral ${staticReason}`],
    );
  });

  it('keeps a meta title under satisfies as written', async () => {
    const { outcomes } = setup('mutate');

    assert.deepEqual(
      (
        await outcomes("export default {\n  title: 'a/b' satisfies string,\n};")
      ).filter((outcome) => outcome.startsWith('2 ')),
      [`2 StringLiteral ${staticReason}`],
    );
  });

  it('keeps the meta includeStories as written', async () => {
    const { outcomes } = setup('mutate');

    assert.deepEqual(
      (await outcomes("export default {\n  includeStories: ['A'],\n};")).filter(
        (outcome) => outcome.startsWith('2 '),
      ),
      [`2 ArrayDeclaration ${staticReason}`, `2 StringLiteral ${staticReason}`],
    );
  });

  it('keeps the meta excludeStories as written', async () => {
    const { outcomes } = setup('mutate');

    assert.deepEqual(
      (
        await outcomes("export default {\n  excludeStories: ['data'],\n};")
      ).filter((outcome) => outcome.startsWith('2 ')),
      [`2 ArrayDeclaration ${staticReason}`, `2 StringLiteral ${staticReason}`],
    );
  });

  it("keeps a story's name as written", async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {\n  name: 'Go',\n};",
        )
      ).filter((outcome) => outcome.startsWith('3 ')),
      [`3 StringLiteral ${staticReason}`],
    );
  });

  it("keeps a story's storyName as written", async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {\n  storyName: 'Go',\n};",
        )
      ).filter((outcome) => outcome.startsWith('3 ')),
      [`3 StringLiteral ${staticReason}`],
    );
  });

  it("keeps a story's __id as written", async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {\n  parameters: {\n    __id: 'x',\n  },\n};",
        )
      ).filter((outcome) => outcome.startsWith('4 ')),
      [`4 StringLiteral ${staticReason}`],
    );
  });

  it('keeps a name assigned to X.storyName as written', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = () => null;\nA.storyName = 'Go';",
        )
      ).filter((outcome) => outcome.startsWith('3 ')),
      [`3 StringLiteral ${staticReason}`],
    );
  });

  it('keeps a name assigned to X.storyName of a factory story as written', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "import preview from '#.storybook/preview';\nconst meta = preview.meta({ component: B });\nexport const A = meta.story({});\nA.storyName = 'Go';",
        )
      ).filter((outcome) => outcome.startsWith('4 ')),
      [`4 StringLiteral ${staticReason}`],
    );
  });

  it('places a name assigned to X.input.storyName of a factory story', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "import preview from '#.storybook/preview';\nconst meta = preview.meta({ component: B });\nexport const A = meta.story({});\nA.input.storyName = 'Go';",
        )
      ).filter((outcome) => outcome.startsWith('4 ')),
      ['4 StringLiteral placed'],
    );
  });

  it('keeps a name assigned to the storyName of an exported function story as written', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport function A() {\n  return null;\n}\nA.storyName = 'Go';",
        )
      ).filter((outcome) => outcome.startsWith('5 ')),
      [`5 StringLiteral ${staticReason}`],
    );
  });

  it('keeps tags assigned to X.tags as written', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = () => null;\nA.tags = ['!test'];",
        )
      ).filter((outcome) => outcome.startsWith('3 ')),
      [`3 ArrayDeclaration ${staticReason}`, `3 StringLiteral ${staticReason}`],
    );
  });

  it('keeps the tags that X.tags names as written', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = () => null;\nconst tg = ['x'];\nA.tags = tg;",
        )
      ).filter((outcome) => outcome.startsWith('3 ')),
      [`3 ArrayDeclaration ${staticReason}`, `3 StringLiteral ${staticReason}`],
    );
  });

  it('places tags assigned to an object that is not a story', async () => {
    const { outcomes } = setup('mutate');

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nconst helper = {};\nhelper.tags = ['x'];",
        )
      ).filter((outcome) => outcome.startsWith('3 ')),
      ['3 ArrayDeclaration placed', '3 StringLiteral placed'],
    );
  });

  it('keeps __namedExportsOrder as written', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {};\nexport const __namedExportsOrder = ['A'];",
        )
      ).filter((outcome) => outcome.startsWith('3 ')),
      [`3 ArrayDeclaration ${staticReason}`, `3 StringLiteral ${staticReason}`],
    );
  });

  it("keeps the name of a .test() call as written in 'mutate' mode", async () => {
    const { outcomes } = setup('mutate');

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {};\nA.test('name', async () => {\n  await x();\n});",
        )
      ).filter((outcome) => /^3 StringLiteral/.test(outcome)),
      [`3 StringLiteral ${staticReason}`],
    );
  });

  it("keeps the tags in the options of a .test() call as written in 'mutate' mode", async () => {
    const { outcomes } = setup('mutate');

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {};\nA.test(\n  'name',\n  { tags: ['x'] },\n  () => undefined,\n);",
        )
      ).filter((outcome) =>
        /^5 (ArrayDeclaration|StringLiteral)/.test(outcome),
      ),
      [`5 ArrayDeclaration ${staticReason}`, `5 StringLiteral ${staticReason}`],
    );
  });

  it('keeps the tags that the options of a .test() call name as written', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {};\nconst tg = ['t'];\nA.test('name', { tags: tg }, () => undefined);",
        )
      ).filter((outcome) => outcome.startsWith('3 ')),
      [`3 ArrayDeclaration ${staticReason}`, `3 StringLiteral ${staticReason}`],
    );
  });

  it('keeps the tags in the options object that a .test() call names as written', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {};\nconst opts = {\n  tags: ['x'],\n};\nA.test('name', opts, () => undefined);",
        )
      ).filter((outcome) => outcome.startsWith('4 ')),
      [`4 ArrayDeclaration ${staticReason}`, `4 StringLiteral ${staticReason}`],
    );
  });

  it('keeps a story exported under a string name as written', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nconst A = {};\nexport { A as 'B c' };",
        )
      ).filter((outcome) => outcome.startsWith('3 ')),
      [`3 StringLiteral ${staticReason}`],
    );
  });

  it("keeps a story's name as written in 'mutate' mode", async () => {
    const { outcomes } = setup('mutate');

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {\n  name: 'Go',\n};",
        )
      ).filter((outcome) => outcome.startsWith('3 ')),
      [`3 StringLiteral ${staticReason}`],
    );
  });
});
