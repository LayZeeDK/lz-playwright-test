import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';
import type {
  DryRunOptions,
  MutantRunOptions,
} from '@stryker-mutator/api/test-runner';

import type { RunTestsParams } from './playwright-internals.ts';
import { runSettingsEnv, type RunSettings } from './protocol.ts';
import { type SerialGroups, withSerialGroups } from './serial-groups.ts';
import {
  type ConfigTimeouts,
  dryRunBudget,
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
  readonly testFilter: readonly string[] | undefined;
  readonly hitLimit: number | undefined;
  readonly budget: RunBudget;
}

export function dryRunRequest({
  disableBail,
  coverageAnalysis,
}: DryRunOptions): DryRunRequest {
  return { kind: 'dry', disableBail, coverageAnalysis, budget: dryRunBudget };
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

export interface RunPlan {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly params: Pick<RunTestsParams, 'testIds' | 'maxFailures' | 'timeout'>;
}

export function runPlan(request: RunRequest, outDir: string): RunPlan {
  const mutant = request.kind === 'mutant' ? request : undefined;
  const settings: RunSettings = {
    outDir,
    perTest: request.kind === 'dry' && request.coverageAnalysis === 'perTest',
    hitLimit: mutant?.hitLimit,
  };

  return {
    env: {
      [runSettingsEnv]: JSON.stringify(settings),
      [INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE]: mutant?.activeMutant,
    },
    params: {
      testIds: mutant?.testFilter,
      maxFailures: request.disableBail ? undefined : 1,
      timeout: request.budget.testTimeout,
    },
  };
}
