import assert from 'node:assert/strict';
import { test } from 'node:test';

import { headersOfRun, playwrightTest } from '../support/header-run.ts';

test("a worker fixture's browser context tags each test's page requests with that test's id, and none after the last test", async (t) => {
  const requests = await headersOfRun(t, (baseUrl) => [
    `import { test as base } from ${JSON.stringify(playwrightTest)};`,
    'const test = base.extend({',
    '  shared: [',
    '    async ({ browser }, use) => {',
    `      const context = await browser.newContext({ baseURL: ${JSON.stringify(baseUrl)} });`,
    '      const page = await context.newPage();',
    '      await use(page);',
    "      await page.goto('/teardown');",
    '      await context.close();',
    '    },',
    "    { scope: 'worker' },",
    '  ],',
    '});',
    "test('first', async ({ shared }, info) => { await shared.goto(`/${info.testId}`); });",
    "test('second', async ({ shared }, info) => { await shared.goto(`/${info.testId}`); });",
  ]);
  const pages = requests.filter(([url]) => url !== '/favicon.ico');

  assert.equal(pages.length, 3, JSON.stringify(requests));
  pages.slice(0, 2).forEach(([url, header]) => {
    assert.equal(header, url.slice(1));
  });
  assert.deepEqual(pages[2], ['/teardown', undefined]);
});
