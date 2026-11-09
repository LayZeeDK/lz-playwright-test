import { fieldOf } from '@layzee/stryker-mutator-install';

import {
  isRequestContext,
  memberNameOf,
  outermost,
  propertyKey,
  unwrapped,
} from './ast.ts';
import type { LzPlaywrightMutator } from './mutators.ts';

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
  const outer = outermost(path);

  if (fieldOf(outer, 'key') === 'value') {
    const property = fieldOf(outer, 'parentPath');

    return (
      (fieldOf(unwrapped(fieldOf(outer, 'node')), 'type') ===
        'ObjectExpression' &&
        isPayload(property)) ||
      inPayload(fieldOf(property, 'parentPath'))
    );
  }

  return (
    fieldOf(fieldOf(outer, 'parent'), 'type') === 'ArrayExpression' &&
    inPayload(fieldOf(outer, 'parentPath'))
  );
}

/** A payload property of the options argument of a request call. */
function isPayload(propertyPath: unknown): boolean {
  const optionsPath = outermost(fieldOf(propertyPath, 'parentPath'));

  return (
    payloadKeys.includes(propertyKey(fieldOf(propertyPath, 'node'))) &&
    fieldOf(optionsPath, 'key') === 1 &&
    isPayloadCall(optionsPath, fieldOf(optionsPath, 'parent'))
  );
}

function isPayloadCall(path: unknown, call: unknown): boolean {
  const callee = fieldOf(call, 'callee');

  return (
    isRequestContext(path, fieldOf(callee, 'object')) &&
    payloadMethods.includes(memberNameOf(callee))
  );
}
