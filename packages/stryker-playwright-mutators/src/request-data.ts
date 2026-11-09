import { fieldOf } from '@layzee/stryker-mutator-install';

import { isRequest, methodOf, propertyKey } from './ast.ts';
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
// Stryker's instrumenter visits nothing inside `as`, so only these two wrappers can hold a mutated value.
const typeWrappers: readonly unknown[] = [
  'TSSatisfiesExpression',
  'TSNonNullExpression',
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
  const parentType = fieldOf(fieldOf(path, 'parent'), 'type');

  if (typeWrappers.includes(parentType)) {
    return inPayload(fieldOf(path, 'parentPath'));
  }

  if (fieldOf(path, 'key') === 'value') {
    const property = fieldOf(path, 'parentPath');

    return (
      (fieldOf(unwrapped(fieldOf(path, 'node')), 'type') ===
        'ObjectExpression' &&
        isPayload(property)) ||
      inPayload(fieldOf(property, 'parentPath'))
    );
  }

  return (
    parentType === 'ArrayExpression' && inPayload(fieldOf(path, 'parentPath'))
  );
}

/** The expression inside any `satisfies` and `!` around `node`. */
function unwrapped(node: unknown): unknown {
  return typeWrappers.includes(fieldOf(node, 'type'))
    ? unwrapped(fieldOf(node, 'expression'))
    : node;
}

/** The path of the outermost `satisfies` or `!` around `path`, or `path` itself. */
function outermost(path: unknown): unknown {
  return typeWrappers.includes(fieldOf(fieldOf(path, 'parent'), 'type'))
    ? outermost(fieldOf(path, 'parentPath'))
    : path;
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
    isRequest(path, fieldOf(callee, 'object')) &&
    payloadMethods.includes(methodOf(callee))
  );
}
