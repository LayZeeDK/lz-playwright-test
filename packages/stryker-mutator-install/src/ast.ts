import { fieldOf } from './is-record.ts';

export const callTypes: readonly unknown[] = [
  'CallExpression',
  'OptionalCallExpression',
];
export const memberTypes: readonly unknown[] = [
  'MemberExpression',
  'OptionalMemberExpression',
];

/** The Babel binding that `name` refers to in the scope of `path`. */
export function bindingOf(path: unknown, name: unknown): unknown {
  const scope = fieldOf(path, 'scope');
  const getBinding = fieldOf(scope, 'getBinding');

  return typeof getBinding === 'function'
    ? Reflect.apply(getBinding, scope, [name])
    : undefined;
}
