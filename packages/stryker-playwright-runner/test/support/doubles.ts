import type { TestCase, TestResult } from '@playwright/test/reporter';
import type { StrykerOptions } from '@stryker-mutator/api/core';
import type { Logger } from '@stryker-mutator/api/logging';
import type {
  DryRunOptions,
  MutantRunOptions,
} from '@stryker-mutator/api/test-runner';

import type { DryRunRequest, MutantRunRequest } from '../../src/run-request.ts';
import { DRY_RUN_BUDGET } from '../../src/timeouts.ts';

export type Outcome = ReturnType<TestCase['outcome']>;

/**
 * A TestCase with no attempts yet. The runner reads only these members; a complete TestCase would need
 * a Suite and a project, so this is the one cast for it.
 */
export function fakeTestCase(
  id: string,
  {
    expectedStatus = 'passed',
    parent = { _parallelMode: 'default' },
  }: { expectedStatus?: TestCase['expectedStatus']; parent?: object } = {},
): TestCase {
  return {
    id,
    expectedStatus,
    results: [],
    titlePath: () => ['', 'e2e', 'app.spec.ts', id],
    location: { file: 'app.spec.ts', line: 3, column: 5 },
    outcome: (): Outcome => 'expected',
    parent,
  } as unknown as TestCase;
}

/** Appends an attempt, as Playwright appends each attempt of a test to the same TestCase. */
export function addAttempt(
  testCase: TestCase,
  outcome: Outcome,
  status: TestResult['status'],
): void {
  // A TestResult also carries stdout, steps and attachments, which the runner never reads.
  testCase.results.push({
    status,
    duration: 7,
    error:
      status === 'passed' ? undefined : { message: `${testCase.id} ${status}` },
  } as unknown as TestResult);
  testCase.outcome = () => outcome;
}

export function finishedTest(
  id: string,
  status: TestResult['status'],
  outcome: Outcome = status === 'passed' ? 'expected' : 'unexpected',
): TestCase {
  const testCase = fakeTestCase(id);
  addAttempt(testCase, outcome, status);

  return testCase;
}

export function logger() {
  const lines: [string, string][] = [];
  const record = (level: string) => (message: string) => {
    lines.push([level, message]);
  };
  const log: Logger = {
    isTraceEnabled: () => false,
    isDebugEnabled: () => false,
    isInfoEnabled: () => false,
    isWarnEnabled: () => false,
    isErrorEnabled: () => false,
    isFatalEnabled: () => false,
    trace: record('trace'),
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    fatal: record('fatal'),
  };

  return { log, lines };
}

/**
 * Stryker options with the given fields and a 10 s timeoutMS. StrykerOptions has many required fields
 * that the runner never reads, so this is the one cast for it.
 */
export function strykerOptions(options: object): StrykerOptions {
  return { timeoutMS: 10_000, ...options } as unknown as StrykerOptions;
}

export function dryRequest(
  request: Partial<DryRunRequest> = {},
): DryRunRequest {
  return {
    kind: 'dry',
    disableBail: true,
    coverageAnalysis: 'perTest',
    budget: DRY_RUN_BUDGET,
    ...request,
  };
}

export function mutantRequest(
  request: Partial<MutantRunRequest> = {},
): MutantRunRequest {
  return {
    kind: 'mutant',
    disableBail: true,
    activeMutant: '1',
    testFilter: undefined,
    hitLimit: undefined,
    budget: DRY_RUN_BUDGET,
    ...request,
  };
}

export function dryRunOptions(
  options: Partial<DryRunOptions> = {},
): DryRunOptions {
  return {
    timeout: 10_000,
    disableBail: false,
    coverageAnalysis: 'perTest',
    ...options,
  };
}

export function mutantRunOptions(
  options: Partial<MutantRunOptions> = {},
): MutantRunOptions {
  return {
    timeout: 10_000,
    disableBail: false,
    activeMutant: {
      id: '7',
      fileName: 'app.ts',
      mutatorName: 'StringLiteral',
      replacement: '""',
      location: {
        start: { line: 1, column: 0 },
        end: { line: 1, column: 4 },
      },
    },
    sandboxFileName: 'app.ts',
    mutantActivation: 'static',
    reloadEnvironment: true,
    ...options,
  };
}
