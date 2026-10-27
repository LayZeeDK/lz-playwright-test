import assert from 'node:assert/strict';

/** The function that a namespace from `import()` exports under `name`. */
export function exportedFunction(namespace: unknown, name: string) {
  assert.ok(typeof namespace === 'object' && namespace !== null);
  const value: unknown = Reflect.get(namespace, name);
  assert.ok(typeof value === 'function');

  return value;
}
