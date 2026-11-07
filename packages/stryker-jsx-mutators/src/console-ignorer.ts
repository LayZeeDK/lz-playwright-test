import type { Ignorer } from '@stryker-mutator/api/ignore';
import { commonTokens, tokens } from '@stryker-mutator/api/plugin';

import { fieldOf } from './is-record.ts';
import { packageName } from './package-name.ts';
import { statementCallee } from './statement-call.ts';

const consoleMethods: readonly unknown[] = [
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
const defaultMethods: readonly string[] = ['log', 'debug', 'info', 'trace'];

export const strykerValidationSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    lzConsole: {
      type: 'object',
      additionalProperties: false,
      description: 'Options of the lz-console ignorer.',
      properties: {
        methods: {
          type: 'array',
          items: { enum: consoleMethods },
          description:
            'The console methods whose call statements lz-console hides. Replaces the default list: log, ' +
            'debug, info and trace.',
        },
      },
    },
  },
};

export function consoleIgnorer(options: object): Ignorer {
  const callees: readonly unknown[] = methodsOf(options).map(
    (method) => `console.${method}`,
  );

  return {
    shouldIgnore(path) {
      if (callees.includes(statementCallee(fieldOf(path, 'node')))) {
        return 'lz-console: console output; DOM tests do not observe it';
      }

      return undefined;
    },
  };
}
consoleIgnorer.inject = tokens(commonTokens.options);

function methodsOf(options: object): readonly string[] {
  const own = fieldOf(fieldOf(options, 'lzConsole'), 'methods');

  if (own === undefined) {
    return defaultMethods;
  }

  if (!isMethodList(own)) {
    throw new Error(
      `${packageName}: lzConsole.methods must be an array of console method names, such as log or warn, ` +
        `not ${JSON.stringify(own)}.`,
    );
  }

  return own;
}

function isMethodList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((name: unknown) => consoleMethods.includes(name))
  );
}
