import assert from 'node:assert/strict';

import type { Mutant, MutantCoverage } from '@stryker-mutator/api/core';
import type { Logger } from '@stryker-mutator/api/logging';
import {
  type CompleteDryRunResult,
  DryRunStatus,
  type MutantRunOptions,
  type MutantRunResult,
} from '@stryker-mutator/api/test-runner';
import ts from 'typescript';

import { LzPlaywrightTestRunner } from '../../../src/lz-playwright-test-runner.ts';

export interface Session {
  readonly dryRun: CompleteDryRunResult;
  readonly mutantCoverage: MutantCoverage;
  testId(title: string): string;
  mutantRun(
    m: Mutant,
    options?: Partial<
      Pick<
        MutantRunOptions,
        | 'testFilter'
        | 'hitLimit'
        | 'timeout'
        | 'mutantActivation'
        | 'reloadEnvironment'
      >
    >,
  ): Promise<MutantRunResult>;
  dispose(): Promise<void>;
}

export function transpile(
  code: string,
  compilerOptions: ts.CompilerOptions = {},
): string {
  return ts.transpileModule(code, {
    compilerOptions: {
      ...compilerOptions,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

export async function startSession(
  configFile: string,
  sandboxFileName: string,
  log: Logger,
  afterInit?: () => Promise<void>,
): Promise<Session> {
  const runner = new LzPlaywrightTestRunner(
    { lzPlaywright: { configFile }, timeoutMS: 10_000 },
    log,
  );
  await runner.init();
  await afterInit?.();

  const dryRun = await runner.dryRun({
    timeout: 60_000,
    disableBail: false,
    coverageAnalysis: 'perTest',
  });
  assert.equal(dryRun.status, DryRunStatus.Complete, JSON.stringify(dryRun));
  const { mutantCoverage } = dryRun;
  assert.ok(mutantCoverage, 'the dry run reports coverage');

  return {
    dryRun,
    mutantCoverage,
    testId(title) {
      const found = dryRun.tests.find((t) => t.name.endsWith(title));
      assert.ok(found, `test "${title}" exists`);

      return found.id;
    },
    mutantRun(m, options = {}) {
      return runner.mutantRun({
        activeMutant: m,
        // A wide budget keeps a loaded machine from turning kills and survivors into timeouts.
        timeout: 60_000,
        disableBail: false,
        mutantActivation: 'runtime',
        reloadEnvironment: false,
        sandboxFileName,
        ...options,
      });
    },
    dispose() {
      return runner.dispose();
    },
  };
}
