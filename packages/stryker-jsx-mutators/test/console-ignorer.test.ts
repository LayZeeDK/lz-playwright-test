import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { consoleIgnorer, lzConsoleSchema } from '../src/console-ignorer.ts';
import { strykerValidationSchema } from '../src/index.ts';
import { assertEveryOutcome } from './support/ignorer-outcomes.ts';
import { validateOptions } from './support/validate-options.ts';

const consoleReason = 'lz-console: console output; DOM tests do not observe it';
const consoleMethods = [
  'assert',
  'clear',
  'count',
  'countReset',
  'debug',
  'dir',
  'dirxml',
  'error',
  'group',
  'groupCollapsed',
  'groupEnd',
  'info',
  'log',
  'table',
  'time',
  'timeEnd',
  'timeLog',
  'trace',
  'warn',
];

const assertEvery = (code: string, outcome: string, options: object = {}) =>
  assertEveryOutcome(consoleIgnorer(options), code, outcome);

describe('lz-console', () => {
  ['log', 'debug', 'info', 'trace'].forEach((method) => {
    it(`ignores every mutant of a console.${method} statement by default, with the console reason`, async () => {
      await assertEvery(
        `console.${method}('saved', on ? 'a' : 'b');`,
        consoleReason,
      );
    });
  });

  [
    "export const done = console.log('saved', on ? 'a' : 'b');",
    "export function f() { return console.log('saved', on ? 'a' : 'b'); }",
    "ok || console.log('saved', on ? 'a' : 'b');",
    "report(console.log('saved', on ? 'a' : 'b'));",
    "export const view = <p>{console.log('saved', on ? 'a' : 'b')}</p>;",
  ].forEach((code) => {
    it(`keeps the mutants of a console call whose result is used: ${code}`, async () => {
      await assertEvery(code, 'placed');
    });
  });

  [
    "new console.log('saved', on ? 'a' : 'b');",
    "console['log']('saved', on ? 'a' : 'b');",
    "console[log]('saved', on ? 'a' : 'b');",
  ].forEach((code) => {
    it(`keeps the mutants of a console statement whose callee is constructed or computed: ${code}`, async () => {
      await assertEvery(code, 'placed');
    });
  });

  it('ignores every mutant of an optional console?.log call statement', async () => {
    await assertEvery("console?.log('saved', on ? 'a' : 'b');", consoleReason);
  });

  ['await', 'void'].forEach((operator) => {
    it(`ignores every mutant of a console.log statement under ${operator}`, async () => {
      await assertEvery(
        `${operator} console.log('saved', on ? 'a' : 'b');`,
        consoleReason,
      );
    });
  });

  ['warn', 'error'].forEach((method) => {
    it(`ignores a console.${method} statement when lzConsole.methods lists it`, async () => {
      await assertEvery(
        `console.${method}('saved', on ? 'a' : 'b');`,
        consoleReason,
        { lzConsole: { methods: ['warn', 'error'] } },
      );
    });
  });

  it('keeps a console.log statement when lzConsole.methods replaces the default list without it', async () => {
    await assertEvery("console.log('saved', on ? 'a' : 'b');", 'placed', {
      lzConsole: { methods: ['warn'] },
    });
  });

  [
    'warn',
    null,
    {},
    [1],
    [''],
    ['lgo'],
    ['console.log'],
    ['toString'],
    ['log', null],
  ].forEach((methods) => {
    it(`refuses methods ${JSON.stringify(methods)} when it is created`, () => {
      assert.throws(() => consoleIgnorer({ lzConsole: { methods } }), {
        message: `@layzee/stryker-jsx-mutators: lzConsole.methods must be an array of console method names, such as log or warn, not ${JSON.stringify(methods)}.`,
      });
    });
  });

  [
    {},
    { lzConsole: {} },
    { lzConsole: { methods: [] } },
    { lzConsole: { methods: consoleMethods } },
  ].forEach((options) => {
    it(`accepts the options ${JSON.stringify(options)}`, () => {
      assert.doesNotThrow(() => consoleIgnorer(options));
    });
  });

  (
    [
      ['an update', 'console.log(count++);'],
      ['a call', 'console.log(queue.shift());'],
      ['an arrow function', "console.log(() => (on ? 'a' : 'b'));"],
      [
        'a function expression',
        "console.log(function () { return on ? 'a' : 'b'; });",
      ],
      [
        'an object method',
        "console.log({ toString() { return on ? 'a' : 'b'; } });",
      ],
      [
        'a class method',
        "console.log(class { run() { return on ? 'a' : 'b'; } });",
      ],
      [
        'a private class method',
        "console.log(class { #run() { return on ? 'a' : 'b'; } });",
      ],
      ['a new expression', "console.log(new Session(on ? 'a' : 'b'));"],
      ['a tagged template', "console.log(sql`select ${on ? 'a' : 'b'}`);"],
      ['an assignment', "console.log((mode = on ? 'a' : 'b'));"],
      ['an await', 'console.log(await (on ? a : b));'],
      [
        'a yield',
        "export function* steps() { console.log(yield on ? 'a' : 'b'); }",
      ],
      ['a delete', "console.log(delete cache[on ? 'a' : 'b']);"],
      ['a dynamic import', "console.log(import(on ? './a' : './b'));"],
    ] as const
  ).forEach(([effect, code]) => {
    it(`keeps the mutants of a console.log statement whose argument holds ${effect}, as removing the statement changes what the page does`, async () => {
      await assertEvery(code, 'placed');
    });
  });

  ['console.warn', 'console.error', 'format', 'logger.log'].forEach(
    (callee) => {
      it(`keeps the mutants of a ${callee} statement by default`, async () => {
        await assertEvery(`${callee}('saved', on ? 'a' : 'b');`, 'placed');
      });
    },
  );
});

describe('the lz-console options schema', () => {
  it('describes lzConsole.methods as a list of console method names', () => {
    assert.deepEqual(lzConsoleSchema, {
      type: 'object',
      additionalProperties: false,
      description: 'Options of the lz-console ignorer.',
      properties: {
        methods: {
          type: 'array',
          items: { enum: consoleMethods },
          description:
            'The console methods whose call statements lz-console hides, unless an argument can act on the ' +
            'page. Replaces the default list: log, debug, info and trace.',
        },
      },
    });
  });

  it('lets core accept lzConsole without an unknown-option warning', async () => {
    assert.deepEqual(
      await validateOptions({ lzConsole: { methods: ['log', 'warn'] } }, [
        strykerValidationSchema,
      ]),
      { valid: true, log: [] },
    );
  });

  [
    { methods: 'log' },
    { methods: ['lgo'] },
    { methods: [1] },
    { calls: ['log'] },
    [],
  ].forEach((lzConsole) => {
    it(`lets core refuse lzConsole ${JSON.stringify(lzConsole)}`, async () => {
      const { valid, log } = await validateOptions({ lzConsole }, [
        strykerValidationSchema,
      ]);

      assert.equal(valid, false);
      assert.ok(
        log.some(
          (line) => line.startsWith('error') && line.includes('lzConsole'),
        ),
        log.join('\n'),
      );
    });
  });
});
