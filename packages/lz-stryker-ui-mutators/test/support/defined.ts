import assert from 'node:assert/strict';

/** The value, after failing the test when an index or a lookup found nothing. */
export function defined<T>(value: T | undefined): T {
  assert.ok(value !== undefined);

  return value;
}
