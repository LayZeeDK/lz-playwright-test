import { fieldOf } from '@layzee/stryker-mutator-install';

import {
  ancestors,
  argumentOf,
  bindingOf,
  hasProperty,
  isNamedReceiver,
  propertyNameOf,
} from './ast.ts';
import type { LzPlaywrightMutator } from './mutators.ts';

/** The methods that send a GET or HEAD request; `fetch` sends a GET unless it has a method option. */
const getMethods: readonly unknown[] = ['get', 'head', 'fetch'];
/** The URL parser reads any two of `/` and `\` at the start of a URL as the start of a host. */
const absolute = /^([a-z][a-z0-9+.-]*:|[\\/]{2})/i;
const localHost =
  /^(https?:)?[\\/]{2}(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])([:/?#]|$)/i;

/** An absolute URL to a host other than this machine: emptying it would leave the service under test. */
function isThirdParty(url: string): boolean {
  return absolute.test(url) && !localHost.test(url);
}

export function requestUrlMutator<const TName extends string>(
  name: TName,
  sample: string,
): LzPlaywrightMutator & { readonly name: TName } {
  return {
    name,
    sample,
    *mutate(path, t) {
      if (
        isCandidate(fieldOf(path, 'node')) &&
        (isReadUrlArgument(path) || isLoopUrl(path))
      ) {
        yield t.stringLiteral('');
      }
    },
  };
}

/** A string or template literal that is not empty and does not name a third-party host. */
function isCandidate(node: unknown): boolean {
  const text = urlText(node);

  return (
    text !== undefined &&
    (text !== '' || hasExpressions(node)) &&
    !isThirdParty(text)
  );
}

/** The URL argument of a GET or HEAD request call whose result is read. */
function isReadUrlArgument(path: unknown): boolean {
  const call = fieldOf(path, 'parent');
  const callee = fieldOf(call, 'callee');
  const method = propertyNameOf(callee);

  return (
    fieldOf(path, 'listKey') === 'arguments' &&
    fieldOf(path, 'key') === 0 &&
    isRequestReceiver(path, fieldOf(callee, 'object')) &&
    getMethods.includes(method) &&
    !(method === 'fetch' && hasMethodOption(call)) &&
    resultIsRead(fieldOf(path, 'parentPath'))
  );
}

/** An element of the array of `for (const <x> of [...])` where `<x>` is a read URL argument in the loop. */
function isLoopUrl(path: unknown): boolean {
  const loop = fieldOf(fieldOf(path, 'parentPath'), 'parentPath');
  const loopNode = fieldOf(loop, 'node');
  const declarations = fieldOf(fieldOf(loopNode, 'left'), 'declarations');

  if (
    fieldOf(path, 'listKey') !== 'elements' ||
    fieldOf(loopNode, 'type') !== 'ForOfStatement' ||
    !Array.isArray(declarations)
  ) {
    return false;
  }

  const variable = fieldOf(fieldOf(declarations[0], 'id'), 'name');
  const references = fieldOf(bindingOf(loop, variable), 'referencePaths');

  return Array.isArray(references) && references.some(isReadUrlArgument);
}

/** The text of a string literal, or of a template literal up to its first expression. */
function urlText(node: unknown): string | undefined {
  const type = fieldOf(node, 'type');

  if (type === 'StringLiteral') {
    return String(fieldOf(node, 'value'));
  }

  const quasis = fieldOf(node, 'quasis');

  return type === 'TemplateLiteral' && Array.isArray(quasis)
    ? String(fieldOf(fieldOf(quasis[0], 'value'), 'cooked'))
    : undefined;
}

function hasExpressions(template: unknown): boolean {
  const expressions = fieldOf(template, 'expressions');

  return Array.isArray(expressions) && expressions.length > 0;
}

/** `request`, `<x>.request`, or a name bound to `await <request receiver>.newContext(...)`. */
function isRequestReceiver(path: unknown, node: unknown): boolean {
  if (isNamedReceiver(node, 'request')) {
    return true;
  }

  const binding = bindingOf(path, fieldOf(node, 'name'));
  const assignments = fieldOf(binding, 'constantViolations');

  return (
    isNewContextCall(
      fieldOf(fieldOf(fieldOf(binding, 'path'), 'node'), 'init'),
    ) ||
    (Array.isArray(assignments) &&
      assignments.some((assignment) =>
        isNewContextCall(fieldOf(fieldOf(assignment, 'node'), 'right')),
      ))
  );
}

function isNewContextCall(node: unknown): boolean {
  const call =
    fieldOf(node, 'type') === 'AwaitExpression'
      ? fieldOf(node, 'argument')
      : node;
  const callee = fieldOf(call, 'callee');

  return (
    propertyNameOf(callee) === 'newContext' &&
    isNamedReceiver(fieldOf(callee, 'object'), 'request')
  );
}

function resultIsRead(callPath: unknown): boolean {
  const parentPath = fieldOf(callPath, 'parentPath');
  const userPath =
    fieldOf(fieldOf(parentPath, 'node'), 'type') === 'AwaitExpression'
      ? fieldOf(parentPath, 'parentPath')
      : parentPath;
  const user = fieldOf(userPath, 'node');

  switch (fieldOf(user, 'type')) {
    case 'ExpressionStatement':
      return false;
    case 'UnaryExpression':
      return fieldOf(user, 'operator') !== 'void';
    case 'AssignmentExpression': {
      const left = fieldOf(user, 'left');

      return (
        fieldOf(fieldOf(userPath, 'parent'), 'type') !==
          'ExpressionStatement' ||
        fieldOf(left, 'type') !== 'Identifier' ||
        isReadVariable(userPath, left)
      );
    }
    default: {
      const id = fieldOf(user, 'id');

      return (
        fieldOf(id, 'type') !== 'Identifier' || isReadVariable(userPath, id)
      );
    }
  }
}

/** The variable that `identifier` names has a reference outside a console call. */
function isReadVariable(path: unknown, identifier: unknown): boolean {
  const references = fieldOf(
    bindingOf(path, fieldOf(identifier, 'name')),
    'referencePaths',
  );

  return (
    Array.isArray(references) &&
    references.some((reference) => !isInConsoleCall(reference))
  );
}

/** Some call around `path` is `console.<x>(...)`. */
function isInConsoleCall(path: unknown): boolean {
  return [...ancestors(path)].some(
    (ancestor) =>
      fieldOf(
        fieldOf(fieldOf(fieldOf(ancestor, 'node'), 'callee'), 'object'),
        'name',
      ) === 'console',
  );
}

/** The options argument names a method, or may: it is no object literal, or it holds a spread. `get` and `head` set
 * their own method over any option, so only `fetch` asks. */
function hasMethodOption(call: unknown): boolean {
  const options = argumentOf(call, 1);

  if (options === undefined) {
    return false;
  }

  const properties = fieldOf(options, 'properties');

  return (
    !Array.isArray(properties) ||
    properties.some(
      (property) => fieldOf(property, 'type') === 'SpreadElement',
    ) ||
    hasProperty(options, 'method')
  );
}
