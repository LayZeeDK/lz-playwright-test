export interface Case {
  readonly id: string;
  readonly title: string;
  /** The body of a spec file, after the Playwright import. */
  readonly source: string;
  /** The mutants the Action mutators make: [mutator name, replacement]. */
  readonly expect: readonly (readonly [string, string])[];
}

const click = 'LzPlaywrightClickAction';
const input = 'LzPlaywrightInputAction';
const focus = 'LzPlaywrightFocusAction';
const navigation = 'LzPlaywrightNavigationAction';

// The APIRequestContext methods that send a request (playwright-core client/fetch.ts at v1.64.1).
const requestMethods = [
  'delete',
  'fetch',
  'get',
  'head',
  'patch',
  'post',
  'put',
] as const;

function inTest(statement: string): string {
  return `test('case', async ({ page }) => {\n  ${statement}\n});`;
}

function removed(
  mutator: string,
  title: string,
  statement: string,
  id: string,
): Case {
  return {
    id,
    title: `${title} is removed`,
    source: inTest(statement),
    expect: [[mutator, ';']],
  };
}

function untouched(title: string, source: string, id: string): Case {
  return { id, title: `${title} makes no mutant`, source, expect: [] };
}

// [method, mutator, arguments] of a call on a Locator chain; `onPage` adds the page form `page.<method>(selector, ...)`.
const locatorActions: readonly (readonly [string, string, string, boolean])[] =
  [
    ['click', click, '', true],
    ['dblclick', click, '', true],
    ['tap', click, '', true],
    ['dragTo', click, "page.locator('#to')", false],
    ['dispatchEvent', click, "'click'", true],
    ['fill', input, "'x'", true],
    ['clear', input, '', false],
    ['press', input, "'Enter'", true],
    ['pressSequentially', input, "'x'", false],
    ['type', input, "'x'", true],
    ['selectOption', input, "'a'", true],
    ['selectText', input, '', false],
    ['setInputFiles', input, "'a.txt'", true],
    ['drop', input, "{ files: 'a.txt' }", false],
    ['check', input, '', true],
    ['uncheck', input, '', true],
    ['setChecked', input, 'true', true],
    ['focus', focus, '', true],
    ['blur', focus, '', false],
    ['hover', focus, '', true],
  ];

function args(first: string, rest: string): string {
  return rest === '' ? first : `${first}, ${rest}`;
}

export const cases: readonly Case[] = [
  ...locatorActions.map(([method, mutator, rest]) =>
    removed(
      mutator,
      `an awaited ${method} on a locator chain`,
      `await page.locator('#a').${method}(${rest});`,
      `${method}-locator`,
    ),
  ),
  ...locatorActions
    .filter(([, , , onPage]) => onPage)
    .map(([method, mutator, rest]) =>
      removed(
        mutator,
        `an awaited page.${method}(selector)`,
        `await page.${method}(${args("'#a'", rest)});`,
        `${method}-page`,
      ),
    ),
  removed(
    click,
    'an awaited page.dragAndDrop(source, target)',
    "await page.dragAndDrop('#a', '#b');",
    'dragAndDrop-page',
  ),
  ...(
    [
      ['goto', "'/'"],
      ['reload', ''],
      ['goBack', ''],
      ['goForward', ''],
    ] as const
  ).map(([method, rest]) =>
    removed(
      navigation,
      `an awaited page.${method}`,
      `await page.${method}(${rest});`,
      `${method}-page`,
    ),
  ),
  untouched(
    'an unawaited click',
    inTest("page.locator('#a').click();"),
    'unawaited',
  ),
  untouched(
    'a click whose result is used',
    inTest("const result = await page.locator('#a').click();"),
    'result-used',
  ),
  untouched(
    'an awaited expect chain',
    inTest("await expect(page.locator('#a')).toBeVisible();"),
    'expect-chain',
  ),
  untouched(
    'an awaited call to a method not in the table',
    inTest("await page.locator('#a').highlight();"),
    'not-in-table',
  ),
  untouched(
    'a click in test.afterEach',
    "test.afterEach(async ({ page }) => {\n  await page.locator('#a').click();\n});",
    'afterEach',
  ),
  untouched(
    'a click in test.afterAll, in a nested block',
    "test.afterAll(async ({ page }) => {\n  if (page) {\n    await page.locator('#a').click();\n  }\n});",
    'afterAll',
  ),
  untouched(
    'a click after await use in a fixture',
    "const extended = test.extend<{ ready: boolean }>({\n  ready: async ({ page }, use) => {\n    await use(true);\n    await page.locator('#a').click();\n  },\n});",
    'after-use',
  ),
  untouched(
    'a click after await use, in a nested block',
    "const extended = test.extend<{ ready: boolean }>({\n  ready: async ({ page }, use) => {\n    await use(true);\n    if (page) {\n      await page.locator('#a').click();\n    }\n  },\n});",
    'after-use-nested',
  ),
  untouched(
    'a click after await use in a fixture written as a method',
    "const extended = test.extend<{ ready: boolean }>({\n  async ready({ page }, use) {\n    await use(true);\n    await page.locator('#a').click();\n  },\n});",
    'after-use-method',
  ),
  untouched(
    'page.keyboard.press',
    inTest("await page.keyboard.press('Enter');"),
    'keyboard-press',
  ),
  untouched(
    'page.keyboard.type',
    inTest("await page.keyboard.type('x');"),
    'keyboard-type',
  ),
  untouched(
    'page.mouse.click',
    inTest('await page.mouse.click(1, 2);'),
    'mouse-click',
  ),
  untouched(
    'page.touchscreen.tap',
    inTest('await page.touchscreen.tap(1, 2);'),
    'touchscreen-tap',
  ),
  {
    id: 'before-use',
    title: 'a click before await use in a fixture is removed',
    source:
      "const extended = test.extend<{ ready: boolean }>({\n  ready: async ({ page }, use) => {\n    await page.locator('#a').click();\n    await use(true);\n  },\n});",
    expect: [[click, ';']],
  },
  {
    id: 'navigate-test',
    title: 'an awaited navigate from the fixtures of a test is removed',
    source:
      "test('case', async ({ navigate }) => {\n  await navigate('/');\n});",
    expect: [[navigation, ';']],
  },
  {
    id: 'navigate-step',
    title:
      'an awaited navigate inside test.step, from the fixtures of the test, is removed',
    source:
      "test('case', async ({ navigate }) => {\n  await test.step('open', async () => {\n    await navigate('/');\n  });\n});",
    expect: [[navigation, ';']],
  },
  {
    id: 'navigate-hook',
    title:
      'an awaited navigate from the fixtures of test.beforeEach is removed',
    source:
      "test.beforeEach(async ({ navigate }) => {\n  await navigate('/');\n});",
    expect: [[navigation, ';']],
  },
  {
    id: 'navigate-fixture',
    title: 'an awaited navigate from the fixtures of a fixture is removed',
    source:
      "const extended = test.extend<{ ready: boolean }>({\n  ready: async ({ navigate }, use) => {\n    await navigate('/');\n    await use(true);\n  },\n});",
    expect: [[navigation, ';']],
  },
  {
    id: 'navigate-fixture-method',
    title: 'an awaited navigate in a fixture written as a method is removed',
    source:
      "const extended = test.extend<{ ready: boolean }>({\n  async ready({ navigate }, use) {\n    await navigate('/');\n    await use(true);\n  },\n});",
    expect: [[navigation, ';']],
  },
  untouched(
    'an awaited navigate from an import',
    "import { navigate } from './navigate';\n\ntest('case', async ({ page }) => {\n  await navigate('/');\n});",
    'navigate-imported',
  ),
  untouched(
    'an awaited navigate that is a local const',
    "test('case', async ({ page }) => {\n  const navigate = async (url: string) => page.goto(url);\n\n  await navigate('/');\n});",
    'navigate-local',
  ),
  untouched(
    'an awaited navigate that is no fixture of its test',
    "test('case', async ({ page }) => {\n  await navigate('/');\n});",
    'navigate-unbound',
  ),
  untouched(
    'an awaited navigate in test.afterEach',
    "test.afterEach(async ({ navigate }) => {\n  await navigate('/');\n});",
    'navigate-afterEach',
  ),
  {
    id: 'navigate-among-fixtures',
    title:
      'an awaited navigate destructured after another fixture of the test is removed',
    source:
      "test('case', async ({ page, navigate }) => {\n  await navigate('/');\n});",
    expect: [[navigation, ';']],
  },
  {
    id: 'navigate-optional-test',
    title:
      'an awaited navigate from the fixtures of a test called through an optional chain is removed',
    source:
      "test?.('case', async ({ navigate }) => {\n  await navigate('/');\n});",
    expect: [[navigation, ';']],
  },
  {
    id: 'navigate-optional-chain-extend',
    title:
      'an awaited navigate in a fixture of an extend called through an optional chain is removed',
    source:
      "const extended = test?.extend({\n  ready: async ({ navigate }, use) => {\n    await navigate('/');\n    await use(true);\n  },\n});",
    expect: [[navigation, ';']],
  },
  {
    id: 'navigate-optional-extend',
    title:
      'an awaited navigate in a fixture of (test?.extend)(...) is removed: an optional member counts',
    source:
      "const extended = (test?.extend)({\n  ready: async ({ navigate }, use) => {\n    await navigate('/');\n    await use(true);\n  },\n});",
    expect: [[navigation, ';']],
  },
  untouched(
    'an awaited navigate in a fixture of an extend read through a computed member',
    "const extended = test[extend]<{ ready: boolean }>({\n  ready: async ({ navigate }, use) => {\n    await navigate('/');\n    await use(true);\n  },\n});",
    'navigate-computed-extend',
  ),
  untouched(
    'an awaited navigate in a function of a plain object',
    "const fixtures = {\n  ready: async ({ navigate }) => {\n    await navigate('/');\n  },\n};",
    'navigate-plain-object',
  ),
  untouched(
    'an awaited navigate in a function in an array passed to test.extend',
    "const extended = test.extend([\n  async ({ navigate }) => {\n    await navigate('/');\n  },\n]);",
    'navigate-extend-array',
  ),
  untouched(
    'an awaited navigate in a fixture of new test.extend',
    "const extended = new test.extend({\n  ready: async ({ navigate }, use) => {\n    await navigate('/');\n    await use(true);\n  },\n});",
    'navigate-new-extend',
  ),
  untouched(
    'an awaited navigate in a function passed to a method other than extend',
    "const extended = test.with({\n  ready: async ({ navigate }, use) => {\n    await navigate('/');\n    await use(true);\n  },\n});",
    'navigate-not-extend',
  ),
  untouched(
    'an awaited call to a fixture that is not in the list',
    "test('case', async ({ visit }) => {\n  await visit('/');\n});",
    'visit-default',
  ),
  ...requestMethods.flatMap((method) => [
    {
      id: `${method}-request`,
      title: `an awaited request.${method} is removed`,
      source: `test('case', async ({ request }) => {\n  await request.${method}('/api');\n});`,
      expect: [[input, ';']] as const,
    },
    {
      id: `${method}-page-request`,
      title: `an awaited page.request.${method} is removed`,
      source: `test('case', async ({ page }) => {\n  await page.request.${method}('/api');\n});`,
      expect: [[input, ';']] as const,
    },
  ]),
  untouched(
    'an awaited get on another receiver',
    "test('case', async () => {\n  const map = new Map<string, number>();\n\n  await map.get('a');\n});",
    'get-map',
  ),
  untouched(
    'an awaited post on another request-like receiver',
    "test('case', async ({ client }) => {\n  await client.requests.post('/api');\n});",
    'post-requests',
  ),
  untouched(
    'a request call whose result is used',
    "test('case', async ({ request }) => {\n  const response = await request.get('/api');\n\n  expect(response.ok()).toBe(true);\n});",
    'request-result-used',
  ),
  untouched(
    'a request call in test.beforeEach',
    "test.beforeEach(async ({ request }) => {\n  await request.post('/api');\n});",
    'request-beforeEach',
  ),
  untouched(
    'a request call in test.beforeAll',
    "test.beforeAll(async ({ request }) => {\n  await request.post('/api');\n});",
    'request-beforeAll',
  ),
  untouched(
    'a request call in test.afterEach',
    "test.afterEach(async ({ request }) => {\n  await request.delete('/api');\n});",
    'request-afterEach',
  ),
  untouched(
    'a request call in a finally block',
    "test('case', async ({ request }) => {\n  try {\n    expect(1).toBe(1);\n  } finally {\n    await request.delete('/api');\n  }\n});",
    'request-finally',
  ),
  untouched(
    'a request call after await use in a fixture',
    "const extended = test.extend<{ ready: boolean }>({\n  ready: async ({ request }, use) => {\n    await use(true);\n    await request.delete('/api');\n  },\n});",
    'request-after-use',
  ),
  {
    id: 'request-try',
    title: 'a request call in a try block is removed',
    source:
      "test('case', async ({ request }) => {\n  try {\n    await request.post('/api');\n  } finally {\n    expect(1).toBe(1);\n  }\n});",
    expect: [[input, ';']],
  },
  {
    id: 'click-finally',
    title: 'a click in a finally block is removed',
    source:
      "test('case', async ({ page }) => {\n  try {\n    expect(1).toBe(1);\n  } finally {\n    await page.locator('#a').click();\n  }\n});",
    expect: [[click, ';']],
  },
  {
    id: 'keyboard-computed',
    title:
      'a press on a keyboard read through a computed member is removed: the name of a computed member is unknown',
    source: inTest("await page[keyboard].press('Enter');"),
    expect: [[input, ';']],
  },
  {
    id: 'afterEach-computed',
    title:
      'a click in a hook read through a computed member is removed: it is no known teardown hook',
    source:
      "test[afterEach](async ({ page }) => {\n  await page.locator('#a').click();\n});",
    expect: [[click, ';']],
  },
  untouched(
    'a click in test.afterEach called through an optional chain',
    "test?.afterEach(async ({ page }) => {\n  await page.locator('#a').click();\n});",
    'afterEach-optional',
  ),
  untouched(
    'a click after await use called through an optional chain',
    "const extended = test.extend<{ ready: boolean }>({\n  ready: async ({ page }, use) => {\n    await use?.(true);\n    await page.locator('#a').click();\n  },\n});",
    'after-optional-use',
  ),
  untouched(
    'an awaited post on an imported request',
    "import request from 'superagent';\n\ntest('case', async () => {\n  await request.post('/api');\n});",
    'request-imported',
  ),
  {
    id: 'sibling-of-afterEach',
    title: 'a click in a test next to test.afterEach is removed',
    source: `test.afterEach(async () => {});\n${inTest("await page.locator('#a').click();")}`,
    expect: [[click, ';']],
  },
  {
    id: 'after-other-statement',
    title: 'a click after another statement of the test is removed',
    source: inTest("expect(1).toBe(1);\n  await page.locator('#a').click();"),
    expect: [[click, ';']],
  },
  untouched(
    'an awaited click through a computed member',
    inTest("await page.locator('#a')[click]();"),
    'computed-method',
  ),
  untouched(
    'an awaited click in export =',
    "export = await page.locator('#a').click();",
    'export-assignment',
  ),
  untouched(
    'a request call on a computed member named request',
    "test('case', async ({ api, request }) => {\n  await api[request].get('/api');\n});",
    'request-computed-member',
  ),
  {
    id: 'before-use-not-last',
    title:
      'a click before await use in a fixture is removed when a statement follows the use',
    source:
      "const extended = test.extend<{ ready: boolean }>({\n  ready: async ({ page }, use) => {\n    await page.locator('#a').click();\n    await use(true);\n    expect(1).toBe(1);\n  },\n});",
    expect: [[click, ';']],
  },
  {
    id: 'after-void-use',
    title: 'a click after an unawaited void use in a fixture is removed',
    source:
      "const extended = test.extend<{ ready: boolean }>({\n  ready: async ({ page }, use) => {\n    void use(true);\n    await page.locator('#a').click();\n  },\n});",
    expect: [[click, ';']],
  },
  {
    id: 'after-await-new-use',
    title: 'a click after await new use(...) in a fixture is removed',
    source:
      "const extended = test.extend<{ ready: boolean }>({\n  ready: async ({ page }, use) => {\n    await new use(true);\n    await page.locator('#a').click();\n  },\n});",
    expect: [[click, ';']],
  },
  {
    id: 'new-afterEach',
    title: 'a click in a function passed to new test.afterEach is removed',
    source:
      "new test.afterEach(async ({ page }) => {\n  await page.locator('#a').click();\n});",
    expect: [[click, ';']],
  },
  untouched(
    'a click in a function passed to (test?.afterEach)(...), a teardown hook through an optional member, still',
    "(test?.afterEach)(async ({ page }) => {\n  await page.locator('#a').click();\n});",
    'optional-afterEach',
  ),
];
