import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { verdictsOf } from './support/reset-setting.ts';
import { testTags } from './support/test-tags.ts';

describe('classifyStubs tag filter', () => {
  it('leaves out a story without a tag that include names', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { parameters: { test: { mockReset: true } } };
export const B = { tags: ['smoke'], args: { g: fn().mockReturnValue(1) } };`,
      testTags({ include: ['smoke'] }),
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('keeps stories that each have one of the tags that include names', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { tags: ['smoke'], parameters: { test: { mockReset: true } } };
export const B = { tags: ['fast'], args: { g: fn().mockReturnValue(1) } };`,
      testTags({ include: ['smoke', 'fast'] }),
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('keeps a story without the test tag when include is empty', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { tags: ['!test'], parameters: { test: { mockReset: true } } };
export const B = { args: { g: fn().mockReturnValue(1) } };`,
      testTags({ include: [] }),
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('gives a story with a play the play-fn tag', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { play: () => undefined, parameters: { test: { mockReset: true } } };
export const B = { args: { g: fn().mockReturnValue(1) } };`,
      testTags({ include: ['play-fn'] }),
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('gives a story assigned a play the play-fn tag', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { parameters: { test: { mockReset: true } } };
A.play = () => undefined;
export const B = { args: { g: fn().mockReturnValue(1) } };`,
      testTags({ include: ['play-fn'] }),
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('gives the stories of a meta with a play the play-fn tag', () => {
    const verdicts = verdictsOf(
      `export default { play: () => undefined, parameters: { test: { restoreMocks: false } } };
export const A = { parameters: { test: { mockReset: true } } };
export const B = { args: { g: fn().mockReturnValue(1) } };`,
      testTags({ include: ['play-fn'] }),
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('leaves out a story with a tag that exclude names', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { tags: ['flaky'], parameters: { test: { mockReset: true } } };
export const B = { args: { g: fn().mockReturnValue(1) } };`,
      testTags({ exclude: ['flaky'] }),
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('leaves out a story with a tag that skip names', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { tags: ['slow'], parameters: { test: { mockReset: true } } };
export const B = { args: { g: fn().mockReturnValue(1) } };`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('leaves out a story with one of the tags that skip names', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { tags: ['slow'], parameters: { test: { mockReset: true } } };
export const B = { args: { g: fn().mockReturnValue(1) } };`,
      testTags({ skip: ['slow', 'flaky'] }),
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it("leaves out a story the preview's tags take out of the test tag", () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { parameters: { test: { mockReset: true } } };
export const B = { tags: ['test'], args: { g: fn().mockReturnValue(1) } };`,
      testTags({ previewTags: ['!test'] }),
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('gives every story the dev tag', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { parameters: { test: { mockReset: true } } };
export const B = { args: { g: fn().mockReturnValue(1) } };`,
      testTags({ include: ['dev'] }),
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('reads tags that a story names', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
const untested = ['!test'];
export const A = { tags: untested, parameters: { test: { mockReset: true } } };
export const B = { args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('leaves out a story tagged !test', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { tags: ['!test'], parameters: { test: { mockReset: true } } };
export const B = { args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('leaves out the stories of a meta tagged !test', () => {
    const verdicts = verdictsOf(
      `export default { tags: ['!test'] };
export const A = { parameters: { test: { mockReset: true } } };
export const B = { args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('leaves out a story assigned the tag !test', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { parameters: { test: { mockReset: true } } };
A.tags = ['!test'];
export const B = { args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('reads tags assigned to a story over the tags it declares', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { tags: ['!test'], parameters: { test: { mockReset: true } } };
A.tags = ['test'];
export const B = { args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('keeps a factory story whose input is assigned the tag !test', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ parameters: { test: { mockReset: true } } });
A.input.tags = ['!test'];
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('leaves out a factory story assigned the tag !test', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ parameters: { test: { mockReset: true } } });
A.tags = ['!test'];
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it("keeps a story made by .extend() on a story tagged !test, as Storybook's Vitest transform reads only the extend argument's tags", () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({});
export const A = meta.story({ tags: ['!test'] });
export const B = A.extend({ args: { g: fn().mockReturnValue(1) } });`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('leaves out a factory story whose input is assigned a tag that skip names', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ parameters: { test: { mockReset: true } } });
A.input.tags = ['slow'];
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('keeps a story with a play when skip names play-fn, a tag only the index gives it', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { play: async () => undefined, parameters: { test: { mockReset: true } } };
export const B = { args: { g: fn().mockReturnValue(1) } };`,
      testTags({ skip: ['play-fn'] }),
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('leaves out the stories of a meta with a tag that skip names', () => {
    const verdicts = verdictsOf(
      `export default { tags: ['slow'] };
export const A = { parameters: { test: { mockReset: true } } };
export const B = { args: { g: fn().mockReturnValue(1) } };`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it("leaves out the stories when the preview's tags hold a tag that skip names", () => {
    const verdicts = verdictsOf(
      `export default {};
export const A = { parameters: { test: { mockReset: true } } };
export const B = { args: { g: fn().mockReturnValue(1) } };`,
      testTags({ previewTags: ['slow'], skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it("keeps a story that negates its meta's tag that skip names", () => {
    const verdicts = verdictsOf(
      `export default { tags: ['slow'] };
export const A = { tags: ['!slow'], parameters: { test: { mockReset: true } } };
export const B = { args: { g: fn().mockReturnValue(1) } };`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('keeps a factory story with a tag that skip names when a .test() call negates that tag', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ tags: ['slow'], parameters: { test: { mockReset: true } } });
A.test('runs', { tags: ['!slow'] }, async () => undefined);
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('leaves out a factory story whose .test() call negates its tag that skip names when skip also names test-fn, a tag every .test() call gets', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ tags: ['slow'], parameters: { test: { mockReset: true } } });
A.test('runs', { tags: ['!slow'] }, async () => undefined);
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow', 'test-fn'] }),
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('keeps a factory story with the autodocs tag that skip names when it has a .test() call, which takes autodocs away', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ tags: ['autodocs'], parameters: { test: { mockReset: true } } });
A.test('runs', {}, async () => undefined);
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['autodocs'] }),
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('reads a story with a tag that skip names as unknown when the options of its .test() call cannot be read', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
import { fast } from './options';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ tags: ['slow'], parameters: { test: { mockReset: true } } });
A.test('runs', fast, async () => undefined);
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a story with a tag that skip names as unknown when a .test() call that negates it sets parameters', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ tags: ['slow'] });
A.test('runs', { tags: ['!slow'], parameters: { test: { mockReset: true } } }, async () => undefined);
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it("leaves out a factory story when a .test() call negates its meta's tag that skip names", () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ tags: ['slow'], parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ parameters: { test: { mockReset: true } } });
A.test('runs', { tags: ['!slow'] }, async () => undefined);
export const B = meta.story({ tags: ['!slow'], args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('leaves out a factory story with a tag that skip names when a .test() call that keeps it sets parameters', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ tags: ['slow'] });
A.test('runs', { parameters: { test: { mockReset: true } } }, async () => undefined);
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('leaves out a story that is no factory story with a tag that skip names when a .test() call negates that tag', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { tags: ['slow'], parameters: { test: { mockReset: true } } };
A.test('runs', { tags: ['!slow'] }, async () => undefined);
export const B = { args: { g: fn().mockReturnValue(1) } };`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('leaves out a factory story with a tag that skip names when its .test() call has no options', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ tags: ['slow'], parameters: { test: { mockReset: true } } });
A.test('runs', async () => undefined);
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('reads a factory story with a tag that skip names as unknown when a .test() call is named by a template literal, which the index leaves out', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ tags: ['slow'], parameters: { test: { mockReset: true } } });
A.test(\`runs\`, { tags: ['!slow'] }, async () => undefined);
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a story with a tag that skip names as unknown when a .test() call whose name cannot be read comes before the call the index names', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ tags: ['slow'], parameters: { test: { mockReset: true } } });
A.test(\`runs\`, { tags: ['!slow'] }, async () => undefined);
A.test('runs', async () => undefined);
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a story with a tag that skip names as unknown when a nested .test() call comes before a top-level call of the same name', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ tags: ['slow'], parameters: { test: { mockReset: true } } });
{ A.test('runs', { tags: ['!slow'] }, async () => undefined); }
A.test('runs', async () => undefined);
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a story with a tag that skip names as unknown when a .test() call in a function that runs comes before a top-level call of the same name', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ tags: ['slow'], parameters: { test: { mockReset: true } } });
function addSmoke() { A.test('runs', { tags: ['!slow'] }, async () => undefined); }
addSmoke();
A.test('runs', async () => undefined);
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a story with a tag that skip names as unknown when a .test() call through a computed member comes before a top-level call of the same name', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ tags: ['slow'], parameters: { test: { mockReset: true } } });
A['test']('runs', { tags: ['!slow'] }, async () => undefined);
A.test('runs', async () => undefined);
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a story with a tag that skip names as unknown when a nested .test() call and a top-level optional call of the same name give as many calls as the index lists', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ tags: ['slow'], parameters: { test: { mockReset: true } } });
{ A.test('runs', { tags: ['!slow'] }, async () => undefined); }
A.test?.('runs', async () => undefined);
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a factory story with a tag that skip names as unknown when a top-level .test() call is optional, which the index leaves out', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ tags: ['slow'], parameters: { test: { mockReset: true } } });
A.test?.('runs', { tags: ['!slow'] }, async () => undefined);
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a factory story as unknown when a top-level .test() call has one argument, which the index leaves out', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ tags: ['slow'], parameters: { test: { mockReset: true } } });
A.test('runs');
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a factory story as unknown when its input is given parameters by a logical assignment', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({});
A.input.parameters ??= { test: { mockReset: true } };
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a factory story named only by its declaration, its export, an indexed .test() call and a member assignment', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ tags: ['slow'] });
A.input.parameters = { test: { mockReset: true } };
A.test('runs', { tags: ['!slow'] }, async () => undefined);
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('keeps a factory story with a tag that skip names when its first of two differently named .test() calls negates that tag', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ tags: ['slow'], parameters: { test: { mockReset: true } } });
A.test('first', { tags: ['!slow'] }, async () => undefined);
A.test('second', async () => undefined);
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('keeps a factory story with a tag that skip names when its second of two differently named .test() calls negates that tag', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ tags: ['slow'], parameters: { test: { mockReset: true } } });
A.test('first', async () => undefined);
A.test('second', { tags: ['!slow'] }, async () => undefined);
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('reads a factory story as unknown when a .test() call sets parameters and the story itself runs', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({});
A.test('resets', { parameters: { test: { mockReset: true } } }, async () => undefined);
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a factory story without a tag that skip names as unknown when the options of its .test() call cannot be read', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
import { fast } from './options';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({});
A.test('runs', fast, async () => undefined);
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a factory story as unknown when a top-level call of a member other than test names it', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({});
A.other('x', { parameters: { test: { mockReset: true } } });
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a factory story with a tag that skip names as unknown when its .test() call spreads its arguments', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ tags: ['slow'], parameters: { test: { mockReset: true } } });
A.test('runs', ...[{ tags: ['!slow'] }, async () => undefined]);
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it("leaves out a factory story with a tag that skip names when another story's .test() call of the same name negates that tag", () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ tags: ['slow'], parameters: { test: { mockReset: true } } });
export const C = meta.story({});
C.test('runs', { tags: ['!slow'] }, async () => undefined);
A.test('runs', async () => undefined);
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('leaves out a factory story with a tag that skip names when its .test() call passes a named test function and no options', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
import { check } from './check';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ tags: ['slow'], parameters: { test: { mockReset: true } } });
A.test('runs', check);
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('reads a story as unknown when skip is set and its run-time tags cannot be read', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
import { sharedTags } from './tags';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ parameters: { test: { mockReset: true } } });
A.input.tags = sharedTags;
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a story as unknown when skip is set and its run-time tags hold a value that is no string literal', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ parameters: { test: { mockReset: true } } });
A.input.tags = [1n];
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a story whose run-time tags cannot be read when skip is empty', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
import { sharedTags } from './tags';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ parameters: { test: { mockReset: true } } });
A.input.tags = sharedTags;
export const B = meta.story({ args: { g: fn().mockReturnValue(1) } });`,
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it("reads a story as unknown when skip is set and its meta's run-time tags cannot be read", () => {
    const verdicts = verdictsOf(
      `import { shared } from './shared';
export default { ...shared, parameters: { test: { restoreMocks: false } } };
export const A = { parameters: { test: { mockReset: true } } };
export const B = { args: { g: fn().mockReturnValue(1) } };`,
      testTags({ skip: ['slow'] }),
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('leaves out every story when skip names dev, a tag every story starts with', () => {
    const verdicts = verdictsOf(
      `export default {};
export const A = { parameters: { test: { mockReset: true } } };
export const B = { args: { g: fn().mockReturnValue(1) } };`,
      testTags({ skip: ['dev'] }),
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('leaves out every story when skip names test, a tag every story starts with', () => {
    const verdicts = verdictsOf(
      `export default {};
export const A = { parameters: { test: { mockReset: true } } };
export const B = { args: { g: fn().mockReturnValue(1) } };`,
      testTags({ skip: ['test'] }),
    );

    assert.deepEqual(verdicts, ['kept']);
  });
});
