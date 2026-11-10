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
const storyReason =
  '@layzee/stryker-storybook: Storybook reads this story without running the file, so it stays an object or a function';
const testReason =
  '@layzee/stryker-storybook: test code in a story file is mutated by the Stryker config with lzStorybookCsf.play set to mutate';
const mswReason =
  '@layzee/stryker-storybook: msw handlers in a story file are mutated by the Stryker config with lzStorybookCsf.play set to mutate';

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
    warnings: async (code: string) =>
      (await instrument('src/a.stories.tsx', code, [ignorer])).warnings,
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

  it('keeps a multi-line story object as written and places what it holds', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {\n  args: { label: 'Go' },\n  render: () => null,\n};",
        )
      ).filter((outcome) =>
        /^[2-9] (ObjectLiteral|ArrowFunction)/.test(outcome),
      ),
      [
        `2 ObjectLiteral ${storyReason}`,
        '3 ObjectLiteral placed',
        '4 ArrowFunction placed',
      ],
    );
  });

  it('keeps every object and arrow function on the line of a single-line story', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = { args: { y: 2 }, render: () => null };",
        )
      ).filter((outcome) => /^2 (ObjectLiteral|ArrowFunction)/.test(outcome)),
      [
        `2 ObjectLiteral ${storyReason}`,
        `2 ObjectLiteral ${storyReason}`,
        `2 ArrowFunction ${storyReason}`,
      ],
    );
  });

  it('gives no Stryker warning for the story directives', async () => {
    const { warnings } = setup();

    assert.deepEqual(
      await warnings(
        "export default { title: 'a/b' };\nexport const A = {\n  args: { label: 'Go' },\n};",
      ),
      [],
    );
  });

  it("places a story object's own mutant in 'mutate' mode", async () => {
    const { outcomes } = setup('mutate');

    assert.ok(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = { args: {} };",
        )
      ).includes('2 ObjectLiteral placed'),
    );
  });

  it('keeps a story object under satisfies as written', async () => {
    const { outcomes } = setup();

    assert.ok(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = { args: {} } satisfies Story;",
        )
      ).includes(`2 ObjectLiteral ${storyReason}`),
    );
  });

  it('keeps a CSF2 arrow function story as written', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = (args) =>\n  render(args);",
        )
      ).filter((outcome) => outcome.includes('ArrowFunction')),
      [`2 ArrowFunction ${storyReason}`],
    );
  });

  it('keeps the object passed to meta.story() as written', async () => {
    const { outcomes } = setup();

    assert.ok(
      (
        await outcomes(
          'const meta = preview.meta({ component: B });\nexport const A = meta.story({\n  args: { a: 1 },\n});',
        )
      ).includes(`2 ObjectLiteral ${storyReason}`),
    );
  });

  it('keeps the object passed to .extend() as written', async () => {
    const { outcomes } = setup();

    assert.ok(
      (
        await outcomes(
          'const meta = preview.meta({ component: B });\nexport const A = meta.story();\nexport const C = A.extend({\n  args: { a: 1 },\n});',
        )
      ).includes(`3 ObjectLiteral ${storyReason}`),
    );
  });

  it('keeps a story object exported under another name as written', async () => {
    const { outcomes } = setup();

    assert.ok(
      (
        await outcomes(
          "export default { title: 'a/b' };\nconst A = {\n  args: { a: 1 },\n};\nexport { A as B };",
        )
      ).includes(`2 ObjectLiteral ${storyReason}`),
    );
  });

  it('keeps an object assigned to X.story as written', async () => {
    const { outcomes } = setup();

    assert.ok(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = () => null;\nA.story = {\n  parameters: { a: 1 },\n};",
        )
      ).includes(`3 ObjectLiteral ${storyReason}`),
    );
  });

  it("keeps a story's parameters object that holds __id as written and places what it holds", async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {\n  parameters: {\n    __id: 'x',\n    b: { c: 1 },\n  },\n};",
        )
      ).filter((outcome) => /^[3-9] ObjectLiteral/.test(outcome)),
      [`3 ObjectLiteral ${storyReason}`, '5 ObjectLiteral placed'],
    );
  });

  it('keeps the options object of a .test() call as written', async () => {
    const { outcomes } = setup();

    assert.ok(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {};\nA.test(\n  'name',\n  { tags: ['x'] },\n  () => undefined,\n);",
        )
      ).includes(`5 ObjectLiteral ${storyReason}`),
    );
  });

  it("ignores a story's play function", async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {\n  play: async () => {\n    await x(1 + 1);\n  },\n};",
        )
      ).filter((outcome) => /^[34] /.test(outcome)),
      [`3 BlockStatement ${testReason}`, `4 ArithmeticOperator ${testReason}`],
    );
  });

  it("ignores a story's play method", async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {\n  async play() {\n    await x(1 + 1);\n  },\n};",
        )
      ).filter((outcome) => /^[34] /.test(outcome)),
      [`3 BlockStatement ${testReason}`, `4 ArithmeticOperator ${testReason}`],
    );
  });

  it('ignores a play function assigned to X.play', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {};\nA.play = async () => {\n  await x(1 + 1);\n};",
        )
      ).filter((outcome) => /^[34] /.test(outcome)),
      [`3 BlockStatement ${testReason}`, `4 ArithmeticOperator ${testReason}`],
    );
  });

  it("ignores the meta's play function", async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          'export default {\n  play: async () => {\n    await x(1 + 1);\n  },\n};',
        )
      ).filter((outcome) => /^[23] /.test(outcome)),
      [`2 BlockStatement ${metaReason}`, `3 ArithmeticOperator ${metaReason}`],
    );
  });

  it('ignores the body of a .test() call', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {};\nA.test('name', async () => {\n  await x(1 + 1);\n});",
        )
      ).filter((outcome) =>
        /^[34] (BlockStatement|ArithmeticOperator)/.test(outcome),
      ),
      [`3 BlockStatement ${testReason}`, `4 ArithmeticOperator ${testReason}`],
    );
  });

  it("ignores a story's beforeEach", async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {\n  beforeEach: async () => {\n    await x(1 + 1);\n  },\n};",
        )
      ).filter((outcome) => /^[34] /.test(outcome)),
      [`3 BlockStatement ${testReason}`, `4 ArithmeticOperator ${testReason}`],
    );
  });

  it("ignores a story's afterEach", async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {\n  afterEach: async () => {\n    await x(1 + 1);\n  },\n};",
        )
      ).filter((outcome) => /^[34] /.test(outcome)),
      [`3 BlockStatement ${testReason}`, `4 ArithmeticOperator ${testReason}`],
    );
  });

  it('ignores a function assigned to X.beforeEach', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {};\nA.beforeEach = async () => {\n  await x(1 + 1);\n};",
        )
      ).filter((outcome) => /^[34] /.test(outcome)),
      [`3 BlockStatement ${testReason}`, `4 ArithmeticOperator ${testReason}`],
    );
  });

  it("ignores the msw value in a story's parameters", async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {\n  parameters: {\n    msw: {\n      handlers: [h('/a')],\n    },\n  },\n};",
        )
      ).filter((outcome) => /^[3-5] /.test(outcome)),
      [
        '3 ObjectLiteral placed',
        `4 ObjectLiteral ${mswReason}`,
        `5 ArrayDeclaration ${mswReason}`,
        `5 StringLiteral ${mswReason}`,
      ],
    );
  });

  it('ignores the msw value in an object assigned to X.parameters', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {};\nA.parameters = {\n  msw: {\n    handlers: [h('/a')],\n  },\n};",
        )
      ).filter((outcome) => /^[3-5] /.test(outcome)),
      [
        '3 ObjectLiteral placed',
        `4 ObjectLiteral ${mswReason}`,
        `5 ArrayDeclaration ${mswReason}`,
        `5 StringLiteral ${mswReason}`,
      ],
    );
  });

  it('ignores the msw value in the parameters passed to meta.story()', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "const meta = preview.meta({ component: B });\nexport const A = meta.story({\n  parameters: {\n    msw: {\n      handlers: [h('/a')],\n    },\n  },\n});",
        )
      ).filter((outcome) => /^[4-5] /.test(outcome)),
      [
        `4 ObjectLiteral ${mswReason}`,
        `5 ArrayDeclaration ${mswReason}`,
        `5 StringLiteral ${mswReason}`,
      ],
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

  it('keeps the name of a .test() call as written', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {};\nA.test('name', async () => {\n  await x();\n});",
        )
      ).filter((outcome) => /^3 StringLiteral/.test(outcome)),
      [`3 StringLiteral ${staticReason}`],
    );
  });

  it('keeps the tags in the options of a .test() call as written', async () => {
    const { outcomes } = setup();

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
