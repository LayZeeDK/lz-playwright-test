import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { isRecord } from '../src/is-record.ts';
import { parseProgram } from '../src/parse.ts';
import {
  classifyStubs,
  readPreviewTest,
  type StoryReset,
} from '../src/reset-setting.ts';

type Prediction = 'passed' | 'failed' | 'unknown' | 'either';

const previews = {
  default: '{}',
  clear: '{ parameters: { test: { clearMocks: true } } }',
  off: '{ parameters: { test: { restoreMocks: false } } }',
  reset: '{ parameters: { test: { mockReset: true } } }',
};
const seeds = ['none', '1', '2', '3'];
const unreadableFiles: readonly string[] = ['F11Imported'];
const outcomes: unknown = JSON.parse(
  readFileSync(fixture('outcomes.json'), 'utf8'),
);

function fixture(name: string): URL {
  return new URL(`fixtures/reset-cases/${name}`, import.meta.url);
}

function previewTest(preview: keyof typeof previews): unknown {
  return readPreviewTest(
    parseProgram(
      `import type { Preview } from '@storybook/react-vite';\n\nconst preview: Preview = ${previews[preview]};\n\nexport default preview;\n`,
      'preview.ts',
    ),
  );
}

function recorded(...keys: readonly string[]): unknown {
  return keys.reduce<unknown>(
    (value, key) => (isRecord(value) ? value[key] : undefined),
    outcomes,
  );
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

describe('classifyStubs', () => {
  const rows: readonly (readonly [string, keyof typeof previews])[] = [
    ['F01AllDefault', 'default'],
    ['F02MetaOff', 'default'],
    ['F01AllDefault', 'off'],
  ];

  rows.forEach(([file, preview]) => {
    it(`predicts the recorded story outcomes of ${file} under the ${preview} preview`, () => {
      const { stories } = classifyStubs(
        parseProgram(
          readFileSync(fixture(`${file}.stories.tsx.txt`), 'utf8'),
          `${file}.stories.tsx`,
        ),
        previewTest(preview),
      );
      const predicted = seeds.flatMap((seed) =>
        stories.map((story, index) => [
          seed,
          story.name,
          predict(stories, index, seed),
        ]),
      );
      const expected = predicted.map(([seed = '', name = '', prediction]) => [
        seed,
        name,
        prediction === 'either'
          ? prediction
          : unreadableFiles.includes(file)
            ? 'unknown'
            : recorded(file, preview, seed, name),
      ]);

      const definitionOrder = recorded(file, preview, 'none');

      assert.deepEqual(
        stories.map((story) => story.name),
        isRecord(definitionOrder) ? Object.keys(definitionOrder) : [],
      );
      assert.deepEqual(predicted, expected);
    });
  });
});
