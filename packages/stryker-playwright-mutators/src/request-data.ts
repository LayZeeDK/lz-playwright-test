import { fieldOf } from '@layzee/stryker-mutator-install';

import type { LzPlaywrightMutator } from './mutators.ts';
import { isNamedReceiver } from './statement-removal.ts';

const payloadKeys: readonly unknown[] = ['data', 'form', 'params'];
const payloadMethods: readonly unknown[] = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'fetch',
];

export function requestDataMutator<const TName extends string>(
  name: TName,
  sample: string,
): LzPlaywrightMutator & { readonly name: TName } {
  return {
    name,
    sample,
    *mutate(path, t) {
      if (!inPayload(path)) {
        return;
      }

      const node = fieldOf(path, 'node');
      const value = fieldOf(node, 'value');
      const type = fieldOf(node, 'type');

      if (type === 'StringLiteral') {
        yield t.stringLiteral(`${String(value)}x`);
      }

      if (type === 'NumericLiteral') {
        yield t.numericLiteral(Number(value) + 1);
      }

      if (type === 'BooleanLiteral') {
        yield t.booleanLiteral(value !== true);
      }
    },
  };
}

/** `path` sits, through object values and array elements, inside the object that is the value of a payload property. */
function inPayload(path: unknown): boolean {
  let current = path;

  for (;;) {
    const parentType = fieldOf(fieldOf(current, 'parent'), 'type');

    if (
      fieldOf(current, 'key') === 'value' &&
      parentType === 'ObjectProperty'
    ) {
      const property = fieldOf(current, 'parentPath');

      if (
        fieldOf(fieldOf(current, 'node'), 'type') === 'ObjectExpression' &&
        isPayload(property)
      ) {
        return true;
      }

      current = fieldOf(property, 'parentPath');
    } else if (
      fieldOf(current, 'listKey') === 'elements' &&
      parentType === 'ArrayExpression'
    ) {
      current = fieldOf(current, 'parentPath');
    } else {
      return false;
    }
  }
}

/** A payload property of the options argument of a request call. */
function isPayload(propertyPath: unknown): boolean {
  const optionsPath = fieldOf(propertyPath, 'parentPath');
  const key = fieldOf(fieldOf(propertyPath, 'node'), 'key');

  return (
    payloadKeys.includes(fieldOf(key, 'name') ?? fieldOf(key, 'value')) &&
    fieldOf(optionsPath, 'listKey') === 'arguments' &&
    fieldOf(optionsPath, 'key') === 1 &&
    isPayloadCall(fieldOf(optionsPath, 'parent'))
  );
}

function isPayloadCall(call: unknown): boolean {
  const callee = fieldOf(call, 'callee');

  return (
    isNamedReceiver(fieldOf(callee, 'object'), 'request') &&
    payloadMethods.includes(fieldOf(fieldOf(callee, 'property'), 'name'))
  );
}
