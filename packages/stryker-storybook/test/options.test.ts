import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lzStorybookOptions, vitestConfigFile } from '../src/options.ts';

describe('vitestConfigFile', () => {
  it("takes the config file from Stryker's vitest.configFile", () => {
    assert.equal(
      vitestConfigFile({
        vitest: { configFile: 'vitest.storybook.config.ts' },
      }),
      'vitest.storybook.config.ts',
    );
  });

  it('leaves the config file to Vitest without vitest.configFile', () => {
    assert.equal(vitestConfigFile({ vitest: {} }), undefined);
  });
});

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
