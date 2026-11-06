import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

const webServerMutate = process.env['LZ_CORPUS_WEBSERVER_MUTATE'] ?? 'true';

if (webServerMutate !== 'true' && webServerMutate !== 'auto') {
  throw new Error(
    `LZ_CORPUS_WEBSERVER_MUTATE must be true or auto, got ${JSON.stringify(webServerMutate)}.`,
  );
}

// The WebGL case: sigma's node shapes, edge extremities and edge paths, mostly GLSL held in TS strings, which
// only the regression suite's screenshots of the WebGL canvas can catch.
export default {
  plugins: ['@layzee/stryker-playwright-runner'],
  testRunner: 'lz-playwright',
  lzPlaywright: {
    configFile: 'packages/browser-tests/playwright.stryker.config.ts',
    survivorTraces: 'reports/lz-playwright-traces',
    traceScreenshots: true,
    webServer: { mutate: webServerMutate === 'auto' ? 'auto' : true },
  },
  // npm workspaces link `sigma` to packages/sigma, and preconstruct points it at src, so a sandbox would serve
  // unmutated code.
  inPlace: true,
  // The files the regression scenarios draw: no scenario uses rectangle nodes or bar, circle, diamond or square
  // edge extremities.
  mutate: [
    'packages/sigma/src/rendering/nodes/shapes/{circle,diamond,square,triangle,instance-registry}.ts',
    'packages/sigma/src/rendering/edges/extremities/arrow.ts',
    'packages/sigma/src/rendering/edges/paths/{line,curved,loop}.ts',
  ],
  coverageAnalysis: 'perTest',
  timeoutMS: 20_000,
  dryRunTimeoutMinutes: 20,
  concurrency: 4,
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  reporters: ['clear-text', 'progress', 'json', 'html', 'lz-playwright-traces'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  htmlReporter: { fileName: 'reports/mutation/mutation.html' },
  ignorePatterns: ['/reports'],
  tempDirName: '.stryker-tmp',
} satisfies PartialStrykerOptions;
