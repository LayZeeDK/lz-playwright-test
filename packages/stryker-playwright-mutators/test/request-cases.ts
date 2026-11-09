import type { Case } from './cases.ts';

const data = 'LzPlaywrightRequestData';
const url = 'LzPlaywrightRequestUrl';
const input = 'LzPlaywrightInputAction';

function inTest(statement: string): string {
  return `test('case', async ({ request }) => {\n  ${statement}\n});`;
}

function readResult(call: string): string {
  return inTest(
    `const response = await ${call};\n\n  expect(response.ok()).toBe(true);`,
  );
}

// [method, mutants]: `head` sends no body; the URL of a read GET is a RequestUrl site.
const dataMethods: readonly (readonly [string, Case['expect']])[] = [
  [
    'get',
    [
      [data, '"nx"'],
      [url, '""'],
    ],
  ],
  ['put', [[data, '"nx"']]],
  ['patch', [[data, '"nx"']]],
  ['delete', [[data, '"nx"']]],
  [
    'fetch',
    [
      [data, '"nx"'],
      [url, '""'],
    ],
  ],
  ['head', [[url, '""']]],
];

// [id, options]: options that may name a method.
const fetchOptions: readonly (readonly [string, string])[] = [
  ['quoted-method', "{ 'method': 'POST' }"],
  ['spread', '{ ...options }'],
  ['variable', 'options'],
];

export const requestCases: readonly Case[] = [
  ...['form', 'params'].map(
    (key): Case => ({
      id: `data-key-${key}`,
      title: `a string in the ${key} of a request call gets the suffix x`,
      source: readResult(`request.post('/a', { ${key}: { name: 'n' } })`),
      expect: [[data, '"nx"']],
    }),
  ),
  ...dataMethods.map(
    ([method, expected]): Case => ({
      id: `data-method-${method}`,
      title: `a string in the data of request.${method} ${expected.length > 0 ? 'gets the suffix x' : 'makes no mutant'}`,
      source: readResult(`request.${method}('/a', { data: { name: 'n' } })`),
      expect: expected,
    }),
  ),
  {
    id: 'data-string',
    title: 'a string in the data of a request call gets the suffix x',
    source: readResult("request.post('/a', { data: { name: 'n' } })"),
    expect: [[data, '"nx"']],
  },
  {
    id: 'data-headers',
    title: 'a string in the headers of a request call makes no mutant',
    source: readResult("request.post('/a', { headers: { name: 'n' } })"),
    expect: [],
  },
  {
    id: 'data-other-receiver',
    title:
      'a string in the data of a call on a receiver that is no request makes no mutant',
    source: readResult("other.post('/a', { data: { name: 'n' } })"),
    expect: [],
  },
  {
    id: 'data-page-request',
    title: 'a string in the data of a call on page.request gets the suffix x',
    source: readResult("page.request.post('/a', { data: { name: 'n' } })"),
    expect: [[data, '"nx"']],
  },
  {
    id: 'data-optional-page-request',
    title: 'a string in the data of a call on page?.request gets the suffix x',
    source: readResult("page?.request.post('/a', { data: { name: 'n' } })"),
    expect: [[data, '"nx"']],
  },
  {
    id: 'data-first-argument',
    title:
      'a string in the data of the first argument of a request call makes no mutant',
    source: readResult("request.post({ data: { name: 'n' } })"),
    expect: [],
  },
  {
    id: 'data-quoted-key',
    title:
      'a quoted key in the data of a request call makes no mutant of its own',
    source: readResult("request.post('/a', { data: { 'a-b': 'n' } })"),
    expect: [[data, '"nx"']],
  },
  {
    id: 'data-number',
    title: 'a number in the data of a request call gets 1 added',
    source: readResult("request.post('/a', { data: { page: 1 } })"),
    expect: [[data, '2']],
  },
  {
    id: 'data-boolean',
    title: 'a boolean in the data of a request call flips',
    source: readResult("request.put('/a', { data: { done: false } })"),
    expect: [[data, 'true']],
  },
  {
    id: 'data-quoted-payload-key',
    title:
      'a string under a quoted data key of a request call gets the suffix x',
    source: readResult("request.post('/a', { 'data': { name: 'n' } })"),
    expect: [[data, '"nx"']],
  },
  {
    id: 'data-computed-payload-key',
    title:
      'a string under a computed key named data makes no mutant: a computed key is no payload key',
    source: readResult("request.post('/a', { [data]: { name: 'n' } })"),
    expect: [],
  },
  {
    id: 'data-wrapped-as',
    title:
      "a string in a data object under as makes no mutant: Stryker's instrumenter skips everything inside a type assertion",
    source: readResult(
      "request.post('/a', { data: { name: 'n' } as Payload })",
    ),
    expect: [],
  },
  ...(
    [
      ['satisfies', "{ name: 'n' } satisfies Payload"],
      ['non-null', "{ name: 'n' }!"],
    ] as const
  ).map(
    ([id, payload]): Case => ({
      id: `data-wrapped-${id}`,
      title: `a string in a data object under ${id} gets the suffix x`,
      source: readResult(`request.post('/a', { data: ${payload} })`),
      expect: [[data, '"nx"']],
    }),
  ),
  {
    id: 'data-wrapped-options',
    title:
      'a string in the data of request options under satisfies gets the suffix x',
    source: readResult(
      "request.post('/a', { data: { name: 'n' } } satisfies Options)",
    ),
    expect: [[data, '"nx"']],
  },
  {
    id: 'data-nested-object',
    title:
      'a string in an object inside the data of a request call gets the suffix x',
    source: readResult("request.post('/a', { data: { user: { name: 'n' } } })"),
    expect: [[data, '"nx"']],
  },
  {
    id: 'data-array-element',
    title:
      'a string in an array inside the data of a request call gets the suffix x',
    source: readResult("request.post('/a', { data: { tags: ['t'] } })"),
    expect: [[data, '"tx"']],
  },
  {
    id: 'data-object-in-array',
    title:
      'a string in an object in an array inside the data of a request call gets the suffix x',
    source: readResult(
      "request.post('/a', { data: { items: [{ name: 'n' }] } })",
    ),
    expect: [[data, '"nx"']],
  },
  {
    id: 'data-identifier',
    title: 'identifiers in the data of a request call make no mutant',
    source: readResult("request.post('/a', { data: { name, id: other } })"),
    expect: [],
  },
  {
    id: 'data-raw-body',
    title: 'a raw string body in the data of a request call makes no mutant',
    source: readResult("request.post('/a', { data: 'raw' })"),
    expect: [],
  },
  {
    id: 'data-array-body',
    title: 'an array as the data of a request call makes no mutant',
    source: readResult("request.post('/a', { data: ['a'] })"),
    expect: [],
  },
  {
    id: 'data-negative-number',
    title: 'a negative number in the data of a request call makes no mutant',
    source: readResult("request.post('/a', { params: { page: -1 } })"),
    expect: [],
  },
  {
    id: 'url-get',
    title: 'the URL of a request.get whose result is read becomes empty',
    source: readResult("request.get('/a')"),
    expect: [[url, '""']],
  },
  ...['head', 'fetch'].map(
    (method): Case => ({
      id: `url-method-${method}`,
      title: `the URL of a request.${method} whose result is read becomes empty`,
      source: readResult(`request.${method}('/a')`),
      expect: [[url, '""']],
    }),
  ),
  // The root rarely takes these methods, so a status check kills the mutant without reading the body.
  ...['post', 'put', 'patch', 'delete'].map(
    (method): Case => ({
      id: `url-method-${method}`,
      title: `the URL of a request.${method} makes no mutant`,
      source: readResult(`request.${method}('/a')`),
      expect: [],
    }),
  ),
  {
    id: 'url-fetch-method',
    title: 'the URL of a request.fetch with a method option makes no mutant',
    source: readResult("request.fetch('/a', { method: 'POST' })"),
    expect: [],
  },
  ...fetchOptions.map(
    ([id, options]): Case => ({
      id: `url-fetch-${id}`,
      title: `the URL of a request.fetch with the options ${options} makes no mutant`,
      source: readResult(`request.fetch('/a', ${options})`),
      expect: [],
    }),
  ),
  ...['get', 'head'].flatMap((method) =>
    fetchOptions.map(
      ([id, options]): Case => ({
        id: `url-${method}-${id}`,
        title: `the URL of a request.${method} with the options ${options} becomes empty: ${method} sets its own method`,
        source: readResult(`request.${method}('/a', ${options})`),
        expect: [[url, '""']],
      }),
    ),
  ),
  {
    id: 'url-discarded',
    title:
      'the URL of a request.get whose result is discarded makes no mutant of its own',
    source: inTest("await request.get('/a');"),
    expect: [[input, ';']],
  },
  {
    id: 'url-unread',
    title:
      'the URL of a request.get whose stored result is never read makes no mutant',
    source: inTest("const unread = await request.get('/a');"),
    expect: [],
  },
  {
    id: 'url-assigned-unread',
    title:
      'the URL of a request.get whose result is assigned and never read makes no mutant',
    source: inTest("let unread;\n  unread = await request.get('/a');"),
    expect: [],
  },
  {
    id: 'url-assigned-read',
    title:
      'the URL of a request.get whose result is assigned and then read becomes empty',
    source: inTest(
      "let response;\n  response = await request.get('/a');\n\n  expect(response.ok()).toBe(true);",
    ),
    expect: [[url, '""']],
  },
  ...(
    [
      [
        'expect',
        "expect((response = await request.get('/a')).ok()).toBe(true);",
      ],
      ['condition', "if ((response = await request.get('/a'))) {\n  }"],
    ] as const
  ).map(
    ([id, statement]): Case => ({
      id: `url-assignment-read-${id}`,
      title: `the URL of a request.get whose assignment is read in an ${id} becomes empty`,
      source: inTest(`let response;\n  ${statement}`),
      expect: [[url, '""']],
    }),
  ),
  {
    id: 'url-void',
    title: 'the URL of a request.get under void makes no mutant',
    source: inTest("void request.get('/a');"),
    expect: [],
  },
  {
    id: 'url-logged',
    title:
      'the URL of a request.get whose result is only logged makes no mutant',
    source: inTest(
      "const logged = await request.get('/a');\n\n  console.log(await logged.text());",
    ),
    expect: [],
  },
  {
    id: 'url-other-receiver',
    title: 'the URL of a get on a receiver that is no request makes no mutant',
    source: readResult("other.get('/a')"),
    expect: [],
  },
  {
    id: 'url-page-request',
    title: 'the URL of a page.request.get whose result is read becomes empty',
    source: readResult("page.request.get('/a')"),
    expect: [[url, '""']],
  },
  {
    id: 'url-optional-page-request',
    title: 'the URL of a page?.request.get whose result is read becomes empty',
    source: readResult("page?.request.get('/a')"),
    expect: [[url, '""']],
  },
  {
    id: 'url-new-context-declared',
    title:
      'the URL of a get on a context declared from request.newContext becomes empty',
    source: inTest(
      "const context = await playwright.request.newContext();\n  const response = await context.get('/a');\n\n  expect(response.ok()).toBe(true);",
    ),
    expect: [[url, '""']],
  },
  {
    id: 'url-new-context-assigned',
    title:
      'the URL of a head on a context assigned later from request.newContext becomes empty',
    source: inTest(
      "let context;\n  context = await request.newContext();\n  const response = await context.head('/a');\n\n  expect(response.ok()).toBe(true);",
    ),
    expect: [[url, '""']],
  },
  {
    id: 'url-bound-other',
    title:
      'the URL of a get on a name bound to something other than request.newContext makes no mutant',
    source: inTest(
      "const other = makeClient();\n  const response = await other.get('/a');\n\n  expect(response.ok()).toBe(true);",
    ),
    expect: [],
  },
  {
    id: 'url-third-party',
    title: 'the URL of a request.get to a third-party host makes no mutant',
    source: readResult("request.get('https://api.github.com/x')"),
    expect: [],
  },
  {
    id: 'url-protocol-relative-third-party',
    title:
      'the protocol-relative URL of a request.get to a third-party host makes no mutant',
    source: readResult("request.get('//cdn.example.com/x')"),
    expect: [],
  },
  {
    id: 'url-backslash-relative-third-party',
    title:
      'a URL that starts with two backslashes names a host, as the URL parser reads it, and a third-party one makes no mutant',
    source: readResult("request.get('\\\\\\\\cdn.example.com/x')"),
    expect: [],
  },
  {
    id: 'url-protocol-relative-local',
    title:
      'the protocol-relative URL of a request.get to localhost becomes empty',
    source: readResult("request.get('//localhost:3000/x')"),
    expect: [[url, '""']],
  },
  ...['localhost:3000/y', '127.0.0.1/y', '0.0.0.0:80', '[::1]:3000/y'].map(
    (host): Case => ({
      id: `url-local-${host}`,
      title: `the absolute URL http://${host} of a page.request.get becomes empty`,
      source: readResult(`page.request.get('http://${host}')`),
      expect: [[url, '""']],
    }),
  ),
  {
    id: 'url-local-lookalike',
    title:
      'the URL of a request.get to a host that only starts with localhost makes no mutant',
    source: readResult("request.get('http://localhost.example.com/y')"),
    expect: [],
  },
  {
    id: 'url-empty',
    title: 'an empty URL of a request.get makes no mutant',
    source: readResult("request.get('')"),
    expect: [],
  },
  {
    id: 'url-template',
    title: 'a template literal URL of a request.get becomes empty',
    source: readResult('request.get(`/b/${id}`)'),
    expect: [[url, '""']],
  },
  {
    id: 'url-template-expression-first',
    title:
      'a template literal URL that starts with an expression of a request.get becomes empty',
    source: readResult('request.get(`${base}/x`)'),
    expect: [[url, '""']],
  },
  {
    id: 'url-template-empty',
    title: 'an empty template literal URL of a request.get makes no mutant',
    source: readResult('request.get(``)'),
    expect: [],
  },
  {
    id: 'url-new-context-delete',
    title:
      'the template URL of a delete on a context from request.newContext makes no mutant',
    source: inTest(
      "const context = await playwright.request.newContext({ baseURL: 'http://localhost:1' });\n  const response = await context.delete(`/b/${id}`);\n\n  expect(response.ok()).toBe(true);",
    ),
    expect: [],
  },
  {
    id: 'url-loop',
    title:
      'each URL in the array of a for...of whose variable is the URL of a read request.get becomes empty',
    source: inTest(
      "for (const path of ['/l1', '/l2']) {\n    const response = await request.get(path);\n\n    expect(response.ok()).toBe(true);\n  }",
    ),
    expect: [
      [url, '""'],
      [url, '""'],
    ],
  },
  {
    id: 'url-loop-discarded',
    title:
      'the array of a for...of whose request.get result is discarded makes no URL mutant',
    source: inTest(
      "for (const path of ['/d1']) {\n    await request.get(path);\n  }",
    ),
    expect: [[input, ';']],
  },
  {
    id: 'url-loop-post',
    title:
      'the array of a for...of whose variable is the URL of a request.post makes no mutant',
    source: inTest(
      "for (const path of ['/p1']) {\n    const response = await request.post(path);\n\n    expect(response.ok()).toBe(true);\n  }",
    ),
    expect: [],
  },
  {
    id: 'url-loop-for-in',
    title: 'the array of a for...in makes no mutant',
    source: inTest(
      "for (const path in ['/i1']) {\n    const response = await request.get(path);\n\n    expect(response.ok()).toBe(true);\n  }",
    ),
    expect: [],
  },
  {
    id: 'url-array-outside-loop',
    title: 'an array that is not the right side of a loop makes no mutant',
    source: inTest(
      "const paths = ['/o1'];\n  const response = await request.get(paths[0]);\n\n  expect(response.ok()).toBe(true);",
    ),
    expect: [],
  },
  {
    id: 'url-discarded-post',
    title: 'the URL of a discarded request.post makes no mutant of its own',
    source: inTest("await request.post('/discarded');"),
    expect: [[input, ';']],
  },
  {
    id: 'url-other-in-expect',
    title:
      'the URL of a get on a local object whose result an expect reads makes no mutant',
    source: inTest(
      "const other = { get: async (u: string) => u };\n\n  expect(await other.get('/not-request')).toBe('/not-request');",
    ),
    expect: [],
  },
  {
    id: 'data-computed-method',
    title:
      'a string in the data of a request method read through a computed member makes no mutant',
    source: readResult("request[post]('/a', { data: { name: 'n' } })"),
    expect: [],
  },
  {
    id: 'url-computed-method',
    title:
      'the URL of a request method read through a computed member makes no mutant',
    source: readResult("request[get]('/a')"),
    expect: [],
  },
  {
    id: 'url-new-context-computed',
    title:
      'the URL of a head on a context from a newContext read through a computed member makes no mutant',
    source: inTest(
      "let context;\n  context = await request[newContext]();\n  const response = await context.head('/a');\n\n  expect(response.ok()).toBe(true);",
    ),
    expect: [],
  },
  {
    id: 'url-new-context-constructed',
    title:
      'the URL of a get on a name bound to a new expression named newContext makes no mutant: a new expression is no call',
    source: inTest(
      "const context = new request.newContext();\n  const response = await context.get('/a');\n\n  expect(response.ok()).toBe(true);",
    ),
    expect: [],
  },
  {
    id: 'url-goto',
    title: 'the URL of page.goto makes no RequestUrl mutant',
    source: inTest("await page.goto('/goto');"),
    expect: [['LzPlaywrightNavigationAction', ';']],
  },
];
