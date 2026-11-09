import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { dirname, join } from 'node:path';

import {
  lzPlaywrightMutators,
  type LzPlaywrightMutatorOptions,
} from '@layzee/stryker-playwright-mutators';
import type { Location, Mutant } from '@stryker-mutator/api/core';
import { MutantRunStatus, TestStatus } from '@stryker-mutator/api/test-runner';
import { Instrumenter } from '@stryker-mutator/instrumenter';

import { logger } from '../../support/doubles.ts';
import { type Session, startSession, transpile } from './session.ts';

export interface Row {
  readonly mutator: string;
  readonly original: string;
  readonly replacement: string;
  readonly killer: string;
  readonly bystander: string;
}

/**
 * Instruments `spec` with the Playwright mutators, writes it into `testDir` for `configFile` to run, and adds two
 * tests per row: the bystander test leaves the mutant alive, and the killer test kills it alone.
 */
export function playwrightMutatorRows(
  {
    spec,
    testDir,
    configFile,
    testCount,
    options,
  }: {
    readonly spec: string;
    readonly testDir: string;
    readonly configFile: string;
    readonly testCount: number;
    readonly options?: LzPlaywrightMutatorOptions;
  },
  rows: readonly Row[],
): void {
  const { log } = logger();
  const source = readFileSync(spec, 'utf8');
  const sourceLines = source.split('\n');
  let session: Session | undefined;
  let mutants: readonly Mutant[] = [];

  function textAt({ start, end }: Location): string {
    const last = end.line - start.line;

    return sourceLines
      .slice(start.line, end.line + 1)
      .map((line, i) =>
        line.slice(
          i === 0 ? start.column : 0,
          i === last ? end.column : undefined,
        ),
      )
      .join('\n');
  }

  function mutant({ mutator, original, replacement }: Row): Mutant {
    const found = mutants.filter(
      (m) =>
        m.mutatorName === mutator &&
        m.replacement === replacement &&
        textAt(m.location) === original,
    );
    assert.equal(
      found.length,
      1,
      `one ${mutator} mutant ${original} -> ${replacement}`,
    );

    const [first] = found;
    assert.ok(first);

    return first;
  }

  function started(): Session {
    assert.ok(session, 'the session started');

    return session;
  }

  function mutantRun(row: Row, title: string) {
    return started().mutantRun(mutant(row), {
      testFilter: [started().testId(title)],
    });
  }

  // The runner's init probes the instrumenter with a built-in mutator, which the install removes from this process.
  // So init lists the plain spec, and the instrumented one replaces it before the dry run.
  before(async () => {
    const compiled = join(testDir, 'mutated.spec.js');
    rmSync(testDir, { recursive: true, force: true });
    rmSync(join(dirname(configFile), 'test-results'), {
      recursive: true,
      force: true,
    });
    mkdirSync(testDir, { recursive: true });
    writeFileSync(compiled, transpile(source));

    session = await startSession(configFile, spec, log, async () => {
      await lzPlaywrightMutators(options);
      const result = await new Instrumenter(log).instrument(
        [{ name: spec, content: source, mutate: true }],
        { plugins: null, excludedMutations: [], ignorers: [] },
      );
      mutants = result.mutants;
      const [instrumented] = result.files;
      assert.ok(instrumented, 'the instrumented spec');
      writeFileSync(compiled, transpile(instrumented.content));
    });
  });

  after(async () => {
    await session?.dispose();
  });

  test('every test of the spec passes in the dry run', () => {
    const { tests } = started().dryRun;

    assert.equal(tests.length, testCount, JSON.stringify(tests));
    assert.ok(
      tests.every((t) => t.status === TestStatus.Success),
      JSON.stringify(tests),
    );
  });

  rows.forEach((row) => {
    const { mutator, original, replacement, killer, bystander } = row;
    const change = `${original} -> ${replacement === ';' ? 'removed' : replacement}`;

    test(`${mutator}: "${bystander}" does not run ${change}, so it survives`, async () => {
      const result = await mutantRun(row, bystander);

      assert.equal(
        result.status,
        MutantRunStatus.Survived,
        JSON.stringify(result),
      );
    });

    test(`${mutator}: "${killer}" kills ${change}`, async () => {
      const result = await mutantRun(row, killer);

      assert.equal(
        result.status,
        MutantRunStatus.Killed,
        JSON.stringify(result),
      );
      assert.deepEqual(result.killedBy, [started().testId(killer)]);
    });
  });
}
