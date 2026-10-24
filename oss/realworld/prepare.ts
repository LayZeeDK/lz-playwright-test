// Points a disposable copy of stefanoslig/angular-ngrx-nx-realworld-example-app at the local API double
// and adds a Stryker config for the Playwright runner. Idempotent.
// Usage: node oss/realworld/prepare.ts <copy dir>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const copy = path.resolve(process.argv[2] ?? '');
const heroku = 'https://real-world-app-39656dff2ddc.herokuapp.com/api';
const api = 'http://localhost:3100/api';
const server = fileURLToPath(new URL('../realworld-api/server.ts', import.meta.url)).replaceAll('\\', '/');
const stateFile = path.join(copy, '.stryker-api-state.json').replaceAll('\\', '/');

function edit(file: string, change: (source: string) => string) {
  const target = path.join(copy, file);
  const before = readFileSync(target, 'utf8');
  const after = change(before);

  if (after === before && !before.includes(api) && !before.includes(server)) {
    throw new Error(`${file}: nothing to change; did the upstream file move?`);
  }

  writeFileSync(target, after);
}

for (const file of [
  'apps/conduit/src/environments/environment.ts',
  'apps/conduit/src/environments/environment.prod.ts',
  'apps/conduit-e2e/src/helpers/register-user.ts',
  'apps/conduit-e2e/src/helpers/login-user.ts',
]) {
  edit(file, (source) => source.replaceAll(heroku, api));
}

edit('apps/conduit-e2e/playwright.config.ts', (source) =>
  source.includes(server)
    ? source
    : source.replace(
        /webServer: \{([\s\S]*?)\n {2}\},/,
        `webServer: [
    {
      command: 'node ${server}',
      url: '${api}/tags',
      reuseExistingServer: false,
      env: { PORT: '3100', STATE_FILE: '${stateFile}' },
    },
    {$1
    },
  ],`,
      ),
);

writeFileSync(
  path.join(copy, 'stryker.playwright.config.ts'),
  `import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

export default {
  plugins: ['@spr/stryker-playwright-runner'],
  testRunner: 'playwright',
  playwright: { configFile: 'apps/conduit-e2e/playwright.config.ts' },
  coverageAnalysis: 'perTest',
  timeoutMS: 10_000,
  concurrency: 1,
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  tempDirName: '.stryker-tmp',
} satisfies PartialStrykerOptions;
`,
);

console.log(`prepared ${copy}`);
