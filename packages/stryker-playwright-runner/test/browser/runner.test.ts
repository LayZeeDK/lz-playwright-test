// Drives LzStrykerPlaywrightTestRunner directly against a fixture instrumented by Stryker's own instrumenter.
// Run: npx nx run @layzee/stryker-playwright-runner:test-browser
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

import type { CoverageData, Mutant } from '@stryker-mutator/api/core';
import {
  type MutantRunResult,
  MutantRunStatus,
  TestStatus,
} from '@stryker-mutator/api/test-runner';
import { Instrumenter } from '@stryker-mutator/instrumenter';

import { acceptsConnections } from '../../src/playwright-test-runner.ts';
import { namespaceToken, ownerFile } from '../../src/temp-root.ts';
import { stopHeadroomMs } from '../../src/timeouts.ts';
import { logger } from '../support/doubles.ts';
import { type Session, startSession, transpile } from './support/session.ts';

// A pid that ran and exited, so no process owns it now.
const deadPid = spawnSync(process.execPath, ['-e', '']).pid;
const deadRoot = path.join(tmpdir(), `lz-stryker-playwright-${deadPid}-left00`);
const oldSchemeRoot = path.join(tmpdir(), 'stryker-pw-0-runner-test');

const fixture = (file: string) =>
  fileURLToPath(new URL(`./fixture/${file}`, import.meta.url));
// RUNNER_TEST_LOG=1 prints the runner's log, with seconds since start.
const verbose = process.env['RUNNER_TEST_LOG'] !== undefined;
const start = Date.now();
// Every line the runner logged, at any level.
const { log, lines: logged } = logger({
  debug: verbose,
  onLine: verbose
    ? (level, ...args) =>
        console.log(((Date.now() - start) / 1000).toFixed(1), level, ...args)
    : undefined,
});

/** How long a deadline stop logged since `from` took, or undefined when the deadline never fired. */
function deadlineStopTook(from: number): number | undefined {
  const [, took] =
    logged
      .slice(from)
      .map(([, line]) => /^deadline stop took (\d+) ms$/.exec(line))
      .find((match) => match !== null) ?? [];

  return took === undefined ? undefined : Number(took);
}

let session: Session;
let mutants: readonly Mutant[];

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
  return session.testId(title);
}

function perTestCoverage(title: string): CoverageData {
  const found = session.mutantCoverage.perTest[testId(title)];
  assert.ok(found, `test "${title}" has per-test coverage`);

  return found;
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

function runKnownKill(): Promise<MutantRunResult> {
  return session.mutantRun(mutant('ArithmeticOperator', 'a - b'), {
    testFilter: [testId('shows the greeting')],
  });
}

const loopRunTimeout = 8000;
const deadlineMs = loopRunTimeout - stopHeadroomMs;

async function timedLoopRun(title: string) {
  const loggedBefore = logged.length;
  const started = performance.now();
  const timedOut = await session.mutantRun(mutant('UpdateOperator', 'i--'), {
    testFilter: [testId(title)],
    timeout: loopRunTimeout,
  });
  // Past its budget, Stryker would kill and restart the worker, webServer and all.
  const elapsed = performance.now() - started;
  const killed = await runKnownKill();

  return {
    timedOut,
    elapsed,
    stopTook: deadlineStopTook(loggedBefore),
    killed,
  };
}

function assertTimedOut(result: MutantRunResult, reason: RegExp): void {
  assert.equal(result.status, MutantRunStatus.Timeout, JSON.stringify(result));
  assert.match(result.reason ?? '', reason);
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

  result.files.forEach(({ name, content }) => {
    writeFileSync(
      fixture(`public/${path.basename(name, '.ts')}.js`),
      transpile(content),
    );
  });

  rmSync(fixture('test-results'), { recursive: true, force: true });
  mkdirSync(deadRoot, { recursive: true });
  writeFileSync(path.join(deadRoot, ownerFile), namespaceToken());
  mkdirSync(oldSchemeRoot, { recursive: true });

  session = await startSession(
    fixture('playwright.config.ts'),
    fixture('src/app.ts'),
    log,
  );
});

let disposed = false;

after(async () => {
  rmSync(deadRoot, { recursive: true, force: true });
  rmSync(oldSchemeRoot, { recursive: true, force: true });

  if (!disposed) {
    await session?.dispose();
  }
});

test('init removes the temp roots of dead runners and leaves those of the old scheme', () => {
  assert.equal(existsSync(deadRoot), false);
  assert.equal(existsSync(oldSchemeRoot), true);
});

test('dry run completes with every test passing', () => {
  const { tests } = session.dryRun;

  assert.equal(tests.length, 18);
  assert.ok(
    tests.every((t) => t.status === TestStatus.Success),
    JSON.stringify(tests),
  );
});

test('the hook stays out of worker threads that a test starts', () => {
  const probe = session.dryRun.tests.find((t) =>
    t.name.endsWith(
      'a worker thread it starts does not install the Stryker hook',
    ),
  );

  assert.equal(probe?.status, TestStatus.Success, JSON.stringify(probe));
});

// Playwright skips the rest of a serial group after a failure, so the `countTo` kill names only the group's first
// test, and the test count shows the group ran whole while the `double` mutant survives.
test('a mutant run filtered to one test of a describe.serial group runs the whole group, and only that', async () => {
  const doubleMutant = mutant('ArithmeticOperator', 'n / 2');
  const serial = await session.mutantRun(doubleMutant, {
    testFilter: [testId('second user of the shared page')],
  });
  const alone = await session.mutantRun(doubleMutant, {
    testFilter: [testId('shows the greeting')],
  });
  const killed = await session.mutantRun(mutant('EqualityOperator', 'i <= n'), {
    testFilter: [testId('second user of the shared page')],
  });

  assert.equal(serial.status, MutantRunStatus.Survived, JSON.stringify(serial));
  assert.equal(serial.nrOfTests, 2);
  assert.equal(alone.status, MutantRunStatus.Survived, JSON.stringify(alone));
  assert.equal(alone.nrOfTests, 1);
  assert.equal(killed.status, MutantRunStatus.Killed, JSON.stringify(killed));
  assert.deepEqual(killed.killedBy, [testId('first user of the shared page')]);
});

function runSlowGroup(coveringTest: string): Promise<MutantRunResult> {
  return session.mutantRun(
    mutant('BooleanLiteral', 'true', 'src/node-only.ts'),
    {
      testFilter: [testId(coveringTest)],
      timeout: loopRunTimeout,
    },
  );
}

test('a serial peer stopped at the deadline leaves a survivor when the covering test passed', async () => {
  const loggedBefore = logged.length;
  const result = await runSlowGroup('passes under any mutant');

  assert.equal(result.status, MutantRunStatus.Survived, JSON.stringify(result));
  assert.equal(result.nrOfTests, 1);
  assert.notEqual(deadlineStopTook(loggedBefore), undefined);
});

test('a covering test stopped at the deadline in a serial group is a Timeout', async () => {
  const result = await runSlowGroup(
    'waits past the deadline under the slow mutant',
  );

  assertTimedOut(result, /deadline/);
});

test('per-test coverage separates tests that reach different code', () => {
  const greeting = perTestCoverage('shows the greeting');
  const counting = perTestCoverage('counts to three');
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
  const greeting = perTestCoverage('shows the greeting');
  const counting = perTestCoverage('counts to three');

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
    session.mutantCoverage.static[loopMutant],
    'shared-page coverage lands in static',
  );
  assert.equal(
    session.mutantCoverage.perTest[testId('first user of the shared page')],
    undefined,
  );
});

test('coverage survives a navigation to a page without instrumented code', () => {
  const greetingMutant = mutant('StringLiteral', '""').id;
  const coverage =
    session.mutantCoverage.perTest[
      testId('keeps coverage across a navigation to a page without the app')
    ];

  assert.ok(coverage?.[greetingMutant]);
});

test('a page never closed before the worker closes the browser still reports coverage, as static', () => {
  const doubleMutant = mutant('ArithmeticOperator', 'n / 2').id;

  assert.ok(session.mutantCoverage.static[doubleMutant]);
});

test('a page the test closes still reports its coverage, for that test', () => {
  const halfMutant = mutant('ArithmeticOperator', 'n * 2').id;
  const coverage =
    session.mutantCoverage.perTest[
      testId('halves on a second page it closes before the test ends')
    ];

  assert.ok(coverage?.[halfMutant]);
});

test('reused contexts still get per-test coverage', () => {
  const { perTest } = session.mutantCoverage;
  const loopMutant = mutant('UpdateOperator', 'i--').id;

  assert.equal(
    perTest[testId('reused context, first test')]?.[loopMutant],
    undefined,
  );
  assert.ok(perTest[testId('reused context, second test')]?.[loopMutant]);
});

test('app code a test runs in the Playwright worker gets per-test coverage', () => {
  const { perTest } = session.mutantCoverage;

  assert.deepEqual(
    Object.keys(perTest[testId('adds in the worker')] ?? {}).sort(),
    mutantsReached(['add'], false),
  );
});

test('app code imported into the Playwright worker, outside any test, is static coverage', () => {
  const { perTest, static: atImport } = session.mutantCoverage;
  const importMutant = mutant('StringLiteral', '""', 'src/node-only.ts').id;

  assert.ok(atImport[importMutant], 'the import counts as static');
  assert.deepEqual(
    Object.keys(perTest).filter((id) => perTest[id]?.[importMutant]),
    [],
  );
});

test('app code a beforeAll hook or a worker fixture runs in the Playwright worker is static coverage', () => {
  const { perTest, static: shared } = session.mutantCoverage;
  const groupMutants = [
    mutant('ArithmeticOperator', 'n - 1', 'src/node-only.ts').id,
    mutant('ArithmeticOperator', 'n + 1', 'src/node-only.ts').id,
  ];

  groupMutants.forEach((id) => {
    assert.ok(shared[id], `mutant ${id} counts as static`);
    assert.deepEqual(
      Object.keys(perTest).filter((test) => perTest[test]?.[id]),
      [],
    );
  });
});

test('a page a beforeAll hook opens and closes in its own context is static coverage', () => {
  assert.equal(
    session.mutantCoverage.perTest[
      testId('reads what the beforeAll page computed')
    ],
    undefined,
  );
});

test('a mutant in app code that only the worker runs is killed by the test the dry run says covers it', async () => {
  const workerMutant = mutant('ArithmeticOperator', 'a - b');
  const worker = testId('adds in the worker');

  assert.ok(session.mutantCoverage.perTest[worker]?.[workerMutant.id]);

  const result = await session.mutantRun(workerMutant, {
    testFilter: [worker],
  });

  assert.equal(result.status, MutantRunStatus.Killed, JSON.stringify(result));
  assert.deepEqual(result.killedBy, [worker]);
});

test('an infinite loop in app code that the worker runs trips the hit limit', async () => {
  const result = await session.mutantRun(mutant('UpdateOperator', 'i--'), {
    testFilter: [testId('counts in the worker')],
    hitLimit: 1000,
  });

  assertTimedOut(result, /Hit limit reached/);
});

test('a runtime mutant is killed by the test that covers it', async () => {
  const result = await runKnownKill();

  assert.equal(result.status, MutantRunStatus.Killed);
  assert.deepEqual(result.killedBy, [testId('shows the greeting')]);
});

test('a module-level mutant in page code is killed by the test whose page loads it', async () => {
  const result = await session.mutantRun(mutant('StringLiteral', '""'), {
    testFilter: [testId('shows the greeting')],
  });

  assert.equal(result.status, MutantRunStatus.Killed);
});

test('a static mutant run as Stryker plans one, with no test filter and static activation, is killed', async () => {
  const result = await session.mutantRun(
    mutant('ArithmeticOperator', 'n - 1', 'src/node-only.ts'),
    { mutantActivation: 'static', reloadEnvironment: true },
  );

  assert.equal(result.status, MutantRunStatus.Killed, JSON.stringify(result));
  assert.deepEqual(result.killedBy, [
    testId('reads what the beforeAll hook computed'),
  ]);
});

test('a mutant the selected tests do not reach survives, and the next run starts clean', async () => {
  const survived = await session.mutantRun(
    mutant('ArithmeticOperator', 'a - b'),
    { testFilter: [testId('counts to three')] },
  );
  const killed = await runKnownKill();

  assert.equal(survived.status, MutantRunStatus.Survived);
  assert.equal(killed.status, MutantRunStatus.Killed);
});

test('a run whose selected tests no longer exist is an error, not a survivor', async () => {
  const result = await session.mutantRun(
    mutant('ArithmeticOperator', 'a - b'),
    { testFilter: ['no-such-test-id'] },
  );

  assert.equal(result.status, MutantRunStatus.Error);
});

test('an infinite loop without a hit limit times out within its budget, and the next run is clean', async (t) => {
  const { timedOut, elapsed, stopTook, killed } =
    await timedLoopRun('counts to three');

  assert.equal(
    timedOut.status,
    MutantRunStatus.Timeout,
    JSON.stringify(timedOut),
  );
  // The per-test timeout and the deadline fall at about the same moment, so either may end the run.
  // A deadline stop is timed from when it started, as in the deadline test; without one the whole
  // run ended before the deadline. Playwright's teardown after either is reported, not asserted.
  const endedAt = stopTook === undefined ? elapsed : elapsed - stopTook;
  t.diagnostic(
    `run took ${Math.round(elapsed)} ms, deadline stop ${stopTook === undefined ? 'none' : `took ${stopTook} ms`}`,
  );
  assert.ok(
    endedAt < deadlineMs + 1000,
    `the runner ended the run after ${Math.round(endedAt)} ms, deadline ${deadlineMs} ms`,
  );
  assert.equal(killed.status, MutantRunStatus.Killed, JSON.stringify(killed));
});

test('an infinite loop trips the hit limit and reports a timeout', async () => {
  const result = await session.mutantRun(mutant('UpdateOperator', 'i--'), {
    testFilter: [testId('counts to three')],
    hitLimit: 1000,
  });

  assertTimedOut(result, /Hit limit reached/);
});

test('a loop in a test that raised its own timeout stops at the deadline, without a new init', async (t) => {
  const serverPid = () =>
    fetch('http://127.0.0.1:4321/__pid').then((response) => response.text());
  const before = await serverPid();
  const { timedOut, elapsed, stopTook, killed } = await timedLoopRun(
    'counts to three under a raised timeout',
  );

  assertTimedOut(timedOut, /deadline/);
  // The runner decides when the stop starts; how long Playwright's teardown then takes is not its
  // to decide (2.1 s in 8 of 9 measured runs, 6.5 s once), so that part is reported, not asserted.
  const stoppedAfter = elapsed - Number(stopTook);
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
  await fetch('http://127.0.0.1:4321/__exit').catch(() => undefined);
  assert.equal(
    await acceptsConnections(4321),
    false,
    'the fixture server stopped',
  );

  const survived = await session.mutantRun(
    mutant('ArithmeticOperator', 'a - b'),
    { testFilter: [testId('counts to three')] },
  );
  const killed = await runKnownKill();

  assert.equal(survived.status, MutantRunStatus.Survived);
  assert.equal(killed.status, MutantRunStatus.Killed);
});

test('no Playwright artifacts are written next to the config', () => {
  assert.equal(existsSync(fixture('test-results')), false);
});

test('dispose removes the temp directory the runner kept its output and runs in', async () => {
  const ownRoots = () =>
    readdirSync(tmpdir()).filter((name) =>
      name.startsWith(`lz-stryker-playwright-${process.pid}-`),
    );
  assert.equal(
    ownRoots().length,
    1,
    'the temp directory exists while the runner is up',
  );

  await session.dispose();
  disposed = true;

  assert.deepEqual(ownRoots(), []);
});
