import assert from 'node:assert/strict';

export function exported(namespace: unknown, name: string): unknown {
  assert.ok(typeof namespace === 'object' && namespace !== null);

  return Reflect.get(namespace, name);
}

export function exportedFunction(namespace: unknown, name: string) {
  const value = exported(namespace, name);
  assert.ok(typeof value === 'function');

  return value;
}
