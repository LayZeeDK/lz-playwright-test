import { fileURLToPath } from 'node:url';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          storybookTest({
            configDir: fileURLToPath(
              new URL('../vitest-tags-other/.storybook', import.meta.url),
            ),
            tags: { exclude: ['other'] },
          }),
        ],
        test: { name: 'other' },
      },
      {
        plugins: [
          storybookTest({
            configDir: fileURLToPath(new URL('.storybook', import.meta.url)),
            tags: { exclude: ['flaky'] },
          }),
        ],
        test: { name: 'storybook' },
      },
    ],
  },
});
