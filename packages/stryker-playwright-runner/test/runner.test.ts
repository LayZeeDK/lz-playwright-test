// Drives PlaywrightTestRunner directly against a fixture instrumented by Stryker's own instrumenter.
// Run: node --test packages/stryker-playwright-runner/test/runner.test.ts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { Mutant, StrykerOptions } from '@stryker-mutator/api/core';
import type { Logger } from '@stryker-mutator/api/logging';
import {
  type CompleteDryRunResult,
  DryRunStatus,
  MutantRunStatus,
  type TestResult,
  TestStatus,
} from '@stryker-mutator/api/test-runner';
import { Instrumenter } from '@stryker-mutator/instrumenter';
import ts from 'typescript';

import {
  acceptsConnections,
  PlaywrightTestRunner,
} from '../src/playwright-test-runner.ts';
import { STOP_HEADROOM_MS } from '../src/timeouts.ts';

// The runner's private state, which one test checks directly.
function session() {
  return (
    runner as unknown as {
      session: { serialGroups: Map<string, string[]> };
    }
  ).session;
}

// A pid that ran and exited, so no process owns it now.
const deadPid = spawnSync(process.execPath, ['-e', '']).pid;
const deadRoot = path.join(tmpdir(), `stryker-playwright-${deadPid}-left`);
const oldSchemeRoot = path.join(tmpdir(), 'stryker-pw-0-runner-test');

const fixture = (file: string) =>
  fileURLToPath(new URL(`./fixture/${file}`, import.meta.url));
// RUNNER_TEST_LOG=1 prints the runner's log, with seconds since start.
const verbose = process.env.RUNNER_TEST_LOG !== undefined;
const start = Date.now();
// Every line the runner logged, at any level.
const logged: string[] = [];
const log = {
  ...Object.fromEntries(
    ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].map((level) => [
      level,
      (...args: unknown[]) => {
        logged.push(args.join(' '));

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

function mutant(
  mutatorName: string,
  replacement: string,
  file?: string,
): Mutant {
  const found = mutants.find(
    (m) =>
      m.mutatorName === mutatorName &&
      m.replacement === replacement &&
      (file === undefined || m.fileName === fixture(file)),
  );
  assert.ok(found, `mutant ${mutatorName} ${replacement} exists`);

  return found;
}

function testId(title: string): string {
  const found = tests.find((t) => t.name.endsWith(title));
  assert.ok(found, `test "${title}" exists`);

  return found.id;
}

// The ids of the fixture's mutants in the bodies of the lib.ts functions `called`, plus, with
// `pageLoad`, those in app.ts, all of which runs when a page loads the app. Lines are 0-based, as in
// Stryker's mutant locations.
function mutantsReached(called: string[], pageLoad = true): string[] {
  const lib = readFileSync(fixture('src/lib.ts'), 'utf8').split('\n');
  const lines = (name: string) => {
    const first = lib.findIndex((line) =>
      line.startsWith(`export function ${name}(`),
    );

    return { first, last: lib.indexOf('}', first) };
  };
  const reached = called.map(lines);

  return mutants
    .filter(({ fileName, location: { start } }) =>
      fileName === fixture('src/app.ts')
        ? pageLoad
        : fileName === fixture('src/lib.ts') &&
          reached.some(
            ({ first, last }) => start.line >= first && start.line <= last,
          ),
    )
    .map(({ id }) => id)
    .sort();
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
    sandboxFileName: fixture('src/app.ts'),
  });
}

// The browser and the Playwright worker load the instrumented fixture as JavaScript.
function transpile(code: string): string {
  return ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

before(async () => {
  const instrumenter = new Instrumenter(log);
  const result = await instrumenter.instrument(
    ['app.ts', 'lib.ts', 'node-only.ts'].map((file) => ({
      name: fixture(`src/${file}`),
      content: readFileSync(fixture(`src/${file}`), 'utf8'),
      mutate: true,
    })),
    { plugins: null, excludedMutations: [], ignorers: [] },
  );
  mutants = result.mutants;

  for (const { name, content } of result.files) {
    writeFileSync(
      fixture(`public/${path.basename(name, '.ts')}.js`),
      transpile(content),
    );
  }

  rmSync(fixture('test-results'), { recursive: true, force: true });
  mkdirSync(deadRoot, { recursive: true });
  mkdirSync(oldSchemeRoot, { recursive: true });

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
  rmSync(deadRoot, { recursive: true, force: true });
  rmSync(oldSchemeRoot, { recursive: true, force: true });

  if (!disposed) {
    await runner?.dispose();
  }
});

test('init removes the temp roots of dead runners and leaves those of the old scheme', () => {
  assert.equal(existsSync(deadRoot), false);
  assert.equal(existsSync(oldSchemeRoot), true);
});

test('dry run completes with every test passing', () => {
  assert.equal(tests.length, 13);
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
  const { serialGroups } = session();

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

test('per-test coverage holds exactly the mutants each test reaches, with their hit counts', () => {
  const { perTest } = dryRun.mutantCoverage!;
  const greeting = perTest[testId('shows the greeting')];
  const counting = perTest[testId('counts to three')];

  assert.deepEqual(Object.keys(greeting).sort(), mutantsReached(['add']));
  assert.deepEqual(
    Object.keys(counting).sort(),
    mutantsReached(['add', 'countTo']),
  );
  assert.equal(counting[mutant('UpdateOperator', 'i--').id], 3);
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

test('app code a test runs in the Playwright worker gets per-test coverage', () => {
  const { perTest } = dryRun.mutantCoverage!;

  assert.deepEqual(
    Object.keys(perTest[testId('adds in the worker')] ?? {}).sort(),
    mutantsReached(['add'], false),
  );
});

test('app code imported into the Playwright worker, outside any test, is static coverage', () => {
  const { perTest, static: atImport } = dryRun.mutantCoverage!;
  const importMutant = mutant('StringLiteral', '""', 'src/node-only.ts').id;

  assert.ok(atImport[importMutant], 'the import counts as static');
  assert.deepEqual(
    Object.keys(perTest).filter((id) => perTest[id]?.[importMutant]),
    [],
  );
});

test('a mutant in app code that only the worker runs is killed by the test the dry run says covers it', async () => {
  const workerMutant = mutant('ArithmeticOperator', 'a - b');
  const worker = testId('adds in the worker');

  assert.ok(dryRun.mutantCoverage!.perTest[worker]?.[workerMutant.id]);

  const result = await mutantRun(workerMutant, { testFilter: [worker] });

  assert.equal(result.status, MutantRunStatus.Killed, JSON.stringify(result));
  assert.deepEqual(result.killedBy, [worker]);
});

test('an infinite loop in app code that the worker runs trips the hit limit', async () => {
  const result = await mutantRun(mutant('UpdateOperator', 'i--'), {
    testFilter: [testId('counts in the worker')],
    hitLimit: 1000,
  });

  assert.equal(result.status, MutantRunStatus.Timeout, JSON.stringify(result));
  assert.match(
    result.status === MutantRunStatus.Timeout ? (result.reason ?? '') : '',
    /Hit limit reached/,
  );
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
    sandboxFileName: fixture('src/app.ts'),
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

test('a loop in a test that raised its own timeout stops at the deadline, without a new init', async (t) => {
  const serverPid = () =>
    fetch('http://localhost:4321/__pid').then((response) => response.text());
  const before = await serverPid();
  const loggedBefore = logged.length;
  const started = performance.now();
  const timedOut = await runner.mutantRun({
    activeMutant: mutant('UpdateOperator', 'i--'),
    testFilter: [testId('counts to three under a raised timeout')],
    timeout: 8000,
    disableBail: false,
    mutantActivation: 'runtime',
    reloadEnvironment: false,
    sandboxFileName: fixture('src/app.ts'),
  });
  const elapsed = performance.now() - started;
  const killed = await mutantRun(mutant('ArithmeticOperator', 'a - b'), {
    testFilter: [testId('shows the greeting')],
  });

  assert.equal(
    timedOut.status,
    MutantRunStatus.Timeout,
    JSON.stringify(timedOut),
  );
  assert.match(
    timedOut.status === MutantRunStatus.Timeout ? (timedOut.reason ?? '') : '',
    /deadline/,
  );
  // The runner decides when the stop starts; how long Playwright's teardown then takes is not its
  // to decide (2.1 s in 8 of 9 measured runs, 6.5 s once), so that part is reported, not asserted.
  const [, stopTook] =
    logged
      .slice(loggedBefore)
      .map((line) => /^deadline stop took (\d+) ms$/.exec(line))
      .find((match) => match !== null) ?? [];
  const stoppedAfter = elapsed - Number(stopTook);
  const deadlineMs = 8000 - STOP_HEADROOM_MS;
  t.diagnostic(
    `stop started after ${Math.round(stoppedAfter)} ms, took ${stopTook} ms`,
  );
  assert.ok(stopTook !== undefined, 'the runner logged the stop');
  assert.ok(
    stoppedAfter >= deadlineMs - 1 && stoppedAfter < deadlineMs + 1000,
    `stop started after ${Math.round(stoppedAfter)} ms, deadline ${deadlineMs} ms`,
  );
  assert.equal(killed.status, MutantRunStatus.Killed, JSON.stringify(killed));
  assert.equal(await serverPid(), before, 'the same webServer still serves');
});

test('a webServer that dies between runs is restarted instead of failing every test', async () => {
  await fetch('http://localhost:4321/__exit').catch(() => undefined);
  assert.equal(
    await acceptsConnections(4321),
    false,
    'the fixture server stopped',
  );

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
  const ownRoots = () =>
    readdirSync(tmpdir()).filter((name) =>
      name.startsWith(`stryker-playwright-${process.pid}-`),
    );
  assert.equal(
    ownRoots().length,
    1,
    'the temp directory exists while the runner is up',
  );

  await runner.dispose();
  disposed = true;

  assert.deepEqual(ownRoots(), []);
});
