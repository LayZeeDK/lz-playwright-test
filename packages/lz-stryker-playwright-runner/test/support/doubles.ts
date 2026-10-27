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

import type { RunnerStrykerOptions } from '../../src/options.ts';
import { setEnv } from '../../src/playwright-test-runner.ts';
import {
  LzStrykerCollectingReporter,
  type ReportedTest,
} from '../../src/reporter.ts';
import type { DryRunRequest, MutantRunRequest } from '../../src/run-request.ts';
import type { RunOutput } from '../../src/run-result.ts';
import { DRY_RUN_BUDGET } from '../../src/timeouts.ts';

export type Outcome = ReturnType<TestCase['outcome']>;

/** A temp dir holding `files` by relative path, removed after the test. */
export function tempTree(
  t: TestContext,
  prefix: string,
  files: Readonly<Record<string, string>>,
): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  Object.entries(files).forEach(([file, content]) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  });

  return dir;
}

/** Sets `values` in process.env, an undefined value unsetting its variable, and restores them after the test. */
export function stubEnv(
  t: TestContext,
  values: Readonly<Record<string, string | undefined>>,
): void {
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]]),
  );
  t.after(() => setEnv(previous));
  setEnv(values);
}

/** An Error with a Node.js system error `code`, such as `ENOENT`. */
export function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

// Coverage maps have no prototype, which deepEqual tells apart from object literals; the JSON copy compares their content.
export function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

/** A test with no attempts yet. */
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

/** The test with one more attempt, as Playwright appends each attempt of a test to its TestCase. */
export function addAttempt(
  testCase: ReportedTest,
  outcome: Outcome,
  status: TestResult['status'],
): ReportedTest {
  return {
    ...testCase,
    results: [
      ...testCase.results,
      {
        status,
        duration: 7,
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

/** The Stryker options the runner reads, with the given fields and a 10 s timeoutMS. */
export function strykerOptions(
  options: Partial<RunnerStrykerOptions>,
): RunnerStrykerOptions {
  return { timeoutMS: 10_000, ...options };
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

/** A passed run with the hook installed, an empty reporter and no snapshots, with the given fields. */
export function runOutput(output: Partial<RunOutput> = {}): RunOutput {
  return {
    status: 'passed',
    reporter: new LzStrykerCollectingReporter(),
    snapshots: [],
    hookInstalled: true,
    installErrors: [],
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
