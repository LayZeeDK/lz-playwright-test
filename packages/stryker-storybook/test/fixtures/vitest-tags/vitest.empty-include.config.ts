import { fileURLToPath } from 'node:url';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    storybookTest({
      configDir: fileURLToPath(new URL('.storybook', import.meta.url)),
      tags: { include: [] },
    }),
  ],
});
