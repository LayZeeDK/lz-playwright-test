import type { Case } from './cases.ts';

const data = 'LzPlaywrightRequestData';

function inTest(statement: string): string {
  return `test('case', async ({ request }) => {\n  ${statement}\n});`;
}

function readResult(call: string): string {
  return inTest(
    `const response = await ${call};\n\n  expect(response.ok()).toBe(true);`,
  );
}

// [method, mutants]: `head` sends no body.
const dataMethods: readonly (readonly [string, Case['expect']])[] = [
  ['get', [[data, '"nx"']]],
  ['put', [[data, '"nx"']]],
  ['patch', [[data, '"nx"']]],
  ['delete', [[data, '"nx"']]],
  ['fetch', [[data, '"nx"']]],
  ['head', []],
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
    source: readResult("request.get('/a', { data: { page: 1 } })"),
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
    source: readResult("request.get('/a', { params: { page: -1 } })"),
    expect: [],
  },
];
