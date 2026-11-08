import { fieldOf } from '@layzee/stryker-mutator-install';

export function typeOf(node: unknown): unknown {
  return fieldOf(node, 'type');
}
