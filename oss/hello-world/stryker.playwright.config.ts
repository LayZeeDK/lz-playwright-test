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
    webServer: { mutate: webServerMutate === 'auto' ? 'auto' : true },
  },
  mutate: ['src/**/*.js'],
  coverageAnalysis: 'perTest',
  timeoutMS: 11_000,
  concurrency: 1,
  reporters: ['clear-text', 'progress'],
  tempDirName: '.stryker-tmp-pw',
} satisfies PartialStrykerOptions;
