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

import { LzStrykerPlaywrightTestRunner } from '../../../src/playwright-test-runner.ts';

/** A runner started on a fixture, with its completed per-test dry run and that run's coverage. */
export interface Session {
  readonly dryRun: CompleteDryRunResult;
  readonly mutantCoverage: MutantCoverage;
  testId(title: string): string;
  mutantRun(
    m: Mutant,
    options?: Partial<
      Pick<MutantRunOptions, 'testFilter' | 'hitLimit' | 'timeout'>
    >,
  ): Promise<MutantRunResult>;
  dispose(): Promise<void>;
}

// The browser and the Playwright worker load the instrumented fixture as JavaScript.
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

/** Inits a runner on a fixture's Playwright config and asserts that its dry run completes and reports coverage. */
export async function startSession(
  configFile: string,
  sandboxFileName: string,
  log: Logger,
): Promise<Session> {
  const runner = new LzStrykerPlaywrightTestRunner(
    { lzStrykerPlaywright: { configFile }, timeoutMS: 10_000 },
    log,
  );
  await runner.init();

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
        // Kills and survivors end when their tests do; a wide budget keeps a loaded machine from turning them into timeouts.
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
