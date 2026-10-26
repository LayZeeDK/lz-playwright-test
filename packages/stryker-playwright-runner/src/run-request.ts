import type {
  DryRunOptions,
  MutantRunOptions,
} from '@stryker-mutator/api/test-runner';

import type { RunSettings } from './protocol.ts';
import { type SerialGroups, withSerialGroups } from './serial-groups.ts';
import {
  type ConfigTimeouts,
  DRY_RUN_BUDGET,
  mutantRunBudget,
  type RunBudget,
} from './timeouts.ts';

export type RunRequest = DryRunRequest | MutantRunRequest;

export interface DryRunRequest {
  readonly kind: 'dry';
  readonly disableBail: boolean;
  readonly coverageAnalysis: DryRunOptions['coverageAnalysis'];
  readonly budget: RunBudget;
}

export interface MutantRunRequest {
  readonly kind: 'mutant';
  readonly disableBail: boolean;
  readonly activeMutant: string;
  /** The Playwright test ids to run, serial groups included; undefined runs every test. */
  readonly testFilter: string[] | undefined;
  readonly hitLimit: number | undefined;
  readonly budget: RunBudget;
}

export function dryRunRequest({
  disableBail,
  coverageAnalysis,
}: DryRunOptions): DryRunRequest {
  return { kind: 'dry', disableBail, coverageAnalysis, budget: DRY_RUN_BUDGET };
}

export function mutantRunRequest(
  {
    activeMutant,
    testFilter,
    hitLimit,
    disableBail,
    timeout,
  }: MutantRunOptions,
  session: {
    readonly serialGroups: SerialGroups;
    readonly timeouts: ConfigTimeouts;
  },
): MutantRunRequest {
  return {
    kind: 'mutant',
    disableBail,
    activeMutant: activeMutant.id,
    testFilter: withSerialGroups(testFilter, session.serialGroups),
    hitLimit,
    budget: mutantRunBudget(timeout, session.timeouts),
  };
}

export function runSettings(request: RunRequest, outDir: string): RunSettings {
  return request.kind === 'dry'
    ? { outDir, perTest: request.coverageAnalysis === 'perTest' }
    : { outDir, perTest: false, hitLimit: request.hitLimit };
}
