import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { verdictsOf } from './support/reset-setting.ts';

describe('classifyStubs stories', () => {
  it('finds a story exported through an export specifier', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
const A = {
  parameters: { test: { mockReset: true } },
  args: { g: fn().mockReturnValue(1) },
};
export { A };`,
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('leaves an export that excludeStories matches out of the stories', () => {
    const verdicts = verdictsOf(
      `export default {
  excludeStories: /.*Data$/,
  parameters: { test: { restoreMocks: false } },
};
export const TasksData = [{ id: '1' }];
export const A = { args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('leaves a type-only export out of the stories', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { args: { g: fn().mockReturnValue(1) } };
export type { Props } from './props';`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('leaves a type-only export specifier out of the stories', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
type Props = { label: string };
export const A = { args: { g: fn().mockReturnValue(1) } };
export { type Props };`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('reads the meta and preview settings for a function story', () => {
    const verdicts = verdictsOf(
      `export default {
  parameters: { test: { restoreMocks: false } },
  args: { g: fn().mockReturnValue(1) },
};
export function Primary() {
  return null;
}`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('reads an arrow function story as having no settings of its own', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { args: { g: fn().mockReturnValue(1) } };
export const B = () => null;`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('reads a function expression story as having no settings of its own', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { args: { g: fn().mockReturnValue(1) } };
export const B = function () {
  return null;
};`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('reads a Template.bind({}) story as having no settings of its own', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { args: { g: fn().mockReturnValue(1) } };
const Template = (args) => null;
export const B = Template.bind({});
B.args = {};`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('reads a story made by a call other than a template bind as unknown', () => {
    const verdicts = verdictsOf(
      `import { makeStory } from './make-story';
export default { parameters: { test: { restoreMocks: false } } };
export const A = { args: { g: fn().mockReturnValue(1) } };
export const B = makeStory({});`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads the parameters assigned to a function story after it', () => {
    const verdicts = verdictsOf(
      `export default {
  parameters: { test: { restoreMocks: false } },
  args: { g: fn().mockReturnValue(1) },
};
export function Primary() {
  return null;
}
Primary.parameters = { test: { mockReset: true } };`,
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('reads the parameters of a story annotation assigned to a story', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { args: { g: fn().mockReturnValue(1) } };
A.story = { parameters: { test: { mockReset: true } } };`,
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it("reads a story's own test parameter over its story annotation's", () => {
    const verdicts = verdictsOf(
      `export default {};
export const A = {
  parameters: { test: { restoreMocks: false } },
  args: { g: fn().mockReturnValue(1) },
};
A.story = { parameters: { test: { mockReset: true } } };`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('reads the parameters assigned to the local binding of a renamed story', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
const Local = { args: { g: fn().mockReturnValue(1) } };
export { Local as A };
Local.parameters = { test: { mockReset: true } };`,
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('reads a test parameter assigned through the parameters of a story', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { parameters: {}, args: { g: fn().mockReturnValue(1) } };
A.parameters.test = { mockReset: true };`,
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('reads a story made by a .story() call on a member as unknown', () => {
    const verdicts = verdictsOf(
      `import { lib } from './lib';
export default { parameters: { test: { restoreMocks: false } } };
export const A = { args: { g: fn().mockReturnValue(1) } };
export const B = lib.presets.story({});`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('keeps an unreadable story unknown when args are assigned to it', () => {
    const verdicts = verdictsOf(
      `import { makeStory } from './make-story';
export default { parameters: { test: { restoreMocks: false } } };
export const A = { args: { g: fn().mockReturnValue(1) } };
export const B = makeStory({});
B.args = {};`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads the parameters assigned to an object story after it', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { args: { g: fn().mockReturnValue(1) } };
A.parameters = { test: { mockReset: true } };`,
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('reads the parameters assigned to a story through a quoted key', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { args: { g: fn().mockReturnValue(1) } };
A['parameters'] = { test: { mockReset: true } };`,
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('reads args assigned through a quoted key as args', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { args: { g: fn().mockReturnValue(1) } };
A['args'] = { parameters: { test: { mockReset: true } } };`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('keeps the parameters of a story when args are assigned through a quoted key', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = {
  parameters: { test: { mockReset: true } },
  args: { g: fn().mockReturnValue(1) },
};
A['args'] = { x: 1 };`,
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('reads a test parameter assigned through a quoted key of the parameters of a story', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { args: { g: fn().mockReturnValue(1) } };
A.parameters = {};
A.parameters['test'] = { mockReset: true };`,
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('reads a story assigned to through a computed name as unknown', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { args: { g: fn().mockReturnValue(1) } };
const k = 'parameters';
A[k] = { test: { mockReset: true } };`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads an import assigned to the parameters of a story as unknown', () => {
    const verdicts = verdictsOf(
      `import { shared } from './shared';
export default { parameters: { test: { restoreMocks: false } } };
export const A = { args: { g: fn().mockReturnValue(1) } };
A.parameters = shared;`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('leaves a re-exported import out of the stories', () => {
    const verdicts = verdictsOf(
      `import { Other } from './other.stories';
export default { parameters: { test: { restoreMocks: false } } };
export const A = { args: { g: fn().mockReturnValue(1) } };
export { Other };`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('reads a meta exported through an export specifier', () => {
    const verdicts = verdictsOf(
      `const meta = { parameters: { test: { restoreMocks: false } } };
export { meta as default };
export const A = { args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('leaves __namedExportsOrder out of the stories', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { args: { g: fn().mockReturnValue(1) } };
export const __namedExportsOrder = ['A'];`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('reads a value of a CSF factory file exported by specifier as a story, unknown when made by a call', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
import { make } from './make';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ args: { g: fn().mockReturnValue(1) } });
const helper = make();
export { helper };`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('leaves a non-factory export of a CSF factory file out of the stories', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ args: { g: fn().mockReturnValue(1) } });
export const helper = () => null;`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('reads the parameters assigned to the input of a factory story', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ args: { g: fn().mockReturnValue(1) } });
A.input.parameters = { test: { mockReset: true } };`,
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('reads a story made by .extend() on a local story as unknown', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
const Base = meta.story({ parameters: { test: { mockReset: true } } });
export const B = Base.extend({ args: { g: fn().mockReturnValue(1) } });`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a story made by .extend() on an exported story as unknown', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({});
export const A = meta.story({ parameters: { test: { restoreMocks: false } } });
export const B = A.extend({ args: { g: fn().mockReturnValue(1) } });`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('leaves out an object assigned to the input of a factory story', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({});
export const A = meta.story({ args: { g: fn().mockReturnValue(1) } });
A.input = { parameters: { test: { restoreMocks: false } } };`,
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('leaves out the parameters assigned to a factory story itself', () => {
    const verdicts = verdictsOf(
      `import preview from '../.storybook/preview';
const meta = preview.meta({ parameters: { test: { restoreMocks: false } } });
export const A = meta.story({ args: { g: fn().mockReturnValue(1) } });
A.parameters = { test: { mockReset: true } };`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('keeps the stories of a file with a meta() call that is no CSF factory', () => {
    const verdicts = verdictsOf(
      `import { z } from 'zod';
const schema = z.string().meta({ id: 'label' });
export default { parameters: { test: { restoreMocks: false } } };
export const A = {
  parameters: { test: { mockReset: true } },
  args: { g: fn().mockReturnValue(1) },
};`,
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('keeps the stories of a file with a meta() call on a local schema', () => {
    const verdicts = verdictsOf(
      `import { z } from 'zod';
export default { parameters: { test: { mockReset: true } } };
export const A = { args: { g: fn().mockReturnValue(1) } };
const schema = z.object({});
const described = schema.meta({ title: 'S' });`,
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('keeps the stories of a file that exports a schema made by .extend()', () => {
    const verdicts = verdictsOf(
      `import { z } from 'zod';
export default {
  excludeStories: /Schema$/,
  parameters: { test: { mockReset: true } },
};
export const A = { args: { g: fn().mockReturnValue(1) } };
export const userSchema = z.object({}).extend({ name: z.string() });`,
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('keeps the stories of a file with a meta() call on a value that no name holds', () => {
    const verdicts = verdictsOf(
      `import { Schema } from './schema';
const schema = new Schema().meta({ id: 'label' });
export default { parameters: { test: { mockReset: true } } };
export const A = { args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('leaves a function declaration exported by specifier out of the stories', () => {
    const verdicts = verdictsOf(
      `export default {};
function helper() {
  return null;
}
export { helper };
export const A = {
  parameters: { test: { restoreMocks: false } },
  args: { g: fn().mockReturnValue(1) },
};`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('reads every story as unknown when the file writes a story through a namespace import of itself', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
import * as self from './X.stories';
export const C = {
  parameters: { test: { restoreMocks: false } },
  args: { g: fn().mockReturnValue(1) },
};
self.C.parameters.test.mockReset = true;`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads every story as unknown when the file writes the meta through a namespace import of itself', () => {
    const verdicts = verdictsOf(
      `import * as self from './X.stories';
export default { parameters: { test: { restoreMocks: false } } };
self.default.parameters.test.mockReset = true;
export const C = { args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('keeps the stories of a file that writes through a namespace import of another stories file', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
import * as other from './Other.stories';
export const C = {
  parameters: { test: { restoreMocks: false } },
  args: { g: fn().mockReturnValue(1) },
};
other.C.parameters.test.mockReset = true;`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('keeps the stories of a file that loads another stories file by a dynamic import', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const C = {
  parameters: { test: { restoreMocks: false } },
  args: { g: fn().mockReturnValue(1) },
};
(await import('./Other.stories')).C.parameters.test.mockReset = true;`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('reads every story as unknown when the file writes a story through a dynamic import of itself', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const C = {
  parameters: { test: { restoreMocks: false } },
  args: { g: fn().mockReturnValue(1) },
};
(await import('./X.stories')).C.parameters.test.mockReset = true;`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads every story as unknown when the file writes a story through a require() of itself', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const C = {
  parameters: { test: { restoreMocks: false } },
  args: { g: fn().mockReturnValue(1) },
};
require('./X.stories').C.parameters.test.mockReset = true;`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads every story as unknown when the file writes a story through an optional require() call of itself', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const C = {
  parameters: { test: { restoreMocks: false } },
  args: { g: fn().mockReturnValue(1) },
};
const self = require?.('./X.stories');
self.C.parameters.test.mockReset = true;`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads every story as unknown when the file writes a story through an import = require() of itself', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const C = {
  parameters: { test: { restoreMocks: false } },
  args: { g: fn().mockReturnValue(1) },
};
import self = require('./X.stories');
self.C.parameters.test.mockReset = true;`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads every story as unknown when the file writes a story through a new require() of itself', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const C = {
  parameters: { test: { restoreMocks: false } },
  args: { g: fn().mockReturnValue(1) },
};
const self = new require('./X.stories');
self.C.parameters.test.mockReset = true;`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads every story as unknown when the file re-exports from itself', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const C = {
  parameters: { test: { restoreMocks: false } },
  args: { g: fn().mockReturnValue(1) },
};
export * as self from './X.stories';`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads every story as unknown when the file imports itself by a specifier with its extension', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
import * as self from './X.stories.ts';
export const C = {
  parameters: { test: { restoreMocks: false } },
  args: { g: fn().mockReturnValue(1) },
};
self.C.parameters.test.mockReset = true;`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads every story as unknown when the file imports itself by its JavaScript name, as Vite maps .js to .ts', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
import * as self from './X.stories.js';
export const C = {
  parameters: { test: { restoreMocks: false } },
  args: { g: fn().mockReturnValue(1) },
};
self.C.parameters.test.mockReset = true;`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads every story as unknown when the file imports itself by its .mjs name, as Vite maps .mjs to .ts', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
import * as self from './X.stories.mjs';
export const C = {
  parameters: { test: { restoreMocks: false } },
  args: { g: fn().mockReturnValue(1) },
};
self.C.parameters.test.mockReset = true;`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('keeps the stories of a file that imports a file whose name holds .js before the stories suffix', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
import * as other from './X.js.stories';
export const C = {
  parameters: { test: { restoreMocks: false } },
  args: { g: fn().mockReturnValue(1) },
};
other.C.parameters.test.mockReset = true;`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('reads every story as unknown when the file has a dynamic import whose argument is not a string literal', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const C = {
  parameters: { test: { restoreMocks: false } },
  args: { g: fn().mockReturnValue(1) },
};
const name = 'X';
(await import(\`./\${name}.stories\`)).C.parameters.test.mockReset = true;`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads every story as unknown when the file has a require() whose argument is not a string literal', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const C = {
  parameters: { test: { restoreMocks: false } },
  args: { g: fn().mockReturnValue(1) },
};
const name = 'X';
require(\`./\${name}.stories\`).C.parameters.test.mockReset = true;`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('keeps the stories of a file whose comment spells its own name', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
/*./X.stories*/
export const C = {
  parameters: { test: { restoreMocks: false } },
  args: { g: fn().mockReturnValue(1) },
};`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('keeps the stories of a file that imports a package spelled like the file name', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
import * as other from 'X.stories';
export const C = {
  parameters: { test: { restoreMocks: false } },
  args: { g: fn().mockReturnValue(1) },
};
other.C.parameters.test.mockReset = true;`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });
});
