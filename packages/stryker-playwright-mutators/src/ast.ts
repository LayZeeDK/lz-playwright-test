import { fieldOf } from '@layzee/stryker-mutator-install';

export const callTypes: readonly unknown[] = [
  'CallExpression',
  'OptionalCallExpression',
];
export const memberTypes: readonly unknown[] = [
  'MemberExpression',
  'OptionalMemberExpression',
];

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

/** The object literal has a non-computed property whose key is the identifier or string `key`. */
export function hasProperty(object: unknown, key: string): boolean {
  const properties = fieldOf(object, 'properties');

  return (
    Array.isArray(properties) &&
    properties.some((property) => {
      const propertyKey = fieldOf(property, 'key');

      return (
        fieldOf(property, 'computed') !== true &&
        (fieldOf(propertyKey, 'name') ?? fieldOf(propertyKey, 'value')) === key
      );
    })
  );
}

/** `<name>`, `<x>.<name>` or `<x>?.<name>`. */
export function isNamedReceiver(node: unknown, name: string): boolean {
  return fieldOf(node, 'name') === name || methodOf(node) === name;
}

/** `test`, or a member chain on it such as `test.describe.serial`. */
export function isTestCallee(callee: unknown): boolean {
  if (fieldOf(callee, 'type') === 'MemberExpression') {
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
