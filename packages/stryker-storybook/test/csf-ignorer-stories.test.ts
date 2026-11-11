import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { setup, containerReason } from './support/csf-ignorer.ts';

describe('lz-storybook-csf', () => {
  it("places the mutants of a story's args", async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {\n  args: { label: 'Go' },\n};",
        )
      ).filter((outcome) => outcome.startsWith('3 ')),
      ['3 ObjectLiteral placed', '3 StringLiteral placed'],
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
        `2 ObjectLiteral ${containerReason}`,
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
        `2 ObjectLiteral ${containerReason}`,
        `2 ObjectLiteral ${containerReason}`,
        `2 ArrowFunction ${containerReason}`,
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

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = { args: {} };",
        )
      ).filter((outcome) => outcome.startsWith('2 ')),
      ['2 ObjectLiteral placed'],
    );
  });

  it('keeps a story object under satisfies as written', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = { args: {} } satisfies Story;",
        )
      ).filter((outcome) => outcome.startsWith('2 ')),
      [`2 ObjectLiteral ${containerReason}`],
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
      [`2 ArrowFunction ${containerReason}`],
    );
  });

  it('keeps the template of a CSF2 Template.bind({}) story as written', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nconst Template = (args) =>\n  render(args);\nexport const A = Template.bind({});",
        )
      ).filter((outcome) => outcome.includes('ArrowFunction')),
      [`2 ArrowFunction ${containerReason}`],
    );
  });

  it('places the function that a .bind() call with arguments binds', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nconst fn = (args) =>\n  render(args);\nexport const A = fn.bind(null, 1 + 1);",
        )
      ).filter((outcome) => outcome.includes('ArrowFunction')),
      ['2 ArrowFunction placed'],
    );
  });

  it('places the function that a .bind() call with an empty context and arguments binds', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nconst fn = (args) =>\n  render(args);\nexport const A = fn.bind({}, 1 + 1);",
        )
      ).filter((outcome) => outcome.includes('ArrowFunction')),
      ['2 ArrowFunction placed'],
    );
  });

  it('keeps the template of a CSF2 Template.bind() story as written', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nconst Template = (args) =>\n  render(args);\nexport const A = Template.bind();",
        )
      ).filter((outcome) => outcome.includes('ArrowFunction')),
      [`2 ArrowFunction ${containerReason}`],
    );
  });

  it('places the function that a .bind() call binds to a named context', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nconst fn = (args) =>\n  render(args);\nexport const A = fn.bind(ctx);",
        )
      ).filter((outcome) => outcome.includes('ArrowFunction')),
      ['2 ArrowFunction placed'],
    );
  });

  it('places the function that a .bind() call binds to an object with properties', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nconst fn = (args) =>\n  render(args);\nexport const A = fn.bind({ a: 1 });",
        )
      ).filter((outcome) => outcome.includes('ArrowFunction')),
      ['2 ArrowFunction placed'],
    );
  });

  it('keeps the object passed to meta.story() as written', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "import preview from '#.storybook/preview';\nconst meta = preview.meta({ component: B });\nexport const A = meta.story({\n  args: { a: 1 },\n});",
        )
      ).filter((outcome) => outcome.startsWith('3 ')),
      [`3 ObjectLiteral ${containerReason}`],
    );
  });

  it('keeps the object passed to .extend() as written', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "import preview from '#.storybook/preview';\nconst meta = preview.meta({ component: B });\nexport const A = meta.story();\nexport const C = A.extend({\n  args: { a: 1 },\n});",
        )
      ).filter((outcome) => outcome.startsWith('4 ')),
      [`4 ObjectLiteral ${containerReason}`],
    );
  });

  it('places the object passed to a .story() call on a member', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = lib.presets.story({\n  args: { a: 1 },\n});",
        )
      ).filter((outcome) => outcome.startsWith('2 ')),
      ['2 ObjectLiteral placed'],
    );
  });

  it('places the mutants of a non-factory export of a CSF factory file', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "import preview from '#.storybook/preview';\nconst meta = preview.meta({ component: B });\nexport const A = meta.story();\nexport const helper = {\n  a: () => null,\n};",
        )
      ).filter((outcome) => /^[45] /.test(outcome)),
      ['4 ObjectLiteral placed', '5 ArrowFunction placed'],
    );
  });

  it('places the mutants of an export that excludeStories matches', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default {\n  title: 'a/b',\n  excludeStories: /.*Data$/,\n};\nexport const userData = {\n  name: 'Bob',\n};\nexport const A = {};",
        )
      ).filter((outcome) => /^[56] /.test(outcome)),
      ['5 ObjectLiteral placed', '6 StringLiteral placed'],
    );
  });

  it('places the mutants of an export that includeStories leaves out', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default {\n  title: 'a/b',\n  includeStories: ['A'],\n};\nexport const userData = {\n  name: 'Bob',\n};\nexport const A = {};",
        )
      ).filter((outcome) => /^[56] /.test(outcome)),
      ['5 ObjectLiteral placed', '6 StringLiteral placed'],
    );
  });

  it('places the mutants of an export that an excludeStories string matches', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default {\n  title: 'a/b',\n  excludeStories: 'Data$',\n};\nexport const userData = {\n  name: 'Bob',\n};\nexport const A = {};",
        )
      ).filter((outcome) => /^[56] /.test(outcome)),
      ['5 ObjectLiteral placed', '6 StringLiteral placed'],
    );
  });

  it('keeps a story that includeStories names by its string export name', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default {\n  title: 'a/b',\n  includeStories: ['B c'],\n};\nconst A = {\n  args: { a: 1 },\n};\nexport { A as 'B c' };",
        )
      ).filter((outcome) => outcome.startsWith('5 ')),
      [`5 ObjectLiteral ${containerReason}`],
    );
  });

  it('keeps a story object exported under another name as written', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nconst A = {\n  args: { a: 1 },\n};\nexport { A as B };",
        )
      ).filter((outcome) => outcome.startsWith('2 ')),
      [`2 ObjectLiteral ${containerReason}`],
    );
  });

  it('keeps an object assigned to X.story as written', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = () => null;\nA.story = {\n  parameters: { a: 1 },\n};",
        )
      ).filter((outcome) => outcome.startsWith('3 ')),
      [`3 ObjectLiteral ${containerReason}`],
    );
  });

  it('places an object assigned to a member of X.story', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = () => null;\nA.story.parameters = {\n  a: 1,\n};",
        )
      ).filter((outcome) => outcome.startsWith('3 ')),
      ['3 ObjectLiteral placed'],
    );
  });

  it('places the object passed to .story() for an export that the excludeStories of a later meta matches', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "import preview from '#.storybook/preview';\nconst base = preview.meta({});\nconst meta = preview.meta({ excludeStories: ['C'] });\nexport const A = meta.story();\nexport const C = meta.story({\n  args: { a: 1 },\n});",
        )
      ).filter((outcome) => outcome.startsWith('5 ')),
      ['5 ObjectLiteral placed'],
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
      [`3 ObjectLiteral ${containerReason}`, '5 ObjectLiteral placed'],
    );
  });

  it('keeps the options object of a .test() call as written', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {};\nA.test(\n  'name',\n  { tags: ['x'] },\n  () => undefined,\n);",
        )
      ).filter((outcome) => outcome.startsWith('5 ObjectLiteral')),
      [`5 ObjectLiteral ${containerReason}`],
    );
  });

  it('keeps the options object that a .test() call names as written', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {};\nconst opts = {\n  tags: ['x'],\n};\nA.test('name', opts, () => undefined);",
        )
      ).filter((outcome) => outcome.startsWith('3 ')),
      [`3 ObjectLiteral ${containerReason}`],
    );
  });

  it('places the mutants of a definePreview() call exported from a story file', async () => {
    const { outcomes } = setup();

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const P = sb.definePreview({ tags: ['a'] });",
        )
      ).filter((outcome) => outcome.startsWith('2 ')),
      [
        '2 ObjectLiteral placed',
        '2 ArrayDeclaration placed',
        '2 StringLiteral placed',
      ],
    );
  });

  it("places a story's globals in 'mutate' mode", async () => {
    const { outcomes } = setup('mutate');

    assert.deepEqual(
      (
        await outcomes(
          "export default { title: 'a/b' };\nexport const A = {\n  globals: { theme: 'dark' },\n};",
        )
      ).filter((outcome) => outcome.startsWith('3 ')),
      ['3 ObjectLiteral placed', '3 StringLiteral placed'],
    );
  });

  it("places the meta's globals in 'mutate' mode", async () => {
    const { outcomes } = setup('mutate');

    assert.deepEqual(
      (
        await outcomes("export default {\n  globals: { theme: 'dark' },\n};")
      ).filter((outcome) => outcome.startsWith('2 ')),
      ['2 ObjectLiteral placed', '2 StringLiteral placed'],
    );
  });
});
