import assert from 'node:assert/strict';

import { coreInstrument, fieldOf } from '@layzee/stryker-mutator-install';
import type { Ignorer } from '@stryker-mutator/api/ignore';

import { resolveFromCore } from '../../src/install.ts';
import { packageName } from '../../src/package-name.ts';

const instrumenter = resolveFromCore();

/** Each mutant of `code` as its ignore reason, or `placed` when no ignorer hid it. */
export async function ignorerOutcomes(
  ignorer: Ignorer,
  code: string,
): Promise<string[]> {
  const instrument = await coreInstrument({
    packageName,
    ...(await instrumenter),
  });
  const mutants = fieldOf(
    await instrument([{ name: 'a.ts', content: code }], [], [ignorer]),
    'mutants',
  );

  if (!Array.isArray(mutants)) {
    throw new Error('Instrumenter.instrument() gave no mutants');
  }

  return mutants.map((mutant: unknown) => {
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
