// Points a disposable copy of stefanoslig/angular-ngrx-nx-realworld-example-app at the local API double
// and adds a Stryker config for the Playwright runner. Idempotent.
// Usage: node oss/realworld/prepare.ts <copy dir>
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const copy = path.resolve(process.argv[2] ?? '');
const heroku = 'https://real-world-app-39656dff2ddc.herokuapp.com/api';
const api = 'http://localhost:3100/api';
const appPort = 4260;
const server = fileURLToPath(new URL('../realworld-api/server.ts', import.meta.url)).replaceAll('\\', '/');
const serverDir = path.posix.dirname(server);
const stateFile = path.join(copy, '.stryker-api-state.json').replaceAll('\\', '/');

function edit(
  file: string,
  change: (source: string) => string,
  applied = (source: string) => source.includes(api) || source.includes(serverDir),
) {
  const target = path.join(copy, file);
  const before = readFileSync(target, 'utf8');
  const after = change(before);

  if (after === before && !applied(before)) {
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
  source.includes(serverDir)
    ? source
    : source.replace(
        /webServer: \{([\s\S]*?)\n {2}\},/,
        // Paths go in as JSON literals and as cwd, never into the shell command, so a space, quote, or
        // shell character in a path stays inert.
        (_match, upstream: string) => `webServer: [
    {
      command: 'node server.ts',
      cwd: ${JSON.stringify(serverDir)},
      url: ${JSON.stringify(`${api}/tags`)},
      reuseExistingServer: false,
      env: { PORT: '3100', STATE_FILE: ${JSON.stringify(stateFile)} },
    },
    {${upstream}
    },
  ],`,
      ),
);

// Upstream starts a `frontend` project that does not exist and reuses whatever answers on 4200, so the
// app gets a port of its own and is always started by the run.
edit('apps/conduit-e2e/playwright.config.ts', (source) =>
  source
    .replaceAll('http://localhost:4200', `http://localhost:${appPort}`)
    .replace('npx nx run frontend:serve-static', `npx nx run conduit:serve --port=${appPort}`)
    .replace('reuseExistingServer: !process.env.CI,', 'reuseExistingServer: false,\n    timeout: 180_000,'),
);

// Fails without Stryker too: it reads the text of the avatar-only link (docs/filings.md). Stryker
// refuses a dry run with a failing test.
edit(
  'apps/conduit-e2e/src/article-list/article-list.spec.ts',
  (source) => source.replace(`test("View article's author"`, `test.fixme("View article's author"`),
  (source) => source.includes(`test.fixme("View article's author"`),
);

// The user id is made once per worker but registered before every test, so a second test in the same
// worker fails (docs/filings.md). The runner runs one Playwright worker.
edit(
  'apps/conduit-e2e/src/auth/auth.spec.ts',
  (source) => source.replace('test.beforeEach(async () => {', 'test.beforeAll(async () => {'),
  (source) => source.includes('test.beforeAll(async () => {'),
);

// A Stryker run that fails keeps its sandbox, a full copy of the workspace, in .stryker-tmp. Nx would
// then find every project twice and refuse to run, even outside Stryker. Same entry as `stryker init`.
const gitignore = path.join(copy, '.gitignore');

if (!readFileSync(gitignore, 'utf8').includes('.stryker-tmp')) {
  appendFileSync(gitignore, '\n# stryker temp files\n.stryker-tmp\n');
}

// The API double's state file holds its token secret and the users' passwords.
if (!readFileSync(gitignore, 'utf8').includes('.stryker-api-state.json')) {
  appendFileSync(gitignore, '.stryker-api-state.json\n');
}

writeFileSync(
  path.join(copy, 'stryker.playwright.config.ts'),
  `import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

export default {
  plugins: ['@layzeedk/stryker-playwright-runner'],
  testRunner: 'playwright',
  playwright: { configFile: 'apps/conduit-e2e/playwright.config.ts' },
  mutate: ['libs/auth/data-access/src/auth.store.ts'],
  ignorers: ['angular'],
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
