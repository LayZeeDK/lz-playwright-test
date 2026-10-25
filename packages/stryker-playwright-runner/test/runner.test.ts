// Drives PlaywrightTestRunner directly against a fixture instrumented by Stryker's own instrumenter.
// Run: node --test packages/stryker-playwright-runner/test/runner.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { connect } from 'node:net';

import {
  INSTRUMENTER_CONSTANTS,
  type Mutant,
  type StrykerOptions,
} from '@stryker-mutator/api/core';
import type { Logger } from '@stryker-mutator/api/logging';
import {
  type CompleteDryRunResult,
  DryRunStatus,
  MutantRunStatus,
  type TestResult,
  TestStatus,
} from '@stryker-mutator/api/test-runner';
import { Instrumenter } from '@stryker-mutator/instrumenter';

import { PlaywrightTestRunner } from '../src/playwright-test-runner.ts';
import { RUN_SETTINGS } from '../src/protocol.ts';

const fixture = (file: string) =>
  fileURLToPath(new URL(`./fixture/${file}`, import.meta.url));
// RUNNER_TEST_LOG=1 prints the runner's log, with seconds since start.
const verbose = process.env.RUNNER_TEST_LOG !== undefined;
const start = Date.now();
const log = {
  ...Object.fromEntries(
    ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].map((level) => [
      level,
      (...args: unknown[]) => {
        if (verbose) {
          console.log(((Date.now() - start) / 1000).toFixed(1), level, ...args);
        }
      },
    ]),
  ),
  isDebugEnabled: () => verbose,
} as unknown as Logger;

let runner: PlaywrightTestRunner;
let mutants: readonly Mutant[];
let dryRun: CompleteDryRunResult;
let tests: TestResult[];

function mutant(mutatorName: string, replacement: string): Mutant {
  const found = mutants.find(
    (m) => m.mutatorName === mutatorName && m.replacement === replacement,
  );
  assert.ok(found, `mutant ${mutatorName} ${replacement} exists`);

  return found;
}

function testId(title: string): string {
  const found = tests.find((t) => t.name.endsWith(title));
  assert.ok(found, `test "${title}" exists`);

  return found.id;
}

function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: 'localhost', port });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function mutantRun(
  m: Mutant,
  { testFilter, hitLimit }: { testFilter?: string[]; hitLimit?: number } = {},
) {
  return runner.mutantRun({
    activeMutant: m,
    testFilter,
    hitLimit,
    // Kills and survivors end when their tests do; a wide budget keeps a loaded machine from turning them into timeouts.
    timeout: 60_000,
    disableBail: false,
    mutantActivation: 'runtime',
    reloadEnvironment: false,
    sandboxFileName: fixture('src/app.js'),
  });
}

before(async () => {
  const instrumenter = new Instrumenter(log);
  const result = await instrumenter.instrument(
    [
      {
        name: fixture('src/app.js'),
        content: readFileSync(fixture('src/app.js'), 'utf8'),
        mutate: true,
      },
    ],
    { plugins: null, excludedMutations: [], ignorers: [] },
  );
  mutants = result.mutants;
  writeFileSync(fixture('public/app.js'), result.files[0].content);
  rmSync(fixture('test-results'), { recursive: true, force: true });

  const options = {
    playwright: { configFile: fixture('playwright.config.ts') },
    timeoutMS: 10_000,
  };
  runner = new PlaywrightTestRunner(options as unknown as StrykerOptions, log);
  await runner.init();

  const dry = await runner.dryRun({
    timeout: 60_000,
    disableBail: false,
    coverageAnalysis: 'perTest',
  });
  assert.equal(dry.status, DryRunStatus.Complete, JSON.stringify(dry));
  dryRun = dry;
  tests = dryRun.tests;
});

let disposed = false;

after(async () => {
  if (!disposed) {
    await runner?.dispose();
  }
});

test('dry run completes with every test passing', () => {
  assert.equal(tests.length, 10);
  assert.ok(
    tests.every((t) => t.status === TestStatus.Success),
    JSON.stringify(tests),
  );
});

test('the hook stays out of worker threads that a test starts', () => {
  const probe = tests.find((t) =>
    t.name.endsWith(
      'a worker thread it starts does not install the Stryker hook',
    ),
  );

  assert.equal(probe?.status, TestStatus.Success, JSON.stringify(probe));
});

test('init finds the describe.serial groups', () => {
  const { serialGroups } = runner as unknown as {
    serialGroups: Map<string, string[]>;
  };

  assert.deepEqual(serialGroups.get(testId('second user of the shared page')), [
    testId('first user of the shared page'),
    testId('second user of the shared page'),
  ]);
  assert.equal(serialGroups.has(testId('shows the greeting')), false);
});

test('per-test coverage separates tests that reach different code', () => {
  const { perTest } = dryRun.mutantCoverage!;
  const greeting = perTest[testId('shows the greeting')];
  const counting = perTest[testId('counts to three')];
  const loopMutant = mutant('UpdateOperator', 'i--').id;
  const greetingMutant = mutant('StringLiteral', '""').id;

  assert.ok(
    greeting[greetingMutant],
    'the module-level greeting is covered by the test that loads the page',
  );
  assert.equal(
    greeting[loopMutant],
    undefined,
    'the greeting test never calls countTo',
  );
  assert.ok(counting[loopMutant], 'the counting test covers the loop');
});

test('a page shared from beforeAll reports its coverage as static', () => {
  const loopMutant = mutant('UpdateOperator', 'i--').id;

  assert.ok(
    dryRun.mutantCoverage!.static[loopMutant],
    'shared-page coverage lands in static',
  );
  assert.equal(
    dryRun.mutantCoverage!.perTest[testId('first user of the shared page')],
    undefined,
  );
});

test('coverage survives a navigation to a page without instrumented code', () => {
  const greetingMutant = mutant('StringLiteral', '""').id;
  const coverage =
    dryRun.mutantCoverage!.perTest[
      testId('keeps coverage across a navigation to a page without the app')
    ];

  assert.ok(coverage?.[greetingMutant]);
});

test('a page never closed before the worker closes the browser still reports coverage, as static', () => {
  const doubleMutant = mutant('ArithmeticOperator', 'n / 2').id;

  assert.ok(dryRun.mutantCoverage!.static[doubleMutant]);
});

test('a page the test closes still reports its coverage, for that test', () => {
  const halfMutant = mutant('ArithmeticOperator', 'n * 2').id;
  const coverage =
    dryRun.mutantCoverage!.perTest[
      testId('halves on a second page it closes before the test ends')
    ];

  assert.ok(coverage?.[halfMutant]);
});

test('reused contexts still get per-test coverage', () => {
  const { perTest } = dryRun.mutantCoverage!;
  const loopMutant = mutant('UpdateOperator', 'i--').id;

  assert.equal(
    perTest[testId('reused context, first test')]?.[loopMutant],
    undefined,
  );
  assert.ok(perTest[testId('reused context, second test')]?.[loopMutant]);
});

test('a runtime mutant is killed by the test that covers it', async () => {
  const result = await mutantRun(mutant('ArithmeticOperator', 'a - b'), {
    testFilter: [testId('shows the greeting')],
  });

  assert.equal(result.status, MutantRunStatus.Killed);
  assert.deepEqual(result.killedBy, [testId('shows the greeting')]);
});

test('a module-level (static) mutant is killed', async () => {
  const result = await mutantRun(mutant('StringLiteral', '""'), {
    testFilter: [testId('shows the greeting')],
  });

  assert.equal(result.status, MutantRunStatus.Killed);
});

test('a mutant the selected tests do not reach survives, and the next run starts clean', async () => {
  const survived = await mutantRun(mutant('ArithmeticOperator', 'a - b'), {
    testFilter: [testId('counts to three')],
  });
  const killed = await mutantRun(mutant('ArithmeticOperator', 'a - b'), {
    testFilter: [testId('shows the greeting')],
  });

  assert.equal(survived.status, MutantRunStatus.Survived);
  assert.equal(killed.status, MutantRunStatus.Killed);
});

test('a run whose selected tests no longer exist is an error, not a survivor', async () => {
  const result = await mutantRun(mutant('ArithmeticOperator', 'a - b'), {
    testFilter: ['no-such-test-id'],
  });

  assert.equal(result.status, MutantRunStatus.Error);
});

test('an infinite loop without a hit limit times out within its budget, and the next run is clean', async () => {
  const started = performance.now();
  const timedOut = await runner.mutantRun({
    activeMutant: mutant('UpdateOperator', 'i--'),
    testFilter: [testId('counts to three')],
    timeout: 8000,
    disableBail: false,
    mutantActivation: 'runtime',
    reloadEnvironment: false,
    sandboxFileName: fixture('src/app.js'),
  });
  // Past its budget, Stryker would kill and restart the worker, webServer and all.
  const elapsed = performance.now() - started;
  const killed = await mutantRun(mutant('ArithmeticOperator', 'a - b'), {
    testFilter: [testId('shows the greeting')],
  });

  assert.equal(
    timedOut.status,
    MutantRunStatus.Timeout,
    JSON.stringify(timedOut),
  );
  assert.ok(elapsed < 8000, `timed-out run took ${Math.round(elapsed)} ms`);
  assert.equal(killed.status, MutantRunStatus.Killed, JSON.stringify(killed));
});

test('a run leaves no run settings or active mutant behind in the environment', async () => {
  await mutantRun(mutant('ArithmeticOperator', 'a - b'), {
    testFilter: [testId('shows the greeting')],
  });

  assert.equal(process.env[RUN_SETTINGS], undefined);
  assert.equal(
    process.env[INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE],
    undefined,
  );
});

test('an infinite loop trips the hit limit and reports a timeout', async () => {
  const result = await mutantRun(mutant('UpdateOperator', 'i--'), {
    testFilter: [testId('counts to three')],
    hitLimit: 1000,
  });

  assert.equal(result.status, MutantRunStatus.Timeout);
  assert.match(
    result.status === MutantRunStatus.Timeout ? (result.reason ?? '') : '',
    /Hit limit reached/,
  );
});

test('a webServer that dies between runs is restarted instead of failing every test', async () => {
  await fetch('http://localhost:4321/__exit').catch(() => {});
  assert.equal(await listening(4321), false, 'the fixture server stopped');

  const survived = await mutantRun(mutant('ArithmeticOperator', 'a - b'), {
    testFilter: [testId('counts to three')],
  });
  const killed = await mutantRun(mutant('ArithmeticOperator', 'a - b'), {
    testFilter: [testId('shows the greeting')],
  });

  assert.equal(survived.status, MutantRunStatus.Survived);
  assert.equal(killed.status, MutantRunStatus.Killed);
});

test('no Playwright artifacts are written next to the config', () => {
  assert.equal(existsSync(fixture('test-results')), false);
});

test('dispose removes the temp directory the runner kept its output and runs in', async () => {
  const { rootDir } = runner as unknown as { rootDir: string };
  assert.ok(
    existsSync(rootDir),
    'the temp directory exists while the runner is up',
  );

  await runner.dispose();
  disposed = true;

  assert.equal(existsSync(rootDir), false);
});
