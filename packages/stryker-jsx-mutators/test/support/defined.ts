import assert from 'node:assert/strict';

export function defined<T>(value: T | undefined): T {
  assert.ok(value !== undefined);

  return value;
}
