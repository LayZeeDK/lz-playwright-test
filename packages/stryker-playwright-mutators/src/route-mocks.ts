import { fieldOf } from '@layzee/stryker-mutator-install';

import type { LzPlaywrightMutator } from './mutators.ts';

export function fulfillMutator<const TName extends string>(
  name: TName,
  sample: string,
): LzPlaywrightMutator & { readonly name: TName } {
  return {
    name,
    sample,
    *mutate(path, t) {
      const node = fieldOf(path, 'node');

      if (isEmptyValue(node)) {
        return;
      }

      if (isFulfillOption(path, 'json')) {
        yield fieldOf(node, 'type') === 'ArrayExpression'
          ? t.arrayExpression([])
          : t.objectExpression([]);
      }

      if (isFulfillOption(path, 'body')) {
        yield t.stringLiteral('');
      }

      if (isFulfillOption(path, 'status')) {
        if (isNumberBetween(node, 200, 399)) {
          yield t.numericLiteral(500);
        }

        if (isNumberBetween(node, 400, 599)) {
          yield t.numericLiteral(200);
        }
      }
    },
  };
}

function isNumberBetween(node: unknown, min: number, max: number): boolean {
  const value = fieldOf(node, 'value');

  return (
    fieldOf(node, 'type') === 'NumericLiteral' &&
    typeof value === 'number' &&
    value >= min &&
    value <= max
  );
}

function hasProperty(object: unknown, key: string): boolean {
  const properties = fieldOf(object, 'properties');

  return (
    Array.isArray(properties) &&
    properties.some(
      (property) => fieldOf(fieldOf(property, 'key'), 'name') === key,
    )
  );
}

function isEmptyValue(node: unknown): boolean {
  const type = fieldOf(node, 'type');

  return (
    (type === 'ObjectExpression' &&
      lengthOf(fieldOf(node, 'properties')) === 0) ||
    (type === 'ArrayExpression' && lengthOf(fieldOf(node, 'elements')) === 0) ||
    (type === 'StringLiteral' && fieldOf(node, 'value') === '')
  );
}

function lengthOf(list: unknown): number | undefined {
  return Array.isArray(list) ? list.length : undefined;
}

/** The value of the property `key` in the object literal that is the first argument of `<x>.fulfill(...)`. */
function isFulfillOption(path: unknown, key: string): boolean {
  const property = fieldOf(path, 'parent');
  const object = fieldOf(fieldOf(path, 'parentPath'), 'parent');
  const call = fieldOf(
    fieldOf(fieldOf(path, 'parentPath'), 'parentPath'),
    'parent',
  );

  return (
    fieldOf(property, 'type') === 'ObjectProperty' &&
    fieldOf(property, 'computed') === false &&
    fieldOf(fieldOf(property, 'key'), 'name') === key &&
    fieldOf(property, 'value') === fieldOf(path, 'node') &&
    fieldOf(object, 'type') === 'ObjectExpression' &&
    !hasProperty(object, 'response') &&
    fieldOf(call, 'type') === 'CallExpression' &&
    fieldOf(fieldOf(fieldOf(call, 'callee'), 'property'), 'name') === 'fulfill'
  );
}
