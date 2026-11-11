import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { vitestTransform } from 'storybook/internal/csf-tools';

import { csfFile, storyIndex, topLevelBindings } from '../src/csf.ts';
import { field, list } from '../src/node-field.ts';
import { parseProgram } from '../src/parse.ts';
import { classifyStubs, type TestTags } from '../src/reset-setting.ts';
import { untaggedPreviewTestTags } from './support/test-tags.ts';

const noMain = fileURLToPath(new URL('fixtures/no-main/', import.meta.url));
const fileName = `${noMain}src/Button.stories.tsx`;

interface Row {
  readonly name: string;
  readonly code: string;
  readonly testTags?: Partial<TestTags>;
  readonly todo?: string;
}

const rows: readonly Row[] = [
  {
    name: 'the default tag filter',
    code: `export default {};
export const A = {};
export const B = { tags: ['!test'] };
`,
  },
  {
    name: 'a custom include, exclude and skip filter',
    code: `export default { tags: ['smoke'] };
export const A = {};
export const B = { tags: ['flaky'] };
export const C = { tags: ['slow'] };
export const D = { tags: ['!smoke'] };
`,
    testTags: { include: ['smoke'], exclude: ['flaky'], skip: ['slow'] },
  },
  {
    name: 'an empty include',
    code: `export default {};
export const A = { tags: ['!test'] };
export const B = {};
`,
    testTags: { include: [], previewTags: ['!dev'] },
  },
  {
    name: 'tags in a story annotation assigned to a story',
    code: `export default {};
export const A = {};
A.story = { tags: ['!test'] };
export const B = {};
`,
  },
  {
    name: 'a play in a story annotation assigned to a story',
    code: `export default {};
export const A = {};
A.story = { play: async () => undefined };
export const B = {};
`,
    testTags: { include: ['play-fn'] },
  },
  {
    name: 'a factory story exported by specifier',
    code: `import preview from '../.storybook/preview';
const meta = preview.meta({});
const A = meta.story({ tags: ['!test'] });
export { A };
export const B = meta.story({});
`,
  },
  {
    name: 'the play-fn tag of a story',
    code: `export default {};
export const A = {};
export const B = { play() {} };
export const C = { play: async () => undefined };
export const D = {};
D.play = async () => undefined;
`,
    testTags: { include: ['play-fn'] },
  },
  {
    name: 'a story made by .extend()',
    code: `import preview from '../.storybook/preview';
const meta = preview.meta({});
export const A = meta.story({ tags: ['!test'] });
export const B = A.extend({});
`,
  },
  {
    name: 'tags assigned to a story one level deep',
    code: `import preview from '../.storybook/preview';
const meta = preview.meta({});
export const A = meta.story({});
A.tags = ['!test'];
export const B = meta.story({});
B.input.tags = ['!test'];
`,
  },
  {
    name: 'a tag that is not a string literal',
    code: `export default {};
const smoke = 'smoke';
export const A = { tags: [smoke] };
`,
  },
  {
    name: 'preview tags',
    code: `export default { tags: ['test'] };
export const A = {};
export const B = { tags: ['!test'] };
`,
    testTags: { previewTags: ['!test'] },
  },
  {
    name: 'a story with a .test() whose tags leave the test out',
    code: `export default {};
export const A = {};
A.test('renders', { tags: ['!test'] }, async () => undefined);
`,
  },
  {
    name: 'a function exported by specifier from a factory file',
    code: `import preview from '../.storybook/preview';
const meta = preview.meta({});
export const A = meta.story({});
const helper = () => null;
export { helper };
`,
  },
  {
    name: 'a story exported by an export type statement',
    code: `export default {};
const A = {};
export type { A };
export const B = {};
`,
  },
  {
    name: 'a story exported by a type specifier',
    code: `export default {};
const A = {};
export { type A };
export const B = {};
`,
  },
  {
    name: 'a type alias exported by specifier',
    code: `export default {};
type A = {};
export { A };
export const B = {};
`,
  },
  {
    name: 'a meta object exported by specifier as default',
    code: `const meta = {};
export { meta as default };
export const A = {};
`,
  },
  {
    name: "a meta object exported by specifier as 'default'",
    code: `const meta = {};
export { meta as 'default' };
export const A = {};
`,
  },
  {
    name: 'a meta object under satisfies exported by specifier as default',
    code: `const meta = {} satisfies Meta;
export { meta as default };
export const A = {};
`,
  },
  {
    name: 'a factory meta exported by specifier as default',
    code: `import preview from '../.storybook/preview';
const meta = preview.meta({});
export { meta as default };
export const A = meta.story({});
`,
  },
  {
    name: '__namedExportsOrder',
    code: `export default {};
export const A = {};
export const __namedExportsOrder = ['A'];
`,
  },
  {
    name: 'a default function export',
    code: `export default function Meta() {}
export const A = {};
`,
  },
  {
    name: 'an exported class',
    code: `export default {};
export class A {}
export const B = {};
`,
  },
  {
    name: 'an includeStories array',
    code: `export default { includeStories: ['A', 'B'] };
export const A = {};
export const B = {};
export const C = {};
`,
  },
  {
    name: 'includeStories as a regular expression with flags',
    code: `export default { includeStories: /^a$/i };
export const A = {};
export const B = {};
`,
  },
  {
    name: 'a variable without an initializer exported by specifier',
    code: `export default {};
let A;
export { A };
export const B = {};
`,
  },
];

function packageStories(code: string, testTags: TestTags): readonly string[] {
  return classifyStubs(
    { program: parseProgram(code, fileName), code, fileName },
    {},
    testTags,
  ).stories.map(({ name }) => name);
}

/** Storybook checks skip tags on the run-time tags; here they join exclude and are checked on the static tags. A file Storybook cannot read has no tested stories. */
async function storybookStories(
  code: string,
  testTags: TestTags,
): Promise<readonly string[]> {
  const text = await transformed(code, testTags);

  return [
    ...new Set(
      [...text.matchAll(/exportName: "([^"]*)"/g)].flatMap(([, name]) =>
        name === undefined ? [] : [name],
      ),
    ),
  ];
}

async function transformed(
  code: string,
  { previewTags, include, exclude, skip }: TestTags,
): Promise<string> {
  return vitestTransform({
    code,
    fileName,
    configDir: `${noMain}.storybook`,
    stories: [{ directory: '../src', files: '**/*.stories.tsx' }],
    tagsFilter: {
      include: [...include],
      exclude: [...exclude, ...skip],
      skip: [],
    },
    previewLevelTags: [...previewTags],
  }).then(
    (result) => (typeof result === 'string' ? result : result.code),
    () => '',
  );
}

const childRows: readonly Row[] = [
  {
    name: 'a .test() call named by a template literal',
    code: `import preview from '../.storybook/preview';
const meta = preview.meta({});
export const A = meta.story({});
A.test(\`runs\`, { tags: ['!slow'] }, async () => undefined);
A.test('real', async () => undefined);
export const B = meta.story({});
`,
  },
];

function packageChildren(code: string): readonly (readonly [string, number])[] {
  const body = list(field(parseProgram(code, fileName), 'body'));
  return csfFile(
    body,
    topLevelBindings(body),
    storyIndex(code, fileName),
  ).stories.map(({ name, children }) => [name, children.length] as const);
}

async function storybookChildren(
  code: string,
): Promise<readonly (readonly [string, number])[]> {
  const text = await transformed(code, untaggedPreviewTestTags);
  const children = [
    ...text.matchAll(/exportName: "([^"]*)",[^}]*testName: "/g),
  ].flatMap(([, name]) => (name === undefined ? [] : [name]));

  return (await storybookStories(code, untaggedPreviewTestTags)).map(
    (name) =>
      [name, children.filter((child) => child === name).length] as const,
  );
}

describe("csfFile counts the .test() children that Storybook's Vitest transform tests", () => {
  childRows.forEach(({ name, code }) => {
    it(name, async () => {
      assert.deepEqual(packageChildren(code), await storybookChildren(code));
    });
  });
});

describe("classifyStubs tests the stories that Storybook's Vitest transform tests", () => {
  rows.forEach(({ name, code, testTags, todo }) => {
    it(name, { todo }, async () => {
      const tags = { ...untaggedPreviewTestTags, ...testTags };

      assert.deepEqual(
        packageStories(code, tags),
        await storybookStories(code, tags),
      );
    });
  });
});
