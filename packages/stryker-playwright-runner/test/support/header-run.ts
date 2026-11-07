import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import { withEnv } from '../../src/process-env.ts';
import { loadPlaywright } from '../../src/playwright-internals.ts';
import { type RunSettings, runSettingsEnv } from '../../src/protocol.ts';
import { LzPlaywrightCollectingReporter } from '../../src/reporter.ts';
import { testIdHeader } from '../../src/server-protocol.ts';
import { tempTree } from './doubles.ts';

const packageJson = fileURLToPath(
  new URL('../../package.json', import.meta.url),
);
const workerHookUrl = new URL('../../src/worker-hook.ts', import.meta.url).href;

export const playwrightTest = import.meta.resolve('@playwright/test');

async function recordingServer(t: TestContext) {
  const requests: [string, string | undefined][] = [];
  const server = createServer((request, response) => {
    const header = request.headers[testIdHeader];
    requests.push([
      request.url ?? '',
      typeof header === 'string' ? header : undefined,
    ]);
    response.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');

  return { requests, port: address.port };
}

export async function headersOfRun(
  t: TestContext,
  spec: (baseUrl: string) => readonly string[],
): Promise<[string, string | undefined][]> {
  const { requests, port } = await recordingServer(t);
  const dir = tempTree(t, 'lz-header-run-', {
    'playwright.config.mjs': "export default { testDir: './tests' };\n",
    'tests/requests.spec.mjs': [...spec(`http://127.0.0.1:${port}`), ''].join(
      '\n',
    ),
  });
  const playwright = await loadPlaywright(packageJson).createTestRunner(
    path.join(dir, 'playwright.config.mjs'),
    {},
  );
  await playwright.loadConfig();
  const reporter = new LzPlaywrightCollectingReporter();
  const settings: RunSettings = {
    outDir: tempTree(t, 'lz-header-run-out-'),
    perTest: true,
    testIdHosts: [`localhost:${port}`],
  };

  const { status } = await withEnv(
    {
      NODE_OPTIONS: `--import "${workerHookUrl}"`,
      [runSettingsEnv]: JSON.stringify(settings),
    },
    () =>
      playwright.runTests(reporter, {
        locations: [],
        workers: 1,
        disableConfigReporters: true,
      }),
  );
  assert.equal(status, 'passed', reporter.outputTail);

  return requests;
}
