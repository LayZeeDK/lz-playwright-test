import type { Case } from './cases.ts';

const testId = 'LzPlaywrightTestIdLocator';
const role = 'LzPlaywrightRoleLocator';
const text = 'LzPlaywrightTextLocator';
const click = 'LzPlaywrightClickAction';

function inTest(statements: readonly string[]): string {
  return `test('case', async ({ page }) => {\n  ${statements.join('\n  ')}\n});`;
}

function testIds(...args: readonly string[]): string {
  return inTest(args.map((arg) => `page.getByTestId(${arg});`));
}

const textMethods = [
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByAltText',
  'getByTitle',
] as const;

const textCases: readonly Case[] = textMethods.flatMap(
  (method, index): Case[] => {
    const other = textMethods[(index + 1) % textMethods.length];

    return [
      {
        id: `${method}-two-values`,
        title: `two ${method} values each take the other`,
        source: inTest([`page.${method}('a');`, `page.${method}(/b/);`]),
        expect: [
          [text, '/b/'],
          [text, "'a'"],
        ],
      },
      {
        id: `${method}-other-method`,
        title: `a ${other} value is never used for ${method}`,
        source: inTest([`page.${method}('a');`, `page.${other}('b');`]),
        expect: [],
      },
    ];
  },
);

export const locatorCases: readonly Case[] = [
  ...textCases,
  {
    id: 'testid-lone',
    title: 'a lone test id makes no mutant',
    source: testIds("'a'"),
    expect: [],
  },
  {
    id: 'role-lone',
    title: 'a lone role name makes no mutant',
    source: inTest(["page.getByRole('button', { name: 'Save' });"]),
    expect: [],
  },
  {
    id: 'text-lone',
    title: 'a lone text value makes no mutant',
    source: inTest(["page.getByText('a');"]),
    expect: [],
  },
  {
    id: 'testid-assertion-target-and-chain',
    title: 'test ids in an assertion and on a locator chain are sites',
    source: inTest([
      "await expect(page.getByTestId('a')).toBeVisible();",
      "page.locator('#form').getByTestId('b');",
    ]),
    expect: [
      [testId, "'b'"],
      [testId, "'a'"],
    ],
  },
  {
    id: 'text-nearest-same-method',
    title: 'the nearest values of the same method are used, past another',
    source: inTest([
      "page.getByText('a');",
      "page.getByLabel('x');",
      "page.getByText('b');",
      "page.getByText('c');",
    ]),
    expect: [
      [text, "'b'"],
      [text, "'a'"],
      [text, "'c'"],
      [text, "'b'"],
    ],
  },
  {
    id: 'text-options-untouched',
    title: 'exact is left as it is, and a non-literal value is no site',
    source: inTest([
      "page.getByText('a', { exact: true });",
      'page.getByText(label);',
      "page.getByText('b', { exact: false });",
    ]),
    expect: [
      [text, "'b'"],
      [text, "'a'"],
    ],
  },
  {
    id: 'text-assertion-target',
    title: 'an assertion target is a site',
    source: inTest([
      "await expect(page.getByLabel('a')).toBeVisible();",
      "await expect(page.getByLabel('b')).toBeVisible();",
    ]),
    expect: [
      [text, "'b'"],
      [text, "'a'"],
    ],
  },
  {
    id: 'testid-two-ids',
    title: 'two test ids each take the other',
    source: testIds("'a'", "'b'"),
    expect: [
      [testId, "'b'"],
      [testId, "'a'"],
    ],
  },
  {
    id: 'testid-equal-neighbours',
    title: 'a test id with the same neighbour on both sides gets one mutant',
    source: testIds("'a'", "'b'", "'a'"),
    expect: [
      [testId, "'b'"],
      [testId, "'a'"],
      [testId, "'b'"],
    ],
  },
  {
    id: 'testid-equal-skipped',
    title: 'an equal test id is skipped for the next distinct one',
    source: testIds("'a'", "'a'", "'b'"),
    expect: [
      [testId, "'b'"],
      [testId, "'b'"],
      [testId, "'a'"],
    ],
  },
  {
    id: 'testid-string-and-regex',
    title: 'a string and a regex with the same text replace each other',
    source: testIds("'a'", '/a/'),
    expect: [
      [testId, '/a/'],
      [testId, "'a'"],
    ],
  },
  {
    id: 'testid-regex-flags',
    title: 'regexes with other flags replace each other',
    source: testIds('/a/', '/a/i'),
    expect: [
      [testId, '/a/i'],
      [testId, '/a/'],
    ],
  },
  {
    id: 'testid-equal-regex',
    title: 'equal regexes make no mutant',
    source: testIds('/a/i', '/a/i'),
    expect: [],
  },
  {
    id: 'testid-template',
    title: 'an expression-free template and a string replace each other',
    source: testIds('`a`', "'b'"),
    expect: [
      [testId, "'b'"],
      [testId, '`a`'],
    ],
  },
  {
    id: 'testid-template-equals-string',
    title: 'an expression-free template equals the string of its text',
    source: testIds('`a`', "'a'"),
    expect: [],
  },
  {
    id: 'testid-template-expression',
    title: 'a template with an expression is neither site nor replacement',
    source: testIds("'a'", '`a${id}`', "'b'"),
    expect: [
      [testId, "'b'"],
      [testId, "'a'"],
    ],
  },
  {
    id: 'testid-identifier',
    title: 'an identifier is neither site nor replacement',
    source: testIds("'a'", 'id', "'b'"),
    expect: [
      [testId, "'b'"],
      [testId, "'a'"],
    ],
  },
  {
    id: 'role-two-names',
    title: 'two names of the same role each take the other',
    source: inTest([
      "page.getByRole('button', { name: 'Save' });",
      "page.getByRole('button', { name: 'Cancel' });",
    ]),
    expect: [
      [role, "'Cancel'"],
      [role, "'Save'"],
    ],
  },
  {
    id: 'role-regex-names',
    title: 'regex names of the same role replace each other',
    source: inTest([
      "page.getByRole('button', { name: /save/i });",
      "page.getByRole('button', { name: 'Cancel' });",
    ]),
    expect: [
      [role, "'Cancel'"],
      [role, '/save/i'],
    ],
  },
  {
    id: 'role-other-role',
    title: 'a name of another role is never used',
    source: inTest([
      "page.getByRole('button', { name: 'Save' });",
      "page.getByRole('link', { name: 'Home' });",
    ]),
    expect: [],
  },
  {
    id: 'role-nearest-same-role',
    title: 'the nearest names of the same role are used, past another role',
    source: inTest([
      "page.getByRole('button', { name: 'Save' });",
      "page.getByRole('link', { name: 'Home' });",
      "page.getByRole('button', { name: 'Cancel' });",
    ]),
    expect: [
      [role, "'Cancel'"],
      [role, "'Save'"],
    ],
  },
  {
    id: 'role-exact-untouched',
    title: 'exact and other options are left as they are',
    source: inTest([
      "page.getByRole('button', { name: 'Save', exact: true });",
      "page.getByRole('button', { exact: false, name: 'Cancel', includeHidden: true });",
    ]),
    expect: [
      [role, "'Cancel'"],
      [role, "'Save'"],
    ],
  },
  {
    id: 'role-not-sites',
    title: 'no name, a non-literal name or a non-literal role is no site',
    source: inTest([
      "page.getByRole('button');",
      "page.getByRole('button', { exact: true });",
      "page.getByRole('button', { name: label });",
      "page.getByRole(kind, { name: 'Save' });",
      "page.getByRole('button', { name: 'Cancel' });",
    ]),
    expect: [],
  },
  {
    id: 'role-assertion-target',
    title: 'an assertion target is a site',
    source: inTest([
      "await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();",
      "await page.getByRole('button', { name: 'Cancel' }).click();",
    ]),
    expect: [
      [role, "'Cancel'"],
      [role, "'Save'"],
      [click, ';'],
    ],
  },
];
