import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  type CommonModule,
  type CoreBundleModule,
  parallelModeOf,
  probeInternals,
  type RunnerModule,
  runningSlotOf,
  supportsPlaywright,
  TEST_RUNNER_METHODS,
  WORKER_ENTRY,
} from '../src/playwright-internals.ts';

const src = new URL('../src/', import.meta.url);

function fakeModules(methods = TEST_RUNNER_METHODS) {
  class TestRunner {}

  for (const method of methods) {
    Object.assign(TestRunner.prototype, { [method]: () => undefined });
  }

  return {
    runner: { testRunner: { TestRunner } } as unknown as Partial<RunnerModule>,
    common: {
      configLoader: { resolveConfigLocation: () => ({}) },
    } as Partial<CommonModule>,
    coreBundle: {
      utils: { isURLAvailable: async () => true },
    } as Partial<CoreBundleModule>,
  };
}

test('the runner supports Playwright 1.63 and later', () => {
  assert.equal(supportsPlaywright('1.62.9'), false);
  assert.equal(supportsPlaywright('1.63.0'), true);
  assert.equal(supportsPlaywright('2.0.0'), true);
  assert.equal(supportsPlaywright('0.70.0'), false);
});

test("the worker entry is Playwright's workerProcessEntry.js, by either path separator", () => {
  assert.equal(
    WORKER_ENTRY.test(
      '/app/node_modules/playwright/lib/worker/workerProcessEntry.js',
    ),
    true,
  );
  assert.equal(
    WORKER_ENTRY.test(
      'C:\\app\\node_modules\\playwright\\lib\\worker\\workerProcessEntry.js',
    ),
    true,
  );
  assert.equal(
    WORKER_ENTRY.test(
      '/app/node_modules/playwright/lib/worker/workerProcessEntry.js.map',
    ),
    false,
  );
});

test('the probe accepts the internals the runner calls', () => {
  const playwright = probeInternals('1.63.0', fakeModules());

  assert.equal(playwright.version, '1.63.0');
  assert.equal(typeof playwright.createTestRunner, 'function');
});

test('the probe names every internal when one is missing', () => {
  const missingMethod = fakeModules(
    TEST_RUNNER_METHODS.filter((method) => method !== 'stopTests'),
  );
  const missingLoader = { ...fakeModules(), common: {} };
  const missingUtil = {
    ...fakeModules(),
    coreBundle: { utils: {} } as Partial<CoreBundleModule>,
  };
  const missingRunner = { ...fakeModules(), runner: {} };

  for (const modules of [
    missingMethod,
    missingLoader,
    missingUtil,
    missingRunner,
  ]) {
    assert.throws(() => probeInternals('1.99.0', modules), {
      message:
        /^Playwright 1\.99\.0 changed the internals this runner calls \(playwright\/lib\/runner TestRunner with initialize, .*stopTests; playwright\/lib\/common configLoader; playwright-core coreBundle isURLAvailable\)\.$/,
    });
  }
});

test('the describe mode is read from the suite, and its absence fails loudly', () => {
  assert.equal(parallelModeOf({ _parallelMode: 'serial' }), 'serial');
  assert.throws(() => parallelModeOf({}), {
    message: /Suite\._parallelMode/,
  });
  assert.throws(() => parallelModeOf(undefined), {
    message: /Suite\._parallelMode/,
  });
});

test("the running slot is read from the TestInfo's timeout manager", () => {
  const info = (runnable: unknown) => ({
    _timeoutManager: { _running: { runnable } },
  });

  assert.deepEqual(runningSlotOf(info({ type: 'beforeAll' })), {
    type: 'beforeAll',
    inFixture: false,
  });
  assert.deepEqual(
    runningSlotOf(info({ type: 'test', fixture: { title: 'server' } })),
    { type: 'test', inFixture: true },
  );
});

test('a TestInfo without that shape, or with nothing running, has no running slot', () => {
  for (const testInfo of [
    undefined,
    null,
    {},
    { _timeoutManager: null },
    { _timeoutManager: {} },
    { _timeoutManager: { _running: null } },
    { _timeoutManager: { _running: {} } },
    { _timeoutManager: { _running: { runnable: null } } },
    { _timeoutManager: { _running: { runnable: { type: 1 } } } },
  ]) {
    assert.equal(runningSlotOf(testInfo), undefined, JSON.stringify(testInfo));
  }
});

test('only playwright-internals.ts names a Playwright internal', () => {
  const internals =
    /lib\/runner|lib\/common|coreBundle|_instrumentation|_parallelMode|_timeoutManager|workerProcessEntry|PLAYWRIGHT_NO_COPY_PROMPT/;
  const offenders = readdirSync(src)
    .filter((file) => file !== 'playwright-internals.ts')
    .filter((file) => internals.test(readFileSync(new URL(file, src), 'utf8')));

  assert.deepEqual(offenders, []);
});

test('playwright-internals.ts imports no runner code at run time', () => {
  const source = readFileSync(new URL('playwright-internals.ts', src), 'utf8');
  const runtimeImports = [
    ...source.matchAll(
      /^(?:import|export) (?!type )(?:[^;]*? from )?'([^']+)'/gms,
    ),
  ].map(([, specifier]) => specifier);

  assert.deepEqual(runtimeImports, ['node:module']);
});
