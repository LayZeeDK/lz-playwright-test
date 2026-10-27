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

/** `answers` holds what each TestRunner method resolves to, by method name. */
function fakeModules(
  methods: readonly string[] = TEST_RUNNER_METHODS,
  answers: Readonly<Record<string, unknown>> = {},
) {
  class TestRunner {}

  for (const method of methods) {
    Object.assign(TestRunner.prototype, {
      [method]: async () => answers[method],
    });
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

function testRunnerAnswering(answers: Readonly<Record<string, unknown>>) {
  return probeInternals(
    '1.99.0',
    fakeModules(TEST_RUNNER_METHODS, answers),
  ).createTestRunner(undefined, {});
}

test('the test runner resolves loadConfig to the project and web server fields the runner reads', async () => {
  const runner = await testRunnerAnswering({
    loadConfig: {
      projects: [
        {
          default: true,
          expect: { timeout: 5, toPass: {} },
          project: { name: 'a', timeout: 1, retries: 0 },
          deps: [],
        },
        { default: false, expect: {}, project: { name: 'b', timeout: 0 } },
        { default: true, project: { name: 'c', timeout: 2 } },
      ],
      webServers: [
        {
          url: 'http://localhost:3000',
          port: 3000,
          ignoreHTTPSErrors: true,
          command: 'serve',
        },
        {},
      ],
      workers: 1,
    },
  });

  assert.deepEqual(await runner.loadConfig(), {
    projects: [
      {
        default: true,
        expect: { timeout: 5 },
        project: { name: 'a', timeout: 1 },
      },
      {
        default: false,
        expect: { timeout: undefined },
        project: { name: 'b', timeout: 0 },
      },
      {
        default: true,
        expect: undefined,
        project: { name: 'c', timeout: 2 },
      },
    ],
    webServers: [
      { url: 'http://localhost:3000', port: 3000, ignoreHTTPSErrors: true },
      { url: undefined, port: undefined, ignoreHTTPSErrors: undefined },
    ],
  });
});

const validProject = {
  default: true,
  expect: { timeout: 5 },
  project: { name: 'a', timeout: 1 },
};
const validServer = {
  url: 'http://localhost',
  port: 1,
  ignoreHTTPSErrors: true,
};

for (const [title, config] of [
  ['is no object', null],
  ['has no projects array', { projects: {}, webServers: [] }],
  ['has no webServers array', { projects: [], webServers: {} }],
  ['has a project that is no object', { projects: [null], webServers: [] }],
  [
    'has a project with no boolean default',
    { projects: [{ ...validProject, default: 'yes' }], webServers: [] },
  ],
  [
    'has a project with no project object',
    { projects: [{ ...validProject, project: null }], webServers: [] },
  ],
  [
    'has a project with no string project.name',
    {
      projects: [{ ...validProject, project: { name: 1, timeout: 1 } }],
      webServers: [],
    },
  ],
  [
    'has a project with no number project.timeout',
    {
      projects: [{ ...validProject, project: { name: 'a', timeout: '1' } }],
      webServers: [],
    },
  ],
  [
    'has a project whose expect is no object',
    { projects: [{ ...validProject, expect: 5 }], webServers: [] },
  ],
  [
    'has a project with no number expect.timeout',
    {
      projects: [{ ...validProject, expect: { timeout: '5' } }],
      webServers: [],
    },
  ],
  ['has a web server that is no object', { projects: [], webServers: [null] }],
  [
    'has a web server with no string url',
    { projects: [], webServers: [{ ...validServer, url: 1 }] },
  ],
  [
    'has a web server with no number port',
    { projects: [], webServers: [{ ...validServer, port: '1' }] },
  ],
  [
    'has a web server with no boolean ignoreHTTPSErrors',
    { projects: [], webServers: [{ ...validServer, ignoreHTTPSErrors: 1 }] },
  ],
] as const) {
  test(`the test runner refuses a loaded config that ${title}`, async () => {
    const runner = await testRunnerAnswering({ loadConfig: config });

    await assert.rejects(runner.loadConfig(), {
      message:
        'Playwright 1.99.0 changed what TestRunner.loadConfig() resolves to; this runner reads projects[].default, ' +
        'project.name, project.timeout and expect.timeout, and webServers[].url, port and ignoreHTTPSErrors.',
    });
  });
}

test('the test runner resolves listTests, runGlobalSetup and runTests to their status alone, and listTests also to undefined', async () => {
  const runner = await testRunnerAnswering({
    listTests: { status: 'passed', suite: {} },
    runGlobalSetup: { status: 'failed' },
    runTests: { status: 'timedout' },
  });
  const interrupted = await testRunnerAnswering({
    runTests: { status: 'interrupted' },
  });

  assert.deepEqual(
    [
      await runner.listTests({}, {}),
      await runner.runGlobalSetup([]),
      await runner.runTests({}, { locations: [] }),
      await interrupted.runTests({}, { locations: [] }),
      await interrupted.listTests({}, {}),
    ],
    [
      { status: 'passed' },
      { status: 'failed' },
      { status: 'timedout' },
      { status: 'interrupted' },
      undefined,
    ],
  );
});

for (const method of ['listTests', 'runGlobalSetup', 'runTests'] as const) {
  for (const answer of [null, {}, { status: 'done' }]) {
    test(`the test runner refuses a ${method} that resolves to ${JSON.stringify(answer)}`, async () => {
      const runner = await testRunnerAnswering({ [method]: answer });
      const calls = {
        listTests: () => runner.listTests({}, {}),
        runGlobalSetup: () => runner.runGlobalSetup([]),
        runTests: () => runner.runTests({}, { locations: [] }),
      };

      await assert.rejects(calls[method](), {
        message: `Playwright 1.99.0 changed what TestRunner.${method}() resolves to; this runner reads its status: passed, failed, timedout or interrupted.`,
      });
    });
  }
}

test('the test runner calls each method on the instance Playwright constructed, with the arguments it was given', async () => {
  const seen: unknown[][] = [];

  class TestRunner {
    readonly args: unknown[];

    constructor(...args: unknown[]) {
      this.args = args;
    }
  }

  for (const method of TEST_RUNNER_METHODS) {
    Object.assign(TestRunner.prototype, {
      async [method](this: unknown, ...args: unknown[]) {
        seen.push([method, this, ...args]);

        return method === 'loadConfig'
          ? { projects: [], webServers: [] }
          : { status: 'passed' };
      },
    });
  }

  const reporter = {};
  const runner = await probeInternals('1.99.0', {
    ...fakeModules(),
    common: { configLoader: { resolveConfigLocation: () => 'location' } },
    runner: { testRunner: { TestRunner } },
  }).createTestRunner('playwright.config.ts', { workers: 1 });
  await runner.loadConfig();
  await runner.listTests(reporter, { projects: ['a'] });
  await runner.runGlobalSetup([reporter]);
  await runner.runTests(reporter, { locations: [] });
  await runner.stopTests();
  await runner.runGlobalTeardown();

  const [[, instance]] = seen;
  assert.ok(instance instanceof TestRunner);
  assert.deepEqual(instance.args, ['location', { workers: 1 }]);
  assert.deepEqual(seen, [
    ['initialize', instance, {}],
    ['loadConfig', instance],
    ['listTests', instance, reporter, { projects: ['a'] }],
    ['runGlobalSetup', instance, [reporter]],
    ['runTests', instance, reporter, { locations: [] }],
    ['stopTests', instance],
    ['runGlobalTeardown', instance],
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
