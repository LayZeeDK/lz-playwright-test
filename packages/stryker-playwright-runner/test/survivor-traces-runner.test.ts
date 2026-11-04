// The runner's survivorTraces handling against the fake Playwright install in support/fake-playwright.ts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import { MutantRunStatus } from '@stryker-mutator/api/test-runner';

import { fieldOf } from '../src/is-record.ts';
import { projectRootEnv, tracesDirEnv } from '../src/survivor-traces.ts';
import {
  addAttempt,
  fakeTestCase,
  finishedTest,
  mutantRunOptions,
} from './support/doubles.ts';
import {
  fakePlaywright,
  passAll,
  stubEnv,
  writeSnapshots,
} from './support/fake-playwright.ts';

type RunTests = NonNullable<
  NonNullable<Parameters<typeof fakePlaywright>[1]>['runTests']
>;

async function tracedRunner(
  t: TestContext,
  {
    runTests,
    traceScreenshots,
  }: {
    runTests?: (fakeDir: string) => RunTests;
    traceScreenshots?: boolean;
  } = {},
) {
  const fake = fakePlaywright(
    t,
    runTests ? { runTests: async (run) => runTests(fake.dir)(run) } : {},
  );
  const tracesDir = path.join(fake.dir, 'traces');
  fs.mkdirSync(tracesDir);
  stubEnv(t, {
    [tracesDirEnv]: tracesDir,
    [projectRootEnv]: process.cwd(),
  });
  const { shell, lines } = fake.runner({
    lzPlaywright: {
      survivorTraces: 'traces',
      ...(traceScreenshots === undefined ? {} : { traceScreenshots }),
    },
  });
  await shell.init();

  return { fake, shell, lines, tracesDir };
}

function survivingWith(trace: string): RunTests {
  return async (run) => {
    run.reporter.onTestEnd(
      addAttempt(fakeTestCase('b'), 'expected', 'passed', [
        { name: 'trace', path: trace },
      ]),
    );

    return passAll(run);
  };
}

for (const traceScreenshots of [false, true]) {
  test(`with traceScreenshots ${String(traceScreenshots)}, every run records a trace with snapshots${traceScreenshots ? ' and screenshots' : ''}`, async (t) => {
    const { fake } = await tracedRunner(t, { traceScreenshots });

    const [, , overrides] = fake.calls[0] ?? [];
    assert.deepEqual(fieldOf(overrides, 'use'), {
      screenshot: 'off',
      trace: { mode: 'on', screenshots: traceScreenshots, snapshots: true },
      video: 'off',
    });
  });
}

test('without traceScreenshots, the traces have no screenshots', async (t) => {
  const { fake } = await tracedRunner(t);

  const [, , overrides] = fake.calls[0] ?? [];
  assert.deepEqual(fieldOf(fieldOf(overrides, 'use'), 'trace'), {
    mode: 'on',
    screenshots: false,
    snapshots: true,
  });
});

test("a surviving mutant's traces are copied to its folder", async (t) => {
  const { fake, shell, lines, tracesDir } = await tracedRunner(t, {
    runTests: (fakeDir) => survivingWith(path.join(fakeDir, 'trace.zip')),
  });
  fs.writeFileSync(path.join(fake.dir, 'trace.zip'), 'trace');

  const result = await shell.mutantRun(mutantRunOptions());

  assert.equal(result.status, MutantRunStatus.Survived);
  const [folder, ...others] = fs.readdirSync(tracesDir);
  assert.ok(folder);
  assert.deepEqual(others, []);
  const dir = path.join(tracesDir, folder);
  assert.equal(fs.readFileSync(path.join(dir, 'b-0.zip'), 'utf8'), 'trace');
  assert.deepEqual(lines.at(-1), ['debug', `Mutant 7: traces in ${dir}`]);
});

test('a trace that cannot be copied is a warning, and the mutant still survives', async (t) => {
  const { shell, lines } = await tracedRunner(t, {
    runTests: (fakeDir) => survivingWith(path.join(fakeDir, 'missing.zip')),
  });

  const result = await shell.mutantRun(mutantRunOptions());

  assert.equal(result.status, MutantRunStatus.Survived);
  const [level, message] = lines.at(-1) ?? [];
  assert.equal(level, 'warn');
  assert.match(
    message ?? '',
    /^Mutant 7: could not copy its traces: Error: ENOENT/,
  );
});

test('a killed mutant leaves the traces folder empty', async (t) => {
  const { shell, tracesDir } = await tracedRunner(t, {
    runTests: () => async (run) => {
      run.reporter.onTestEnd(finishedTest('a', 'failed'));
      writeSnapshots(run, [
        {
          mutantCoverage: { static: {}, perTest: { a: { '7': 1 } } },
          outlivedItsTest: false,
        },
      ]);

      return 'failed';
    },
  });

  const result = await shell.mutantRun(mutantRunOptions());

  assert.equal(result.status, MutantRunStatus.Killed);
  assert.deepEqual(fs.readdirSync(tracesDir), []);
});
