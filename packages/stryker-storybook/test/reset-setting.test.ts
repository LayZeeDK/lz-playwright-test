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
  type StoryFile,
  type StoryReset,
  type StubVerdict,
} from '../src/reset-setting.ts';
import { definitionTimeStubs } from '../src/stub-shape.ts';
import { storyFile, verdictsOf } from './support/reset-setting.ts';
import { untaggedPreviewTestTags } from './support/test-tags.ts';

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
  return classifyStubs(
    fixtureFile(file),
    previewTest(preview),
    untaggedPreviewTestTags,
  ).stories;
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
        untaggedPreviewTestTags,
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

  it('gives a meta stub that a story after the first one erases the verdict order-dependent', () => {
    const verdicts = verdictsOf(
      `export default { parameters: { test: { restoreMocks: false } }, args: { g: fn().mockReturnValue(1) } };
export const A = {};
export const B = { parameters: { test: { mockReset: true } } };`,
    );

    assert.deepEqual(verdicts, ['order-dependent']);
  });

  it("does not count a stub that starts where a story's function declaration ends as that story's", () => {
    const verdicts = verdictsOf(
      `export default {};
export const B = { parameters: { test: { mockReset: false, restoreMocks: false } } };
export function A() {}fn().mockReturnValue(1);`,
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

  const unreadablePreview: ResetSettings = {
    mockReset: 'unreadable',
    clearMocks: 'unreadable',
    restoreMocks: 'unreadable',
  };
  const previewRows: readonly (readonly [string, string, ResetSettings])[] = [
    [
      'reads a preview whose parameters spread an import as unreadable',
      `import { shared } from './shared';\nexport default { parameters: { ...shared } };\n`,
      unreadablePreview,
    ],
    [
      'reads the parameters export of a preview that exports another value first',
      `export const decorators = [];\nexport const parameters = { test: { restoreMocks: false } };\n`,
      { restoreMocks: false },
    ],
    [
      'reads the parameters a preview exports by an export specifier',
      `const parameters = { test: { restoreMocks: false } };\nexport { parameters };\n`,
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
    [
      'reads no settings from a preview that exports its parameters by an export type statement, which has no value at run time',
      `const parameters = { test: { restoreMocks: false } };\nexport type { parameters };\n`,
      {},
    ],
    [
      'reads no settings from a preview that exports its parameters by a type export specifier',
      `const parameters = { test: { restoreMocks: false } };\nexport { type parameters };\n`,
      {},
    ],
    [
      'reads no settings from a preview that declares its parameters export without a value',
      `export declare const parameters: { test: { restoreMocks: false } };\n`,
      {},
    ],
  ];

  previewRows.forEach(([title, source, expected]) => {
    it(title, () => {
      const settings = readPreviewTest(parseProgram(source, 'preview.ts'));

      assert.deepEqual(settings, expected);
    });
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
