import { fieldOf } from '@layzee/stryker-mutator-install';

const callTypes: readonly unknown[] = [
  'CallExpression',
  'OptionalCallExpression',
];
const memberTypes: readonly unknown[] = [
  'MemberExpression',
  'OptionalMemberExpression',
];

// Stryker's instrumenter visits nothing inside `as`, but it visits inside these wrappers.
const typeWrappers: readonly unknown[] = [
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
];

/** `<x> satisfies <T>`, `<x>!` or `<T><x>`. */
export function isTypeWrapper(node: unknown): boolean {
  return typeWrappers.includes(fieldOf(node, 'type'));
}

/** The expression inside any type wrapper around `node`. */
export function unwrapped(node: unknown): unknown {
  return isTypeWrapper(node) ? unwrapped(fieldOf(node, 'expression')) : node;
}

/** The path of the outermost type wrapper around `path`, or `path` itself. */
export function outermost(path: unknown): unknown {
  return isTypeWrapper(fieldOf(path, 'parent'))
    ? outermost(fieldOf(path, 'parentPath'))
    : path;
}

/** `<x>(...)` or `<x>?.(...)`. */
export function isCall(node: unknown): boolean {
  return callTypes.includes(fieldOf(node, 'type'));
}

/** The property name of `<x>.<name>` or `<x>?.<name>`. */
export function methodOf(member: unknown): unknown {
  return fieldOf(member, 'computed') === false
    ? fieldOf(fieldOf(member, 'property'), 'name')
    : undefined;
}

/** The row of `table` under `key`, or undefined when `key` is no string or no own key of it. */
export function rowOf<T>(
  table: Readonly<Record<string, T>>,
  key: unknown,
): T | undefined {
  return typeof key === 'string' && Object.hasOwn(table, key)
    ? table[key]
    : undefined;
}

export function argumentOf(call: unknown, index: number): unknown {
  const args = fieldOf(call, 'arguments');

  return Array.isArray(args) ? args[index] : undefined;
}

/** The key of a non-computed property: the name of an identifier key, or the value of a literal key. */
export function propertyKey(property: unknown): unknown {
  const key = fieldOf(property, 'key');

  return fieldOf(property, 'computed') === false
    ? (fieldOf(key, 'name') ?? fieldOf(key, 'value'))
    : undefined;
}

/** The property of the object literal whose key, by `propertyKey`, is `key`. */
export function findProperty(object: unknown, key: string): unknown {
  const properties = fieldOf(object, 'properties');

  return Array.isArray(properties)
    ? properties.find((property) => propertyKey(property) === key)
    : undefined;
}

export function hasProperty(object: unknown, key: string): boolean {
  return findProperty(object, key) !== undefined;
}

/** `<name>`, `<x>.<name>` or `<x>?.<name>`. */
export function isNamedReceiver(node: unknown, name: string): boolean {
  return fieldOf(node, 'name') === name || methodOf(node) === name;
}

/**
 * An APIRequestContext, which sends requests: `<x>.request`, `<x>?.request`, or a bare `request` that a parameter
 * binds, a fixture or a helper's argument.
 */
export function isRequestContext(path: unknown, node: unknown): boolean {
  return (
    methodOf(node) === 'request' ||
    (fieldOf(node, 'name') === 'request' &&
      fieldOf(bindingOf(path, 'request'), 'kind') === 'param')
  );
}

/**
 * An APIRequest, which `newContext` is called on: `request`, `<x>.request` or `<x>?.request`. A bare `request` counts
 * however it is bound, as `import { request } from '@playwright/test'` gives one.
 */
export function isRequestFactory(node: unknown): boolean {
  return isNamedReceiver(node, 'request');
}

/** `test`, or a member chain on it such as `test.describe.serial`. */
export function isTestCallee(callee: unknown): boolean {
  if (memberTypes.includes(fieldOf(callee, 'type'))) {
    return isTestCallee(fieldOf(callee, 'object'));
  }

  return fieldOf(callee, 'name') === 'test';
}

/** A node whose type names a function or a method, such as `ArrowFunctionExpression` or `ObjectMethod`. */
export function isFunctionNode(node: unknown): boolean {
  const type = fieldOf(node, 'type');

  return typeof type === 'string' && /Function|Method/.test(type);
}

/** The paths around `path`, nearest first. */
export function* ancestors(path: unknown): Generator<unknown, void, void> {
  for (
    let current = fieldOf(path, 'parentPath');
    current != null;
    current = fieldOf(current, 'parentPath')
  ) {
    yield current;
  }
}

/** The Babel binding that `name` refers to in the scope of `path`. */
export function bindingOf(path: unknown, name: unknown): unknown {
  const scope = fieldOf(path, 'scope');
  const getBinding = fieldOf(scope, 'getBinding');

  return typeof getBinding === 'function'
    ? Reflect.apply(getBinding, scope, [name])
    : undefined;
}
