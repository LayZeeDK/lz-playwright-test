import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  instrumentationOf,
  isSerialSuite,
  playwrightVersion,
  probeInternals,
  runningSlotOf,
  supportsPlaywright,
  testRunnerMethods,
  workerEntry,
} from '../src/playwright-internals.ts';

const src = new URL('../src/', import.meta.url);

function fakeModules(
  methods: readonly string[] = testRunnerMethods,
  answers: Readonly<Record<string, unknown>> = {},
) {
  class TestRunner {}
  Object.assign(
    TestRunner.prototype,
    Object.fromEntries(
      methods.map((method) => [method, async () => answers[method]]),
    ),
  );

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
  assert.equal(supportsPlaywright('1'), false);
});

test("Playwright's version is read from its package.json, and one that is no string fails loudly", () => {
  const requireManifest =
    (manifest: unknown) =>
    (id: string): unknown => {
      assert.equal(id, 'playwright/package.json');

      return manifest;
    };

  assert.equal(
    playwrightVersion(requireManifest({ version: '1.64.1' })),
    '1.64.1',
  );
  [{ version: 1 }, {}, null].forEach((manifest) => {
    assert.throws(() => playwrightVersion(requireManifest(manifest)), {
      message:
        'Playwright changed the internals this runner calls (playwright/package.json with a string version).',
    });
  });
});

test("the worker entry is Playwright's workerProcessEntry.js, by either path separator", () => {
  assert.equal(
    workerEntry.test(
      '/app/node_modules/playwright/lib/worker/workerProcessEntry.js',
    ),
    true,
  );
  assert.equal(
    workerEntry.test(
      'C:\\app\\node_modules\\playwright\\lib\\worker\\workerProcessEntry.js',
    ),
    true,
  );
  assert.equal(
    workerEntry.test(
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
    testRunnerMethods.filter((method) => method !== 'stopTests'),
  );
  const missingLoader = { ...fakeModules(), common: {} };
  const missingUtil = {
    ...fakeModules(),
    coreBundle: { utils: {} },
  };
  const missingRunner = { ...fakeModules(), runner: {} };

  [missingMethod, missingLoader, missingUtil, missingRunner].forEach(
    (modules) => {
      assert.throws(() => probeInternals('1.99.0', modules), {
        message:
          /^Playwright 1\.99\.0 changed the internals this runner calls \(playwright\/lib\/runner TestRunner with initialize, .*stopTests; playwright\/lib\/common configLoader; playwright-core coreBundle isURLAvailable\)\.$/,
      });
    },
  );
});

test('the probe names every internal when a module or a step on the path to an internal is not an object', () => {
  const arrowRunner = () => undefined;

  [
    { ...fakeModules(), runner: undefined },
    { ...fakeModules(), common: undefined },
    { ...fakeModules(), coreBundle: undefined },
    { ...fakeModules(), coreBundle: {} },
    { ...fakeModules(), runner: { testRunner: { TestRunner: arrowRunner } } },
  ].forEach((modules) => {
    assert.throws(() => probeInternals('1.99.0', modules), {
      message:
        /^Playwright 1\.99\.0 changed the internals this runner calls \(playwright\/lib\/runner TestRunner with initialize, /,
    });
  });
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
    fakeModules(testRunnerMethods, answers),
  ).createTestRunner(undefined, {});
}

function statusCalls(runner: Awaited<ReturnType<typeof testRunnerAnswering>>) {
  return {
    listTests: () => runner.listTests({}, {}),
    runGlobalSetup: () => runner.runGlobalSetup([]),
    runTests: () => runner.runTests({}, { locations: [] }),
  };
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
      { url: undefined, port: undefined, ignoreHTTPSErrors: false },
    ],
  });
});

test('the test runner reads loaded config values the way Playwright does: a numeric string port, and default and ignoreHTTPSErrors by truthiness', async () => {
  const runner = await testRunnerAnswering({
    loadConfig: {
      projects: [
        { default: 'yes', project: { name: 'a', timeout: 1 } },
        { default: 0, project: { name: 'b', timeout: 1 } },
      ],
      webServers: [
        { port: '3000', ignoreHTTPSErrors: 1 },
        { port: 4000, ignoreHTTPSErrors: '' },
      ],
    },
  });

  assert.deepEqual(await runner.loadConfig(), {
    projects: [
      { default: true, expect: undefined, project: { name: 'a', timeout: 1 } },
      { default: false, expect: undefined, project: { name: 'b', timeout: 1 } },
    ],
    webServers: [
      { url: undefined, port: 3000, ignoreHTTPSErrors: true },
      { url: undefined, port: 4000, ignoreHTTPSErrors: false },
    ],
  });
});

test('the test runner reads what Playwright runs though its types refuse it: a falsy port or url as none, any port next to a url as the port of that url, a URL object as its string, a null expect.timeout as none', async () => {
  const runner = await testRunnerAnswering({
    loadConfig: {
      projects: [
        {
          default: true,
          expect: { timeout: null },
          project: { name: 'a', timeout: 1 },
        },
      ],
      webServers: [
        { port: '' },
        { port: null },
        { port: false },
        { port: 0 },
        { url: null },
        { url: new URL('http://127.0.0.1:41234/') },
        { url: 'http://localhost:3000/health', port: null },
        { url: 'http://localhost/health', port: false },
      ],
    },
  });

  assert.deepEqual(await runner.loadConfig(), {
    projects: [
      {
        default: true,
        expect: { timeout: undefined },
        project: { name: 'a', timeout: 1 },
      },
    ],
    webServers: [
      { url: undefined, port: undefined, ignoreHTTPSErrors: false },
      { url: undefined, port: undefined, ignoreHTTPSErrors: false },
      { url: undefined, port: undefined, ignoreHTTPSErrors: false },
      { url: undefined, port: undefined, ignoreHTTPSErrors: false },
      { url: undefined, port: undefined, ignoreHTTPSErrors: false },
      {
        url: 'http://127.0.0.1:41234/',
        port: undefined,
        ignoreHTTPSErrors: false,
      },
      {
        url: 'http://localhost:3000/health',
        port: 3000,
        ignoreHTTPSErrors: false,
      },
      { url: 'http://localhost/health', port: 0, ignoreHTTPSErrors: false },
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

const refusedConfigs = [
  ['is no object', null],
  ['has no projects array', { projects: {}, webServers: [] }],
  ['has no webServers array', { projects: [], webServers: {} }],
  ['has a project that is no object', { projects: [null], webServers: [] }],
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
    'has a web server whose port is a string of no digits',
    { projects: [], webServers: [{ ...validServer, port: 'auto' }] },
  ],
  [
    'has a web server whose port is a string that only starts with digits',
    { projects: [], webServers: [{ ...validServer, port: '3000x' }] },
  ],
  [
    'has a web server whose port is a string that only ends with digits',
    { projects: [], webServers: [{ ...validServer, port: 'x3000' }] },
  ],
  [
    'has a web server whose port is no number or string',
    { projects: [], webServers: [{ ...validServer, port: [3000] }] },
  ],
] as const;

refusedConfigs.forEach(([title, config]) => {
  test(`the test runner refuses a loaded config that ${title}`, async () => {
    const runner = await testRunnerAnswering({ loadConfig: config });

    await assert.rejects(runner.loadConfig(), {
      message:
        'Playwright 1.99.0 changed the internals this runner calls (TestRunner.loadConfig() resolving to projects[].default, ' +
        'project.name, project.timeout and expect.timeout, and webServers[].url, port and ignoreHTTPSErrors).',
    });
  });
});

test('the test runner resolves listTests, runGlobalSetup and runTests to their status alone, and listTests also to undefined', async () => {
  const runner = await testRunnerAnswering({
    listTests: { status: 'passed', suite: {} },
    runGlobalSetup: { status: 'failed' },
    runTests: { status: 'timedout' },
  });
  const interrupted = await testRunnerAnswering({
    runTests: { status: 'interrupted' },
  });

  const calls = statusCalls(runner);
  const interruptedCalls = statusCalls(interrupted);

  assert.deepEqual(
    [
      await calls.listTests(),
      await calls.runGlobalSetup(),
      await calls.runTests(),
      await interruptedCalls.runTests(),
      await interruptedCalls.listTests(),
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

(['listTests', 'runGlobalSetup', 'runTests'] as const).forEach((method) => {
  [null, {}, { status: 'done' }].forEach((answer) => {
    test(`the test runner refuses a ${method} that resolves to ${JSON.stringify(answer)}`, async () => {
      const runner = await testRunnerAnswering({ [method]: answer });

      await assert.rejects(statusCalls(runner)[method](), {
        message: `Playwright 1.99.0 changed the internals this runner calls (TestRunner.${method}() resolving to a status of passed, failed, timedout or interrupted).`,
      });
    });
  });
});

test('the test runner calls each method on the instance Playwright constructed, with the arguments it was given', async () => {
  const seen: unknown[][] = [];

  class TestRunner {
    readonly args: unknown[];

    constructor(...args: unknown[]) {
      this.args = args;
    }
  }

  testRunnerMethods.forEach((method) => {
    Object.assign(TestRunner.prototype, {
      async [method](this: unknown, ...args: unknown[]) {
        seen.push([method, this, ...args]);

        return method === 'loadConfig'
          ? { projects: [], webServers: [] }
          : { status: 'passed' };
      },
    });
  });

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

  const [first] = seen;
  assert.ok(first);
  const [, instance] = first;
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

test('the test runner calls the methods the probe read, not ones put on the prototype later', async () => {
  const modules = fakeModules();
  const playwright = probeInternals('1.99.0', modules);
  const { TestRunner } = modules.runner.testRunner;
  const later: string[] = [];
  testRunnerMethods.forEach((method) => {
    Object.assign(TestRunner.prototype, {
      [method]: async () => {
        later.push(method);
      },
    });
  });

  const runner = await playwright.createTestRunner(undefined, {});
  await runner.stopTests();

  assert.deepEqual(later, []);
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

  instrumentationOf(core, '1.99.0').addListener(listener);

  assert.equal(listeners.length, 1);
  assert.equal(listeners[0], listener);

  [undefined, {}, { _instrumentation: {} }].forEach((core) => {
    assert.throws(() => instrumentationOf(core, '1.99.0'), {
      message:
        /^Playwright 1\.99\.0 changed the internals this runner calls \(playwright-core _instrumentation\.addListener\)\.$/,
    });
  });
});

test('the describe mode is read from the suite, and its absence fails loudly', () => {
  assert.equal(isSerialSuite({ _parallelMode: 'serial' }, '1.99.0'), true);
  assert.equal(isSerialSuite({ _parallelMode: 'none' }, '1.99.0'), false);
  [{}, undefined].forEach((suite) => {
    assert.throws(() => isSerialSuite(suite, '1.99.0'), {
      message:
        'Playwright 1.99.0 changed the internals this runner calls (Suite._parallelMode, which keeps describe.serial groups together).',
    });
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
  [
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
  ].forEach((type) => {
    assert.deepEqual(
      runningSlotOf(
        { _timeoutManager: { _running: { runnable: { type } } } },
        '1.64.1',
      ),
      { type, inFixture: false },
    );
  });
});

test('no TestInfo, or a timeout manager that runs nothing, has no running slot', () => {
  [
    undefined,
    null,
    { _timeoutManager: {} },
    { _timeoutManager: { _running: null } },
    { _timeoutManager: { _running: {} } },
    { _timeoutManager: { _running: { runnable: null } } },
  ].forEach((testInfo) => {
    assert.equal(
      runningSlotOf(testInfo, '1.64.1'),
      undefined,
      JSON.stringify(testInfo),
    );
  });
});

test('a TestInfo without an object timeout manager, or running an unknown slot type, fails loudly, naming the internal and the version', () => {
  [
    {},
    { _timeoutManager: null },
    { _timeoutManager: 'manager' },
    { _timeoutManager: { _running: { runnable: {} } } },
    { _timeoutManager: { _running: { runnable: { type: 1 } } } },
    { _timeoutManager: { _running: { runnable: { type: 'beforeSome' } } } },
  ].forEach((testInfo) => {
    assert.throws(
      () => runningSlotOf(testInfo, '1.99.0'),
      {
        message:
          /^Playwright 1\.99\.0 changed the internals this runner calls \(TestInfo\._timeoutManager, /,
      },
      JSON.stringify(testInfo),
    );
  });
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

  assert.deepEqual(runtimeImports, ['node:module', './is-record.ts']);
});
