import assert from 'node:assert/strict';

import type { Ignorer } from '@stryker-mutator/api/ignore';

import { resolveFromCore } from '../../src/install.ts';
import { instrumentFully } from './instrument-result.ts';

const instrumenter = resolveFromCore();

export async function ignorerOutcomes(
  ignorer: Ignorer,
  code: string,
): Promise<string[]> {
  const { mutants } = await instrumentFully(
    await instrumenter,
    [{ name: 'a.tsx', content: code }],
    [],
    [ignorer],
  );

  return mutants.map(({ status, statusReason }) =>
    status === 'Ignored' ? (statusReason ?? 'Ignored') : 'placed',
  );
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
