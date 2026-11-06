import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';

import type { TestCase, TestResult } from '@playwright/test/reporter';
import type { Logger } from '@stryker-mutator/api/logging';
import type {
  DryRunOptions,
  MutantRunOptions,
} from '@stryker-mutator/api/test-runner';

import type { LzPlaywrightRunnerOptionsWithStrykerOptions } from '../../src/lz-playwright-runner-options-with-stryker-options.ts';
import {
  LzPlaywrightCollectingReporter,
  type ReportedAttempt,
  type ReportedTest,
} from '../../src/reporter.ts';
import type {
  DryRunRequest,
  MutantRunRequest,
  TestSelection,
} from '../../src/run-request.ts';
import type { RunOutput } from '../../src/run-result.ts';
import { dryRunBudget } from '../../src/timeouts.ts';

export type Outcome = ReturnType<TestCase['outcome']>;

export function tempTree(
  t: TestContext,
  prefix: string,
  files: Readonly<Record<string, string>> = {},
): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  Object.entries(files).forEach(([file, content]) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  });

  return dir;
}

export function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

export function withoutPrototypes(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

export function fakeTestCase(
  id: string,
  {
    expectedStatus = 'passed',
    parent = { _parallelMode: 'default' },
  }: { expectedStatus?: TestCase['expectedStatus']; parent?: object } = {},
): ReportedTest {
  return {
    id,
    expectedStatus,
    results: [],
    titlePath: () => ['', 'e2e', 'app.spec.ts', id],
    location: { file: 'app.spec.ts', line: 3, column: 5 },
    outcome: (): Outcome => 'expected',
    parent,
  };
}

export function addAttempt(
  testCase: ReportedTest,
  outcome: Outcome,
  status: TestResult['status'],
  attachments: ReportedAttempt['attachments'] = [],
): ReportedTest {
  return {
    ...testCase,
    results: [
      ...testCase.results,
      {
        status,
        duration: 7,
        attachments,
        error:
          status === 'passed'
            ? undefined
            : { message: `${testCase.id} ${status}` },
      },
    ],
    outcome: () => outcome,
  };
}

export function finishedTest(
  id: string,
  status: TestResult['status'],
  outcome: Outcome = status === 'passed' ? 'expected' : 'unexpected',
): ReportedTest {
  return addAttempt(fakeTestCase(id), outcome, status);
}

export function logger({
  debug = false,
  onLine,
}: {
  debug?: boolean;
  onLine?: ((level: string, ...args: unknown[]) => void) | undefined;
} = {}) {
  const lines: [string, string][] = [];
  const record =
    (level: string) =>
    (message: string, ...args: unknown[]) => {
      lines.push([level, message]);
      onLine?.(level, message, ...args);
    };
  const log: Logger = {
    isTraceEnabled: () => false,
    isDebugEnabled: () => debug,
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

export function strykerOptions(
  options: Partial<LzPlaywrightRunnerOptionsWithStrykerOptions>,
): LzPlaywrightRunnerOptionsWithStrykerOptions {
  return { timeoutMS: 10_000, ...options };
}

export function dryRequest(
  request: Partial<DryRunRequest> = {},
): DryRunRequest {
  return {
    kind: 'dry',
    disableBail: true,
    coverageAnalysis: 'perTest',
    budget: dryRunBudget,
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
    mutantActivation: 'runtime',
    selection: undefined,
    hitLimit: undefined,
    budget: dryRunBudget,
    ...request,
  };
}

/** A selection with no serial group to widen it. */
export function selected(ids: readonly string[]): TestSelection {
  return { covering: ids, toRun: ids };
}

export function runOutput(output: Partial<RunOutput> = {}): RunOutput {
  return {
    status: 'passed',
    reporter: new LzPlaywrightCollectingReporter(),
    snapshots: [],
    hookInstalled: true,
    installErrors: [],
    serverMutants: [],
    ...output,
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
