import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

const webServerMutate = process.env['LZ_CORPUS_WEBSERVER_MUTATE'] ?? 'true';

if (webServerMutate !== 'true' && webServerMutate !== 'auto') {
  throw new Error(
    `LZ_CORPUS_WEBSERVER_MUTATE must be true or auto, got ${JSON.stringify(webServerMutate)}.`,
  );
}

// The canvas case: the minimap's background fill and transform, which only a screenshot shows. The minimap
// test checks visibility only, so these mutants survive, and their traces show the drawing.
export default {
  plugins: ['@layzee/stryker-playwright-runner'],
  testRunner: 'lz-playwright',
  lzPlaywright: {
    configFile: 'apps/examples/e2e/playwright.stryker.config.ts',
    survivorTraces: 'reports/lz-playwright-traces',
    traceScreenshots: true,
    webServer: { mutate: webServerMutate === 'auto' ? 'auto' : true },
  },
  inPlace: true,
  mutate: [
    'packages/tldraw/src/lib/ui/components/Minimap/MinimapManager.ts:233-241',
  ],
  coverageAnalysis: 'perTest',
  timeoutMS: 20_000,
  dryRunTimeoutMinutes: 20,
  concurrency: 1,
  reporters: ['clear-text', 'progress', 'json', 'lz-playwright-traces'],
  jsonReporter: { fileName: 'reports/mutation/canvas.json' },
  ignorePatterns: ['/reports'],
  tempDirName: '.stryker-tmp',
} satisfies PartialStrykerOptions;
