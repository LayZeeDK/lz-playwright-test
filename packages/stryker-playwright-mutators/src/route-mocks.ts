import { bindingOf, fieldOf } from '@layzee/stryker-mutator-install';

import {
  argumentOf,
  hasProperty,
  isCall,
  memberNameOf,
  outermost,
  propertyKey,
  rowOf,
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
      const flipped = rowOf(
        outcomeFlips,
        memberNameOf(fieldOf(node, 'callee')),
      );

      if (!isCall(node) || flipped === undefined) {
        return;
      }

      const route = handlerRouteOf(path, node);

      if (route !== undefined) {
        yield t.callExpression(
          t.memberExpression(t.identifier(route), t.identifier(flipped)),
          [],
        );
      }
    },
  };
}

/** The name of the receiver of `call`, when it is the route parameter of a handler around `path`. */
function handlerRouteOf(path: unknown, call: unknown): string | undefined {
  const route = fieldOf(fieldOf(fieldOf(call, 'callee'), 'object'), 'name');

  return typeof route === 'string' && isInHandlerOf(path, route)
    ? route
    : undefined;
}

/** `route`, in the scope of `path`, is the first parameter of a route handler, named on its own or with a default. */
function isInHandlerOf(path: unknown, route: string): boolean {
  const paramPath = fieldOf(bindingOf(path, route), 'path');
  const handlerPath = fieldOf(paramPath, 'parentPath');
  const param = withoutDefault(fieldOf(paramPath, 'node'));

  return (
    fieldOf(param, 'type') === 'Identifier' &&
    fieldOf(paramPath, 'key') === 0 &&
    (isRouteAnnotated(param) ||
      isRouteCallback(
        fieldOf(handlerPath, 'parent'),
        fieldOf(handlerPath, 'node'),
      ))
  );
}

/** The parameter `node` names: the left side of `<name> = <default>`, else `node` itself. */
function withoutDefault(node: unknown): unknown {
  return fieldOf(node, 'type') === 'AssignmentPattern'
    ? fieldOf(node, 'left')
    : node;
}

/** `handler` is the second argument of `<x>.route(...)`. */
function isRouteCallback(call: unknown, handler: unknown): boolean {
  return (
    isCall(call) &&
    argumentOf(call, 1) === handler &&
    memberNameOf(fieldOf(call, 'callee')) === 'route'
  );
}

/** The parameter is written `<name>: Route`. */
function isRouteAnnotated(parameter: unknown): boolean {
  const annotation = fieldOf(
    fieldOf(parameter, 'typeAnnotation'),
    'typeAnnotation',
  );

  return fieldOf(fieldOf(annotation, 'typeName'), 'name') === 'Route';
}

/** A numeric literal from `min` to `max`. */
function isNumberBetween(node: unknown, min: number, max: number): boolean {
  const value = fieldOf(node, 'value');

  return typeof value === 'number' && value >= min && value <= max;
}

/** A fulfill option value that is already empty: `{}`, `[]` or `''`. */
function isEmptyValue(node: unknown): boolean {
  return (
    lengthOf(fieldOf(node, 'properties')) === 0 ||
    lengthOf(fieldOf(node, 'elements')) === 0 ||
    fieldOf(node, 'value') === ''
  );
}

function lengthOf(list: unknown): number | undefined {
  return Array.isArray(list) ? list.length : undefined;
}

/** The value of the property `key` in the object literal that is the first argument of `<route>.fulfill(...)`, under
 * any type wrapper, in a handler of `<route>`. */
function isFulfillOption(path: unknown, key: string): boolean {
  const property = fieldOf(path, 'parent');
  const object = fieldOf(fieldOf(path, 'parentPath'), 'parent');
  const optionsPath = outermost(
    fieldOf(fieldOf(path, 'parentPath'), 'parentPath'),
  );
  const call = fieldOf(optionsPath, 'parent');

  return (
    propertyKey(property) === key &&
    fieldOf(property, 'value') === fieldOf(path, 'node') &&
    argumentOf(call, 0) === fieldOf(optionsPath, 'node') &&
    !hasProperty(object, 'response') &&
    isCall(call) &&
    memberNameOf(fieldOf(call, 'callee')) === 'fulfill' &&
    handlerRouteOf(path, call) !== undefined
  );
}
