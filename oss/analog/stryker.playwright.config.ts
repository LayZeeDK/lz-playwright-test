import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

const webServerMutate = process.env['LZ_CORPUS_WEBSERVER_MUTATE'] ?? 'true';

if (webServerMutate !== 'true' && webServerMutate !== 'auto') {
  throw new Error(
    `LZ_CORPUS_WEBSERVER_MUTATE must be true or auto, got ${JSON.stringify(webServerMutate)}.`,
  );
}

export default {
  plugins: ['@layzee/stryker-playwright-runner'],
  testRunner: 'lz-playwright',
  lzPlaywright: {
    configFile: 'apps/analog-app-e2e/playwright.config.ts',
    webServer: { mutate: webServerMutate === 'auto' ? 'auto' : true },
  },
  mutate: ['apps/analog-app/src/app/pages/(home).page.ts'],
  ignorers: ['angular'],
  coverageAnalysis: 'perTest',
  timeoutMS: 15_000,
  concurrency: 1,
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  tempDirName: '.stryker-tmp',
} satisfies PartialStrykerOptions;
