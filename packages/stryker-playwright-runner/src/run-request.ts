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
  /** The Playwright config's failOnFlakyTests: a test that passes only on a retry fails the run. */
  readonly failOnFlakyTests: boolean;
  readonly coverageAnalysis: DryRunOptions['coverageAnalysis'];
  readonly budget: RunBudget;
}

export interface MutantRunRequest {
  readonly kind: 'mutant';
  readonly disableBail: boolean;
  readonly failOnFlakyTests: boolean;
  readonly activeMutant: string;
  /** Undefined runs every test. */
  readonly selection: TestSelection | undefined;
  readonly hitLimit: number | undefined;
  readonly budget: RunBudget;
}

export interface TestSelection {
  /** The test ids in Stryker's test filter. */
  readonly covering: readonly string[];
  /** The Playwright test ids to run: the covering tests and their serial groups. */
  readonly toRun: readonly string[];
}

export function dryRunRequest(
  { disableBail, coverageAnalysis }: DryRunOptions,
  { failOnFlakyTests }: { readonly failOnFlakyTests: boolean },
): DryRunRequest {
  return {
    kind: 'dry',
    disableBail,
    failOnFlakyTests,
    coverageAnalysis,
    budget: dryRunBudget,
  };
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
    readonly failOnFlakyTests: boolean;
  },
): MutantRunRequest {
  return {
    kind: 'mutant',
    disableBail,
    failOnFlakyTests: session.failOnFlakyTests,
    activeMutant: activeMutant.id,
    selection: testFilter && {
      covering: testFilter,
      toRun: withSerialGroups(testFilter, session.serialGroups),
    },
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
      testIds: mutant?.selection?.toRun,
      maxFailures: request.disableBail ? undefined : 1,
      timeout: request.budget.testTimeout,
    },
  };
}
