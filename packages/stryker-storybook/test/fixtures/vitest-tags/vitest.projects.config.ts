import { fileURLToPath } from 'node:url';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['src/**/*.spec.ts'] } },
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
