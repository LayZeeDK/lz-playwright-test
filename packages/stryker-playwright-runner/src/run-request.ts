import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';
import type {
  DryRunOptions,
  MutantRunOptions,
} from '@stryker-mutator/api/test-runner';

import type { RunTestsParams } from './playwright-internals.ts';
import { runSettingsEnv, type RunSettings } from './protocol.ts';
import { type SerialGroups, withSerialGroups } from './serial-groups.ts';
import type { ServerControl } from './server-protocol.ts';
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
  readonly mutantActivation: MutantRunOptions['mutantActivation'];
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

export function dryRunRequest({
  disableBail,
  coverageAnalysis,
}: DryRunOptions): DryRunRequest {
  return { kind: 'dry', disableBail, coverageAnalysis, budget: dryRunBudget };
}

export function mutantRunRequest(
  {
    activeMutant,
    mutantActivation,
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
    mutantActivation,
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
  readonly control: ServerControl;
}

export function runPlan(
  request: RunRequest,
  outDir: string,
  testIdHosts?: readonly string[],
  issuedTestIds?: readonly string[],
): RunPlan {
  const mutant = request.kind === 'mutant' ? request : undefined;
  const perTest =
    request.kind === 'dry' && request.coverageAnalysis === 'perTest';
  const settings: RunSettings = {
    outDir,
    perTest,
    hitLimit: mutant?.hitLimit,
    testIdHosts: perTest ? testIdHosts : undefined,
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
    control: {
      outDir,
      perTest,
      activeMutant: mutant?.activeMutant,
      hitLimit: mutant?.hitLimit,
      ...(perTest && issuedTestIds !== undefined ? { issuedTestIds } : {}),
      ...(perTest && testIdHosts !== undefined ? { testIdHosts } : {}),
    },
  };
}
