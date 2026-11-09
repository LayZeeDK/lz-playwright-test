import { fieldOf } from '@layzee/stryker-mutator-install';

import {
  ancestors,
  argumentOf,
  callTypes,
  hasProperty,
  methodOf,
} from './ast.ts';
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

/** A Route method that settles a request, mapped to the one with the opposite outcome. */
const outcomeFlips: Readonly<Record<string, string>> = {
  abort: 'continue',
  continue: 'abort',
  fallback: 'abort',
};

export function outcomeMutator<const TName extends string>(
  name: TName,
  sample: string,
): LzPlaywrightMutator & { readonly name: TName } {
  return {
    name,
    sample,
    *mutate(path, t) {
      const node = fieldOf(path, 'node');
      const callee = fieldOf(node, 'callee');
      const route = fieldOf(fieldOf(callee, 'object'), 'name');
      const method = methodOf(callee);
      const flipped =
        typeof method === 'string' && Object.hasOwn(outcomeFlips, method)
          ? outcomeFlips[method]
          : undefined;

      if (
        callTypes.includes(fieldOf(node, 'type')) &&
        flipped !== undefined &&
        typeof route === 'string' &&
        isInHandlerOf(path, route)
      ) {
        yield t.callExpression(
          t.memberExpression(t.identifier(route), t.identifier(flipped)),
          [],
        );
      }
    },
  };
}

/** The nearest function around `path` with a parameter named `route` is a route handler, and `route` is its first. */
function isInHandlerOf(path: unknown, route: string): boolean {
  const handlerPath = [...ancestors(path)].find((ancestor) =>
    paramsOf(ancestor).some((param) => fieldOf(param, 'name') === route),
  );
  const first = paramsOf(handlerPath)[0];

  return (
    handlerPath !== undefined &&
    fieldOf(first, 'type') === 'Identifier' &&
    fieldOf(first, 'name') === route &&
    (isRouteAnnotated(first) ||
      isRouteCallback(
        fieldOf(handlerPath, 'parent'),
        fieldOf(handlerPath, 'node'),
      ))
  );
}

function paramsOf(functionPath: unknown): readonly unknown[] {
  const params = fieldOf(fieldOf(functionPath, 'node'), 'params');

  return Array.isArray(params) ? params : [];
}

/** `handler` is the second argument of `<x>.route(...)`. */
function isRouteCallback(call: unknown, handler: unknown): boolean {
  return (
    argumentOf(call, 1) === handler &&
    methodOf(fieldOf(call, 'callee')) === 'route'
  );
}

/** The parameter is written `<name>: Route`. */
function isRouteAnnotated(parameter: unknown): boolean {
  const annotation = fieldOf(
    fieldOf(parameter, 'typeAnnotation'),
    'typeAnnotation',
  );

  return (
    fieldOf(annotation, 'type') === 'TSTypeReference' &&
    fieldOf(fieldOf(annotation, 'typeName'), 'name') === 'Route'
  );
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
    methodOf(fieldOf(call, 'callee')) === 'fulfill'
  );
}
