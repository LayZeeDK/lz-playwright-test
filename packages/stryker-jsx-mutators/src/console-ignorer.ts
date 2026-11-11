import { fieldOf } from '@layzee/stryker-mutator-install';
import type { Ignorer } from '@stryker-mutator/api/ignore';
import { commonTokens, tokens } from '@stryker-mutator/api/plugin';

import { listOption } from './list-option.ts';
import { hideableCallee } from './statement-call.ts';

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

export const consoleIgnorerName = 'lz-console';

export const lzConsoleSchema = {
  type: 'object',
  additionalProperties: false,
  description: `Options of the ${consoleIgnorerName} ignorer.`,
  properties: {
    methods: {
      type: 'array',
      items: { enum: consoleMethods },
      description:
        `The console methods whose call statements ${consoleIgnorerName} hides, unless an argument can act on the ` +
        'page. Replaces the default list: log, debug, info and trace.',
    },
  },
};

export function consoleIgnorer(options: object): Ignorer {
  const callees: readonly unknown[] = listOption(
    options,
    'lzConsole',
    'methods',
    defaultMethods,
    isMethod,
    'an array of console method names, such as log or warn',
  ).map((method) => `console.${method}`);

  return {
    shouldIgnore(path) {
      if (callees.includes(hideableCallee(fieldOf(path, 'node')))) {
        return `${consoleIgnorerName}: console output; DOM tests do not observe it`;
      }

      return undefined;
    },
  };
}
consoleIgnorer.inject = tokens(commonTokens.options);

function isMethod(name: unknown): name is string {
  return consoleMethods.includes(name);
}
