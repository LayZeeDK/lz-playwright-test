import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { vitestTransform } from 'storybook/internal/csf-tools';

import { parseProgram } from '../src/parse.ts';
import {
  classifyStubs,
  defaultTestTags,
  type TestTags,
} from '../src/reset-setting.ts';

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
  { previewTags, include, exclude, skip }: TestTags,
): Promise<readonly string[]> {
  const text = await vitestTransform({
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

  return [
    ...new Set(
      [...text.matchAll(/exportName: "([^"]*)"/g)].flatMap(([, name]) =>
        name === undefined ? [] : [name],
      ),
    ),
  ];
}

describe("classifyStubs tests the stories that Storybook's Vitest transform tests", () => {
  rows.forEach(({ name, code, testTags, todo }) => {
    it(name, { todo }, async () => {
      const tags = { ...defaultTestTags, ...testTags };

      assert.deepEqual(
        packageStories(code, tags),
        await storybookStories(code, tags),
      );
    });
  });
});
