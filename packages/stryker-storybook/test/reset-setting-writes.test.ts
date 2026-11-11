import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyStubs } from '../src/reset-setting.ts';
import { storyFile, verdictsOf } from './support/reset-setting.ts';
import { testTags, untaggedPreviewTestTags } from './support/test-tags.ts';

describe('classifyStubs run-time writes', () => {
  it('reads a factory story as unknown when a function returns it', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({});
function same() { return A; }
same().input.parameters = { test: { mockReset: true } };
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a story with a tag that skip names as unknown when it is passed to a function inside a spread', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
import { addSmoke } from './smoke';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ tags: ['slow'], parameters: { test: { mockReset: true } } });
const smoke = { ...addSmoke(A) };
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a story with a tag that skip names as unknown when it is passed to a function', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
import { addSmoke } from './smoke';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ tags: ['slow'], parameters: { test: { mockReset: true } } });
addSmoke(A);
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a story as unknown when a top-level declaration calls its method', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { parameters: { test: { mockReset: true } } };
const a = A.toString();
export const B = { args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a story as unknown when an object property that a call receives holds it', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { parameters: { test: { mockReset: true } } };
console.log({ a: A });
export const B = { args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a story that a typeof type query names', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { parameters: { test: { mockReset: true } } };
type T = typeof A;
export const B = { args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('reads a factory story as unknown when an alias of it is assigned parameters', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({});
const alias = A;
alias.input.parameters = { test: { mockReset: true } };
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a factory story as unknown when a spread copy of it is assigned parameters', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({});
const C = { ...A };
C.input.parameters = { test: { mockReset: true } };
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a factory story as unknown when an alias of a spread copy of it is assigned parameters', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({});
const C = { ...A };
const alias = C;
alias.input.parameters = { test: { mockReset: true } };
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a factory story as unknown when a spread copy of a spread copy of it is assigned parameters', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({});
const C = { ...A };
const D = { ...C };
D.input.parameters = { test: { mockReset: true } };
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a factory story as unknown when a call result that holds a spread of it is assigned parameters', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({});
const C = Object.assign({}, { ...A });
C.input.parameters = { test: { mockReset: true } };
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a story that another story copies by a spread under satisfies, with no write through the copy', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { args: { g: fn().mockReturnValue(1) } };
export const C = { ...A } satisfies object;`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('reads a story as unknown when a spread copy of it is written below its parameters', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { parameters: { test: { restoreMocks: false } } };
const C = { ...A };
C.parameters.test.mockReset = true;
export const B = { args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a factory story as unknown when a destructured spread copy of it is assigned parameters', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({});
const { input } = { ...A };
input.parameters = { test: { mockReset: true } };
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a factory story as unknown when a rest copy of a spread of it is assigned parameters', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({});
const { ...C } = { ...A };
C.input.parameters = { test: { mockReset: true } };
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a story as unknown when a destructured spread copy of it is written below its parameters', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { parameters: { test: { restoreMocks: false } } };
const { parameters } = { ...A };
parameters.test.mockReset = true;
export const B = { args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a story as unknown when the story it spreads is written below its parameters after the spread', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { tags: ['slow'], parameters: { test: { restoreMocks: false } } };
export const C = { ...A, tags: [], args: { g: fn().mockReturnValue(1) } };
A.parameters.test.mockReset = true;`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a story as unknown when the local object it spreads is written below its parameters after the spread', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
const base = { parameters: { test: { restoreMocks: false } } };
export const C = { ...base, args: { g: fn().mockReturnValue(1) } };
base.parameters.test.mockReset = true;`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a story that spreads another story when nothing writes to either', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { parameters: { test: { restoreMocks: false } } };
export const B = { ...A, args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('reads a story as unknown when the local object it spreads under as is written below its parameters', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
const base = { parameters: { test: { restoreMocks: false } } };
export const C = { ...(base as object), args: { g: fn().mockReturnValue(1) } };
base.parameters.test.mockReset = true;`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a story as unknown when the local object it spreads under satisfies is written below its parameters', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
const base = { parameters: { test: { restoreMocks: false } } };
export const C = { ...(base satisfies object), args: { g: fn().mockReturnValue(1) } };
base.parameters.test.mockReset = true;`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a story as unknown when the local object it spreads under a non-null assertion is written below its parameters', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
const base = { parameters: { test: { restoreMocks: false } } };
export const C = { ...base!, args: { g: fn().mockReturnValue(1) } };
base.parameters.test.mockReset = true;`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('keeps a story that spreads one local object under as apart from a written story that spreads another under as', () => {
    const { stories } = classifyStubs(
      storyFile(
        `export default { parameters: { test: { restoreMocks: false } } };
const base = { parameters: { test: { restoreMocks: false } } };
const other = {};
export const C = { ...(base as object) };
export const A = { ...(other as object) };
A.parameters = {};`,
        'X.stories.ts',
      ),
      {},
      untaggedPreviewTestTags,
    );

    assert.deepEqual(stories, [
      { name: 'C', branch: 'none' },
      { name: 'A', branch: 'unknown' },
    ]);
  });

  it('reads a story as unknown when the local object its parameters spread is written below it', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
const p = { test: { restoreMocks: false } };
export const C = { parameters: { ...p }, args: { g: fn().mockReturnValue(1) } };
p.test.mockReset = true;`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a story whose parameters spread a local object when nothing writes to it', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
const p = { test: { restoreMocks: false } };
export const C = { parameters: { ...p }, args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('reads a story as unknown when the local object it names as its parameters is written below it', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
const p = { test: { restoreMocks: false } };
export const C = { parameters: p, args: { g: fn().mockReturnValue(1) } };
p.test.mockReset = true;`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a story as unknown when a local object it names below its parameters is written below it', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
const t = { restoreMocks: false };
export const C = { parameters: { test: t }, args: { g: fn().mockReturnValue(1) } };
t.mockReset = true;`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a story that names a local object as its parameters when nothing writes to it', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
const p = { test: { restoreMocks: false } };
export const C = { parameters: p, args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('reads a story as unknown when it is assigned a local object as its parameters and that object is written', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
const p = { test: { restoreMocks: false } };
export const C = { args: { g: fn().mockReturnValue(1) } };
C.parameters = p;
p.test.mockReset = true;`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads every story as unknown when the meta is written below its parameters', () => {
    const verdicts = verdictsOf(
      `const meta = { parameters: { test: { restoreMocks: false } } };
export default meta;
meta.parameters.test.mockReset = true;
export const B = { args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads every story as unknown when the default export spreads a local object that is written below it', () => {
    const verdicts = verdictsOf(
      `const base = { parameters: { test: { restoreMocks: false } } };
export default { ...base };
base.parameters.test.mockReset = true;
export const B = { args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads every story as unknown when the meta spreads a local object that is written below it', () => {
    const verdicts = verdictsOf(
      `const base = { parameters: { test: { restoreMocks: false } } };
const meta = { ...base };
export default meta;
base.parameters.test.mockReset = true;
export const B = { args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads the stories of a default export that spreads a story when nothing writes to either', () => {
    const verdicts = verdictsOf(
      `export const A = { parameters: { test: { restoreMocks: false } } };
export default { ...A };
export const B = { args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('reads every factory story as unknown when the factory meta is written below its parameters', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
meta.input.parameters.test.mockReset = true;
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads every factory story as unknown when the factory meta spreads a local object that is written below it', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const base = { parameters: { test: { restoreMocks: false } } };
const meta = preview.meta({ ...base });
base.parameters.test.mockReset = true;
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads the stories of a factory meta that spreads a local object when nothing writes to it', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const base = { parameters: { test: { restoreMocks: false } } };
const meta = preview.meta({ ...base });
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('reads a story as unknown when a computed member key passes it to a function', () => {
    const verdicts = verdictsOf(
      `import { register } from './register';
export default { parameters: { test: { restoreMocks: false } } };
export const A = { args: { g: fn().mockReturnValue(1) } };
const registry = {};
registry[register(A)] = true;`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a story alone in its family that is assigned args', () => {
    const verdicts = verdictsOf(
      `export default {};
export const A = { parameters: { test: { restoreMocks: false } } };
A.args = { g: fn().mockReturnValue(1) };`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('keeps a story that spreads one local object under as when another story spreads another under as', () => {
    const { stories } = classifyStubs(
      storyFile(
        `export default { parameters: { test: { restoreMocks: false } } };
const base = { parameters: { test: { restoreMocks: false } } };
const other = {};
export const C = { ...(base as object) };
export const A = { ...(other as object) };`,
        'X.stories.ts',
      ),
      {},
      untaggedPreviewTestTags,
    );

    assert.deepEqual(stories, [
      { name: 'C', branch: 'none' },
      { name: 'A', branch: 'none' },
    ]);
  });

  it('keeps two stories that spread object literals confident when one of them is assigned parameters', () => {
    const { stories } = classifyStubs(
      storyFile(
        `export default { parameters: { test: { restoreMocks: false } } };
export const C = { ...{ parameters: { test: { restoreMocks: false } } } };
export const A = { ...{} };
A.parameters = {};`,
        'X.stories.ts',
      ),
      {},
      untaggedPreviewTestTags,
    );

    assert.deepEqual(stories, [
      { name: 'C', branch: 'none' },
      { name: 'A', branch: 'none' },
    ]);
  });
});
