import { fieldOf } from '@layzee/stryker-mutator-install';
import type { Ignorer } from '@stryker-mutator/api/ignore';

const functionTypes: readonly unknown[] = [
  'ArrowFunctionExpression',
  'FunctionExpression',
];
const serializingMethods: readonly unknown[] = [
  'evaluate',
  'evaluateHandle',
  'evaluateAll',
  '$eval',
  '$$eval',
  'addInitScript',
  'waitForFunction',
];

export const serializedIgnorer: Ignorer = {
  shouldIgnore(path) {
    const callee = fieldOf(
      fieldOf(fieldOf(path, 'parentPath'), 'node'),
      'callee',
    );
    const method = fieldOf(fieldOf(callee, 'property'), 'name');

    if (
      fieldOf(path, 'listKey') === 'arguments' &&
      functionTypes.includes(fieldOf(fieldOf(path, 'node'), 'type')) &&
      fieldOf(callee, 'computed') === false &&
      typeof method === 'string' &&
      serializingMethods.includes(method)
    ) {
      return `lz-playwright-serialized: Playwright's ${method} runs this function's source text where Stryker's helpers do not exist`;
    }

    return undefined;
  },
};
