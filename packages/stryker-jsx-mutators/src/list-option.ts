import { fieldOf } from '@layzee/stryker-mutator-install';

import { packageName } from './package-name.ts';

export function listOption(
  options: object,
  key: string,
  field: string,
  fallback: readonly string[],
  isItem: (item: unknown) => item is string,
  expected: string,
): readonly string[] {
  const own = fieldOf(fieldOf(options, key), field);
  const list: unknown = own === undefined ? fallback : own;

  if (!Array.isArray(list) || !list.every(isItem)) {
    throw new Error(
      `${packageName}: ${key}.${field} must be ${expected}, not ${JSON.stringify(own)}.`,
    );
  }

  return list;
}
