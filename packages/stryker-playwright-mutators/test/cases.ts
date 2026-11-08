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
    inTest("await page.locator('#a').waitFor();"),
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
  {
    id: 'before-use',
    title: 'a click before await use in a fixture is removed',
    source:
      "const extended = test.extend<{ ready: boolean }>({\n  ready: async ({ page }, use) => {\n    await page.locator('#a').click();\n    await use(true);\n  },\n});",
    expect: [[click, ';']],
  },
  {
    id: 'sibling-of-afterEach',
    title: 'a click in a test next to test.afterEach is removed',
    source: `test.afterEach(async () => {});\n${inTest("await page.locator('#a').click();")}`,
    expect: [[click, ';']],
  },
];
