import { isRecord } from './is-record.ts';

export function field(value: unknown, ...keys: readonly string[]): unknown {
  return keys.reduce<unknown>(
    (found, key) => (isRecord(found) ? found[key] : undefined),
    value,
  );
}

export function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}
