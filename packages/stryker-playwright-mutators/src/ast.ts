import { fieldOf } from '@layzee/stryker-mutator-install';

const callTypes: readonly unknown[] = [
  'CallExpression',
  'OptionalCallExpression',
];
const memberTypes: readonly unknown[] = [
  'MemberExpression',
  'OptionalMemberExpression',
];

/** `<x>(...)` or `<x>?.(...)`. */
export function isCall(node: unknown): boolean {
  return callTypes.includes(fieldOf(node, 'type'));
}

/** The property name of `<x>.<name>` or `<x>?.<name>`. */
export function methodOf(member: unknown): unknown {
  return memberTypes.includes(fieldOf(member, 'type')) &&
    fieldOf(member, 'computed') === false
    ? fieldOf(fieldOf(member, 'property'), 'name')
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

/** `<x>.request`, `<x>?.request`, or a bare `request` that a parameter binds: a fixture or a helper's argument. */
export function isRequest(path: unknown, node: unknown): boolean {
  return (
    methodOf(node) === 'request' ||
    (fieldOf(node, 'name') === 'request' &&
      fieldOf(bindingOf(path, 'request'), 'kind') === 'param')
  );
}

/** `test`, or a member chain on it such as `test.describe.serial`. */
export function isTestCallee(callee: unknown): boolean {
  if (memberTypes.includes(fieldOf(callee, 'type'))) {
    return isTestCallee(fieldOf(callee, 'object'));
  }

  return (
    fieldOf(callee, 'type') === 'Identifier' &&
    fieldOf(callee, 'name') === 'test'
  );
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
    current !== undefined && current !== null;
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
