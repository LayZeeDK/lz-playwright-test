/// <reference types='vitest' />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nxReadySignal } from '@nx/vite/plugins/nx-ready-signal.plugin';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/demo-app',
  server: {
    port: 4200,
    host: 'localhost',
  },
  preview: {
    port: 4300,
    host: 'localhost',
  },
  plugins: [react(), nxReadySignal()],
  // Baseline only (stryker.e2e.command.config.ts): bakes the command runner's active mutant into the page.
  ...(process.env['STRYKER_BASELINE'] === 'define' &&
  process.env['__STRYKER_ACTIVE_MUTANT__']
    ? {
        define: {
          'globalThis.__stryker__.activeMutant': JSON.stringify(
            process.env['__STRYKER_ACTIVE_MUTANT__'],
          ),
        },
      }
    : {}),
  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [],
  // },
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
}));
