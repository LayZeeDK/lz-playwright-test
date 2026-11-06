import { lzJsxMutators } from '@layzee/stryker-jsx-mutators';
import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

await lzJsxMutators();

const webServerMutate = process.env['LZ_CORPUS_WEBSERVER_MUTATE'] ?? 'true';

if (webServerMutate !== 'true' && webServerMutate !== 'auto') {
  throw new Error(
    `LZ_CORPUS_WEBSERVER_MUTATE must be true or auto, got ${JSON.stringify(webServerMutate)}.`,
  );
}

export default {
  plugins: [
    '@layzee/stryker-playwright-runner',
    '@stryker-mutator/typescript-checker',
  ],
  testRunner: 'lz-playwright',
  lzPlaywright: {
    configFile: 'playwright.config.ts',
    webServer: { mutate: webServerMutate === 'auto' ? 'auto' : true },
  },
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  mutate: [
    'app/routes/users/index.tsx',
    'app/components/search-bar.tsx',
    'app/routes/users/$username/notes/$noteId.tsx',
    'app/routes/users/$username/notes/_layout.tsx',
  ],
  coverageAnalysis: 'perTest',
  timeoutMS: 11_000,
  concurrency: 1,
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  tempDirName: '.stryker-tmp',
} satisfies PartialStrykerOptions;
