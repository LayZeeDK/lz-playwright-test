import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { isRecord } from '../src/is-record.ts';
import { field } from '../src/node-field.ts';
import { parseProgram } from '../src/parse.ts';
import {
  classifyStubs,
  defaultTestTags,
  readPreviewTest,
  type ResetSettings,
  type StoryFile,
  type StoryReset,
  type StubVerdict,
  type TestTags,
} from '../src/reset-setting.ts';
import { definitionTimeStubs } from '../src/stub-shape.ts';

type Prediction = 'passed' | 'failed' | 'unknown' | 'either';

function typedPreview(annotations: string): string {
  return `import type { Preview } from '@storybook/react-vite';\n\nconst preview: Preview = ${annotations};\n\nexport default preview;\n`;
}

const previews = {
  default: { recorded: 'default', source: typedPreview('{}') },
  clear: {
    recorded: 'clear',
    source: typedPreview('{ parameters: { test: { clearMocks: true } } }'),
  },
  off: {
    recorded: 'off',
    source: typedPreview('{ parameters: { test: { restoreMocks: false } } }'),
  },
  reset: {
    recorded: 'reset',
    source: typedPreview('{ parameters: { test: { mockReset: true } } }'),
  },
  'definePreview off': {
    recorded: 'off',
    source: `import { definePreview } from '@storybook/react-vite';\n\nexport default definePreview({ parameters: { test: { restoreMocks: false } } });\n`,
  },
  'named parameters off': {
    recorded: 'off',
    source: `export const parameters = { test: { restoreMocks: false } };\n`,
  },
  'named decorators only': {
    recorded: 'default',
    source: `export const decorators = [];\n`,
  },
};
const seeds = ['none', '1', '2', '3'];
const unreadableFiles: readonly string[] = ['F11Imported'];
const outcomes: unknown = JSON.parse(
  readFileSync(fixture('outcomes.json'), 'utf8'),
);

function fixture(name: string): URL {
  return new URL(`fixtures/reset-cases/${name}`, import.meta.url);
}

function previewTest(preview: keyof typeof previews): ResetSettings {
  return readPreviewTest(parseProgram(previews[preview].source, 'preview.ts'));
}

function recorded(...keys: readonly string[]): unknown {
  return field(outcomes, ...keys);
}

function erases(story: StoryReset): boolean {
  return story.branch === 'reset' || story.branch === 'restore';
}

function predict(
  stories: readonly StoryReset[],
  index: number,
  seed: string,
): Prediction {
  if (stories.some((story) => story.branch === 'unknown')) {
    return 'unknown';
  }

  if (seed === 'none') {
    return stories.slice(0, index + 1).some(erases) ? 'failed' : 'passed';
  }

  if (stories[index] !== undefined && erases(stories[index])) {
    return 'failed';
  }

  return stories.some(erases) ? 'either' : 'passed';
}

function storiesOf(
  file: string,
  preview: keyof typeof previews,
): readonly StoryReset[] {
  return classifyStubs(fixtureFile(file), previewTest(preview), defaultTestTags)
    .stories;
}

function storyFile(code: string, fileName: string): StoryFile {
  return { program: parseProgram(code, fileName), code, fileName };
}

function fixtureFile(file: string): StoryFile {
  return storyFile(
    readFileSync(fixture(`${file}.stories.tsx.txt`), 'utf8'),
    `${file}.stories.tsx`,
  );
}

function predictions(
  stories: readonly StoryReset[],
): readonly (readonly [string, string, Prediction])[] {
  return seeds.flatMap((seed) =>
    stories.map(
      (story, index) =>
        [seed, story.name, predict(stories, index, seed)] as const,
    ),
  );
}

describe('classifyStubs stub verdicts', () => {
  const rows: readonly (readonly [
    string,
    keyof typeof previews,
    readonly StubVerdict[],
  ])[] = [
    ['F01AllDefault', 'default', ['erased', 'erased']],
    ['F02MetaOff', 'default', ['kept', 'kept']],
    ['F04OffBeforeDefault', 'default', ['order-dependent', 'erased']],
    ['F11Imported', 'default', ['unknown']],
    ['F09MetaArgsStub', 'reset', ['erased']],
    ['F07MetaOffStoryOn', 'default', ['order-dependent', 'erased', 'erased']],
  ];

  rows.forEach(([file, preview, verdicts]) => {
    it(`gives the stubs of ${file} under the ${preview} preview the verdicts ${verdicts.join(', ')}`, () => {
      const story = fixtureFile(file);

      const { stubs } = classifyStubs(
        story,
        previewTest(preview),
        defaultTestTags,
      );

      assert.deepEqual(
        stubs,
        definitionTimeStubs(story.program).map(
          ({ start, end, line, once }, index) => ({
            start,
            end,
            line,
            once,
            verdict: verdicts[index],
          }),
        ),
      );
    });
  });

  function verdictsOf(source: string): readonly StubVerdict[] {
    return classifyStubs(
      storyFile(
        `import { fn } from 'storybook/test';\n${source}`,
        'X.stories.ts',
      ),
      {},
      defaultTestTags,
    ).stubs.map(({ verdict }) => verdict);
  }

  it('gives a meta stub that a story after the first one erases the verdict order-dependent', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } }, args: { g: fn().mockReturnValue(1) } };
export const A = {};
export const B = { parameters: { test: { mockReset: true } } };`,
    );

    assert.deepEqual(verdicts, ['order-dependent']);
  });

  it('gives a stub the verdict of the story that holds it when stories are exported in another order than they are declared', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
const B = { parameters: { test: { mockReset: true } }, args: { g: fn().mockReturnValue(1) } };
const A = {};
export { A, B };`,
    );

    assert.deepEqual(verdicts, ['erased']);
  });

  it('gives a story that is a stub itself the verdict of that story', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = {};
export const B = { parameters: { test: { mockReset: true } } };
export const C = fn().mockReturnValue(1);`,
    );

    assert.deepEqual(verdicts, ['erased']);
  });
});

describe('classifyStubs parameter reading', () => {
  function verdictsOf(source: string): readonly StubVerdict[] {
    return classifyStubs(
      storyFile(
        `import { fn } from 'storybook/test';\n${source}`,
        'X.stories.ts',
      ),
      {},
      defaultTestTags,
    ).stubs.map(({ verdict }) => verdict);
  }

  it('reads a quoted key by its value', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { 'test': { restoreMocks: false } } };
export const A = { args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('reads parameters with a spread element as unknown', () => {
    const verdicts = verdictsOf(
      `import { shared } from './shared';
export default { parameters: { ...shared } };
export const A = { args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a key set after a spread of an import', () => {
    const verdicts = verdictsOf(
      `import { shared } from './shared';
export default {};
export const A = {
  parameters: { ...shared, test: { restoreMocks: false } },
  args: { g: fn().mockReturnValue(1) },
};`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('reads a key set before a spread of an import as unknown', () => {
    const verdicts = verdictsOf(
      `import { shared } from './shared';
export default {};
export const A = {
  parameters: { test: { restoreMocks: false }, ...shared },
  args: { g: fn().mockReturnValue(1) },
};`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a spread of an object that spreads itself as unknown', () => {
    const verdicts = verdictsOf(
      `export default {};
var a = { ...a };
export const A = { ...a, args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a spread of two objects that spread each other as unknown', () => {
    const verdicts = verdictsOf(
      `export default {};
var a = { ...b };
var b = { ...a };
export const A = { ...a, args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads the settings a story spreads in from a local object', () => {
    const verdicts = verdictsOf(
      `export default {};
const Base = { parameters: { test: { restoreMocks: false } } };
export const A = { ...Base, args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['kept']);
  });

  it('reads parameters with a computed key as unknown', () => {
    const verdicts = verdictsOf(
      `import { key } from './key';
export default { parameters: { [key]: { restoreMocks: false } } };
export const A = { args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a test parameter given as an array as unknown', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { parameters: { test: [] } };
export const B = { args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a test parameter given as a boolean as unknown', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { parameters: { test: true } };
export const B = { args: { g: fn().mockReturnValue(1) } };`,
    );

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads a preview whose parameters spread an import as unreadable', () => {
    const settings = readPreviewTest(
      parseProgram(
        `import { shared } from './shared';\nexport default { parameters: { ...shared } };\n`,
        'preview.ts',
      ),
    );

    assert.deepEqual(settings, {
      mockReset: 'unreadable',
      clearMocks: 'unreadable',
      restoreMocks: 'unreadable',
    });
  });

  const unreadablePreview: ResetSettings = {
    mockReset: 'unreadable',
    clearMocks: 'unreadable',
    restoreMocks: 'unreadable',
  };
  const previewRows: readonly (readonly [string, string, ResetSettings])[] = [
    [
      'reads the parameters export of a preview that exports another value first',
      `export const decorators = [];\nexport const parameters = { test: { restoreMocks: false } };\n`,
      { restoreMocks: false },
    ],
    [
      'reads a preview made by a call other than definePreview() as unreadable',
      `export default withTheme({ parameters: { test: { restoreMocks: false } } });\n`,
      unreadablePreview,
    ],
    [
      'reads a preview made by new definePreview() as unreadable',
      `export default new definePreview({ parameters: { test: { restoreMocks: false } } });\n`,
      unreadablePreview,
    ],
  ];

  previewRows.forEach(([title, source, expected]) => {
    it(title, () => {
      const settings = readPreviewTest(parseProgram(source, 'preview.ts'));

      assert.deepEqual(settings, expected);
    });
  });

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

describe('classifyStubs tag filter', () => {
  function verdictsOf(
    source: string,
    testTags = defaultTestTags,
  ): readonly StubVerdict[] {
    return classifyStubs(
      storyFile(
        `import { fn } from 'storybook/test';\n${source}`,
        'X.stories.ts',
      ),
      {},
      testTags,
    ).stubs.map(({ verdict }) => verdict);
  }

  function testTags(rule: Partial<TestTags>): TestTags {
    return { ...defaultTestTags, ...rule };
  }

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
      defaultTestTags,
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
      defaultTestTags,
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
      defaultTestTags,
    );

    assert.deepEqual(stories, [
      { name: 'C', branch: 'none' },
      { name: 'A', branch: 'none' },
    ]);
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

describe('classifyStubs', () => {
  const recordedPreviews = ['default', 'clear', 'off', 'reset'] as const;
  const recordedRows = Object.keys(isRecord(outcomes) ? outcomes : {}).flatMap(
    (file) => recordedPreviews.map((preview) => [file, preview] as const),
  );
  const rows: readonly (readonly [string, keyof typeof previews])[] = [
    ...recordedRows,
    ['F01AllDefault', 'definePreview off'],
    ['F01AllDefault', 'named parameters off'],
    ['F01AllDefault', 'named decorators only'],
    ['F01AllDefault.factories', 'default'],
    ['F02MetaOff.factories', 'default'],
  ];

  it('checks the 348 recorded outcomes that a definite prediction covers', () => {
    const checked = recordedRows
      .flatMap(([file, preview]) => predictions(storiesOf(file, preview)))
      .filter(
        ([, , prediction]) =>
          prediction === 'passed' || prediction === 'failed',
      );

    assert.equal(checked.length, 348);
  });

  rows.forEach(([file, preview]) => {
    it(`predicts the recorded story outcomes of ${file} under the ${preview} preview`, () => {
      const [recordedFile = file] = file.split('.');
      const stories = storiesOf(file, preview);
      const predicted = predictions(stories);
      const expected = predicted.map(([seed = '', name = '', prediction]) => [
        seed,
        name,
        prediction === 'either'
          ? prediction
          : unreadableFiles.includes(file)
            ? 'unknown'
            : recorded(recordedFile, previews[preview].recorded, seed, name),
      ]);

      const definitionOrder = recorded(
        recordedFile,
        previews[preview].recorded,
        'none',
      );

      assert.deepEqual(
        stories.map((story) => story.name),
        isRecord(definitionOrder) ? Object.keys(definitionOrder) : [],
      );
      assert.deepEqual(predicted, expected);
    });
  });
});
