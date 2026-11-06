// Forces Stryker's own timeout to fire before Playwright's per-test timeout (floor 2000 ms).
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
  timeoutMS: 1,
  timeoutFactor: 0,
  concurrency: 1,
  reporters: ['clear-text'],
  tempDirName: '.stryker-tmp-forced',
} satisfies PartialStrykerOptions;
