import type { Case } from './cases.ts';

const fulfill = 'LzPlaywrightFulfill';

function inRoute(statement: string): string {
  return `test('case', async ({ page }) => {\n  await page.route('**/api', async (route) => {\n    ${statement}\n  });\n});`;
}

export const routeMockCases: readonly Case[] = [
  {
    id: 'fulfill-json-object',
    title: 'a json object literal becomes an empty object',
    source: inRoute("await route.fulfill({ json: { name: 'a' } });"),
    expect: [[fulfill, '{}']],
  },
  {
    id: 'fulfill-json-array',
    title: 'a json array literal becomes an empty array',
    source: inRoute("await route.fulfill({ json: [{ name: 'a' }] });"),
    expect: [[fulfill, '[]']],
  },
  {
    id: 'fulfill-json-identifier',
    title: 'a json identifier becomes an empty object',
    source: inRoute('await route.fulfill({ json: payload });'),
    expect: [[fulfill, '{}']],
  },
  {
    id: 'fulfill-body-string',
    title: 'a body string becomes an empty string',
    source: inRoute("await route.fulfill({ body: '<p>hi</p>' });"),
    expect: [[fulfill, '""']],
  },
  {
    id: 'fulfill-body-expression',
    title: 'a body expression becomes an empty string',
    source: inRoute('await route.fulfill({ body: JSON.stringify(payload) });'),
    expect: [[fulfill, '""']],
  },
  {
    id: 'fulfill-json-empty-object',
    title: 'a json value that is already an empty object makes no mutant',
    source: inRoute('await route.fulfill({ json: {} });'),
    expect: [],
  },
  {
    id: 'fulfill-json-empty-array',
    title: 'a json value that is already an empty array makes no mutant',
    source: inRoute('await route.fulfill({ json: [] });'),
    expect: [],
  },
  {
    id: 'fulfill-body-empty-string',
    title: 'a body value that is already an empty string makes no mutant',
    source: inRoute("await route.fulfill({ body: '' });"),
    expect: [],
  },
  {
    id: 'fulfill-response-json',
    title: 'a fulfill with a response makes no mutant on its json',
    source: inRoute(
      'const response = await route.fetch();\n    await route.fulfill({ response, json: { name: "a" } });',
    ),
    expect: [],
  },
  {
    id: 'fulfill-response-body',
    title: 'a fulfill with a response makes no mutant on its body',
    source: inRoute(
      'const response = await route.fetch();\n    await route.fulfill({ response, body: "x" });',
    ),
    expect: [],
  },
  {
    id: 'fulfill-status-200',
    title: 'a status of 200 becomes 500',
    source: inRoute('await route.fulfill({ status: 200 });'),
    expect: [[fulfill, '500']],
  },
  {
    id: 'fulfill-status-302',
    title: 'a status of 302 becomes 500',
    source: inRoute('await route.fulfill({ status: 302 });'),
    expect: [[fulfill, '500']],
  },
  {
    id: 'fulfill-status-404',
    title: 'a status of 404 becomes 200',
    source: inRoute('await route.fulfill({ status: 404 });'),
    expect: [[fulfill, '200']],
  },
  {
    id: 'fulfill-status-503',
    title: 'a status of 503 becomes 200',
    source: inRoute('await route.fulfill({ status: 503 });'),
    expect: [[fulfill, '200']],
  },
  {
    id: 'fulfill-status-100',
    title: 'a status below 200 makes no mutant',
    source: inRoute('await route.fulfill({ status: 100 });'),
    expect: [],
  },
  {
    id: 'fulfill-status-600',
    title: 'a status above 599 makes no mutant',
    source: inRoute('await route.fulfill({ status: 600 });'),
    expect: [],
  },
  {
    id: 'fulfill-status-identifier',
    title: 'a status that is not a literal makes no mutant',
    source: inRoute('await route.fulfill({ status });'),
    expect: [],
  },
  {
    id: 'fulfill-response-status',
    title: 'a fulfill with a response makes no mutant on its status',
    source: inRoute(
      'const response = await route.fetch();\n    await route.fulfill({ response, status: 404 });',
    ),
    expect: [],
  },
  {
    id: 'fulfill-non-object',
    title: 'a fulfill whose argument is not an object literal makes no mutant',
    source: inRoute('await route.fulfill(options);'),
    expect: [],
  },
  {
    id: 'send-json',
    title: 'a json property in a call that is not fulfill makes no mutant',
    source: inRoute('await route.send({ json: { name: "a" }, status: 200 });'),
    expect: [],
  },
];
