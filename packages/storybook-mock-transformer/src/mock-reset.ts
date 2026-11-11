import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Plugin } from 'vite';
import type { ViteUserConfig } from 'vitest/config';

export function lzStorybookMockResetPlugin(): Plugin {
  return { name: 'lz-storybook-mock-reset', config: mockResetConfig };
}

export function mockResetConfig(): ViteUserConfig {
  const setupFile = new URL(
    `./mock-reset.setup${extname(import.meta.url)}`,
    import.meta.url,
  );

  return { test: { setupFiles: [fileURLToPath(setupFile)] } };
}
