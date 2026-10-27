import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  instrumentationOf,
  isSerialSuite,
  probeInternals,
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
    runner: { testRunner: { TestRunner } },
    common: {
      configLoader: { resolveConfigLocation: () => ({}) },
    },
    coreBundle: {
      utils: { isURLAvailable: async () => true },
    },
  };
}

test('the runner supports Playwright 1.63 and later 1.x releases', () => {
  assert.equal(supportsPlaywright('1.62.9'), false);
  assert.equal(supportsPlaywright('1.63.0'), true);
  assert.equal(supportsPlaywright('1.99.0'), true);
  assert.equal(supportsPlaywright('2.0.0'), false);
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
    coreBundle: { utils: {} },
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

test('the probe names every internal when a module or a step on the path to an internal is not an object', () => {
  const arrowRunner = () => undefined;

  for (const modules of [
    { ...fakeModules(), runner: undefined },
    { ...fakeModules(), common: undefined },
    { ...fakeModules(), coreBundle: undefined },
    { ...fakeModules(), coreBundle: {} },
    { ...fakeModules(), runner: { testRunner: { TestRunner: arrowRunner } } },
  ]) {
    assert.throws(() => probeInternals('1.99.0', modules), {
      message:
        /^Playwright 1\.99\.0 changed the internals this runner calls \(playwright\/lib\/runner TestRunner with initialize, /,
    });
  }
});

test("the probe's URL check passes the URL and the HTTPS flag on, and counts only true as available", async () => {
  const calls: unknown[][] = [];
  const answering = (answer: unknown) => ({
    ...fakeModules(),
    coreBundle: {
      utils: {
        isURLAvailable: async (...args: unknown[]) => {
          calls.push(args);

          return answer;
        },
      },
    },
  });
  const url = new URL('http://localhost:3000');

  assert.equal(
    await probeInternals('1.63.0', answering(true)).isURLAvailable(url, true),
    true,
  );
  assert.equal(
    await probeInternals('1.63.0', answering('yes')).isURLAvailable(url, false),
    false,
  );
  assert.deepEqual(calls, [
    [url, true],
    [url, false],
  ]);
});

test('the instrumentation is the one playwright-core exports, and its absence fails loudly', () => {
  const listeners: unknown[] = [];
  const core = {
    _instrumentation: {
      listeners,
      addListener(listener: unknown) {
        this.listeners.push(listener);
      },
    },
  };
  const listener = {};

  instrumentationOf(core).addListener(listener);

  assert.equal(listeners.length, 1);
  assert.equal(listeners[0], listener);

  for (const core of [undefined, {}, { _instrumentation: {} }]) {
    assert.throws(() => instrumentationOf(core), {
      message:
        /^Playwright changed the internals this runner calls \(playwright-core _instrumentation\.addListener\)\.$/,
    });
  }
});

test('the describe mode is read from the suite, and its absence fails loudly', () => {
  assert.equal(isSerialSuite({ _parallelMode: 'serial' }), true);
  assert.equal(isSerialSuite({ _parallelMode: 'none' }), false);
  assert.throws(() => isSerialSuite({}), {
    message: /Suite\._parallelMode/,
  });
  assert.throws(() => isSerialSuite(undefined), {
    message: /Suite\._parallelMode/,
  });
});

test("the running slot is read from the TestInfo's timeout manager", () => {
  const info = (runnable: unknown) => ({
    _timeoutManager: { _running: { runnable } },
  });

  assert.deepEqual(runningSlotOf(info({ type: 'beforeAll' }), '1.64.1'), {
    type: 'beforeAll',
    inFixture: false,
  });
  assert.deepEqual(
    runningSlotOf(
      info({ type: 'test', fixture: { title: 'server' } }),
      '1.64.1',
    ),
    { type: 'test', inFixture: true },
  );
});

test("every runnable type of Playwright's timeout manager is a slot", () => {
  for (const type of [
    'test',
    'beforeEach',
    'afterEach',
    'beforeAll',
    'afterAll',
    'teardown',
    'skip',
    'slow',
    'fail',
    'fixme',
  ]) {
    assert.deepEqual(
      runningSlotOf(
        { _timeoutManager: { _running: { runnable: { type } } } },
        '1.64.1',
      ),
      { type, inFixture: false },
    );
  }
});

test('no TestInfo, or a timeout manager that runs nothing, has no running slot', () => {
  for (const testInfo of [
    undefined,
    null,
    { _timeoutManager: {} },
    { _timeoutManager: { _running: null } },
    { _timeoutManager: { _running: {} } },
    { _timeoutManager: { _running: { runnable: null } } },
  ]) {
    assert.equal(
      runningSlotOf(testInfo, '1.64.1'),
      undefined,
      JSON.stringify(testInfo),
    );
  }
});

test('a TestInfo without an object timeout manager, or running an unknown slot type, fails loudly, naming the internal and the version', () => {
  for (const testInfo of [
    {},
    { _timeoutManager: null },
    { _timeoutManager: 'manager' },
    { _timeoutManager: { _running: { runnable: {} } } },
    { _timeoutManager: { _running: { runnable: { type: 1 } } } },
    { _timeoutManager: { _running: { runnable: { type: 'beforeSome' } } } },
  ]) {
    assert.throws(
      () => runningSlotOf(testInfo, '1.99.0'),
      {
        message:
          /^Playwright 1\.99\.0 changed the internals this runner calls \(TestInfo\._timeoutManager, /,
      },
      JSON.stringify(testInfo),
    );
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
