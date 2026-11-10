import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { isRecord } from '../src/is-record.ts';
import { field } from '../src/node-field.ts';
import { parseProgram } from '../src/parse.ts';
import {
  classifyStubs,
  readPreviewTest,
  type ResetSettings,
  type StoryReset,
  type StubVerdict,
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
  return classifyStubs(storyProgram(file), previewTest(preview)).stories;
}

function storyProgram(file: string): unknown {
  return parseProgram(
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
      const program = storyProgram(file);

      const { stubs } = classifyStubs(program, previewTest(preview));

      assert.deepEqual(
        stubs,
        definitionTimeStubs(program).map(
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
});

describe('classifyStubs parameter reading', () => {
  function verdictsOf(source: string): readonly StubVerdict[] {
    return classifyStubs(
      parseProgram(
        `import { fn } from 'storybook/test';\n${source}`,
        'X.stories.ts',
      ),
      {},
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

  it('reads a function story with parameters assigned after it as unknown', () => {
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

    assert.deepEqual(verdicts, ['unknown']);
  });

  it('reads an object story with parameters assigned after it as unknown', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { args: { g: fn().mockReturnValue(1) } };
A.parameters = { test: { mockReset: true } };`,
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

  it('leaves __namedExportsOrder out of the stories', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } } };
export const A = { args: { g: fn().mockReturnValue(1) } };
export const __namedExportsOrder = ['A'];`,
    );

    assert.deepEqual(verdicts, ['kept']);
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
