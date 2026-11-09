import assert from 'node:assert/strict';

import { fieldOf } from '@layzee/stryker-mutator-install';
import type { Ignorer } from '@stryker-mutator/api/ignore';

import { resolveFromCore } from '../../src/install.ts';
import { instrumentedMutants } from './mutants.ts';

const instrumenter = resolveFromCore();

/** Each mutant of `code` as its ignore reason, or `placed` when no ignorer hid it. */
export async function ignorerOutcomes(
  ignorer: Ignorer,
  code: string,
): Promise<string[]> {
  const mutants = await instrumentedMutants(
    await instrumenter,
    [{ name: 'a.ts', content: code }],
    [ignorer],
  );

  return mutants.map((mutant) => {
    const reason = fieldOf(mutant, 'statusReason');

    if (fieldOf(mutant, 'status') !== 'Ignored') {
      return 'placed';
    }

    return typeof reason === 'string' ? reason : 'Ignored';
  });
}

export async function assertEveryOutcome(
  ignorer: Ignorer,
  code: string,
  outcome: string,
): Promise<void> {
  const found = await ignorerOutcomes(ignorer, code);

  assert.ok(found.length > 0, `no mutants in ${code}`);
  assert.deepEqual(new Set(found), new Set([outcome]), code);
}
