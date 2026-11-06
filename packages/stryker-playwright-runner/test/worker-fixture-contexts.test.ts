import assert from 'node:assert/strict';
import { test } from 'node:test';

import { headersOfRun, playwrightTest } from './support/header-run.ts';

test("a worker fixture's request context sends each test's own id, and none after the last test", async (t) => {
  const requests = await headersOfRun(t, (baseUrl) => [
    `import { test as base } from ${JSON.stringify(playwrightTest)};`,
    'const test = base.extend({',
    '  api: [',
    '    async ({ playwright }, use) => {',
    `      const api = await playwright.request.newContext({ baseURL: ${JSON.stringify(baseUrl)} });`,
    '      await use(api);',
    "      await api.get('/teardown');",
    '      await api.dispose();',
    '    },',
    "    { scope: 'worker' },",
    '  ],',
    '});',
    "test('first', async ({ api }, info) => { await api.get(`/${info.testId}`); });",
    "test('second', async ({ api }, info) => { await api.get(`/${info.testId}`); });",
  ]);

  assert.equal(requests.length, 3);
  requests.slice(0, 2).forEach(([url, header]) => {
    assert.equal(header, url.slice(1));
  });
  assert.deepEqual(requests[2], ['/teardown', undefined]);
});
