import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lzStorybookOptions } from '../src/options.ts';

describe('lzStorybookOptions', () => {
  it('uses .storybook as the config folder when lzStorybook is not set', () => {
    assert.deepEqual(lzStorybookOptions({}), { configDir: '.storybook' });
  });

  it('takes the config folder from lzStorybook.configDir', () => {
    assert.deepEqual(
      lzStorybookOptions({ lzStorybook: { configDir: 'apps/ui/.storybook' } }),
      { configDir: 'apps/ui/.storybook' },
    );
  });

  it('rejects a config folder that is not a string, naming the option', () => {
    assert.throws(
      () => lzStorybookOptions({ lzStorybook: { configDir: 42 } }),
      {
        message:
          '@layzee/stryker-storybook: lzStorybook.configDir must be a string, not 42',
      },
    );
  });
});
