import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  experimental_loadStorybook,
  getStoriesPathsFromConfig,
} from 'storybook/internal/core-server';
import { MainFileMissingError } from 'storybook/internal/server-errors';

describe('storybook/internal exports the loader child uses', () => {
  [
    ['core-server experimental_loadStorybook', experimental_loadStorybook],
    ['core-server getStoriesPathsFromConfig', getStoriesPathsFromConfig],
    ['server-errors MainFileMissingError', MainFileMissingError],
  ].forEach(([name, value]) => {
    it(`exports ${String(name)}`, () => {
      assert.equal(typeof value, 'function');
    });
  });
});
