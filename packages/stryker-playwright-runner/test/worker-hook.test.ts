import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { before, type TestContext, test } from 'node:test';

import type { HookedContext } from '../src/playwright-internals.ts';
import {
  frameReadTimeoutMs,
  readSnapshotDir,
  runSettingsEnv,
  type RunSettings,
} from '../src/protocol.ts';
import type * as Hook from '../src/worker-hook.ts';
import type { StrykerNamespace } from '../src/worker-hook.ts';
import { codedError, tempTree } from './support/doubles.ts';
import { fakeInstall, type Runnable } from './support/fake-worker.ts';

let hook: typeof Hook;

// The hook installs at import when its gate opens, so a mutant that breaks the gate fails in a test.
before(async () => {
  hook = await import('../src/worker-hook.ts');
});

// Records a worker's namespace with fake I/O; `exit()` runs what the worker does at process exit.
function worker(
  settings: { perTest: boolean; hitLimit?: number },
  {
    testId = () => undefined,
    write,
  }: {
    testId?: () => string | undefined;
    write?: (line: string) => void;
  } = {},
) {
  const ns: StrykerNamespace = {};
  const lines: string[] = [];
  const listeners: (() => void)[] = [];
  hook.recordNodeCoverage(
    ns,
    settings,
    testId,
    write ?? ((line) => lines.push(line)),
    (listener) => listeners.push(listener),
  );

  return {
    ns,
    lines,
    exit: () => listeners.forEach((listener) => listener()),
  };
}

const workerHookUrl = new URL('../src/worker-hook.ts', import.meta.url).href;

test('a Playwright worker outside a Stryker run loads the hook and installs nothing', (t) => {
  const entry = 'playwright/lib/worker/workerProcessEntry.js';
  const dir = tempTree(t, 'worker-hook-test-', {
    [entry]: `console.log('entry ran');`,
  });

  const child = spawnSync(
    process.execPath,
    ['--import', workerHookUrl, path.join(dir, entry)],
    {
      encoding: 'utf8',
      env: { ...process.env, [runSettingsEnv]: undefined },
    },
  );

  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), 'entry ran');
});

const playwrightTestModule = [
  'const test = Object.assign(() => {}, { info() { throw new Error("no test"); } });',
  'module.exports = Object.assign(test, { test });',
].join('\n');

// Starts a fake Playwright worker during a run with the given `--import`s; it prints one line per install.
function runWorker(
  t: TestContext,
  imports: string[],
  playwrightTest = playwrightTestModule,
) {
  const dir = tempTree(t, 'worker-hook-gate-', {
    'node_modules/playwright/package.json': '{"version":"1.64.1"}',
    'node_modules/playwright/test.js': playwrightTest,
    'node_modules/playwright-core/package.json': '{"main":"index.js"}',
    // Every install adds one listener, so each line is one install.
    'node_modules/playwright-core/index.js': [
      `const { isMainThread } = require('node:worker_threads');`,
      `exports._instrumentation = { addListener() { console.log(isMainThread ? 'main' : 'thread'); } };`,
    ].join('\n'),
    // The thread runs this same file, so its argv[1] is the worker entry too.
    'playwright/lib/worker/workerProcessEntry.js': [
      `const { isMainThread, Worker } = require('node:worker_threads');`,
      `if (isMainThread) new Worker(__filename);`,
    ].join('\n'),
  });
  const outDir = path.join(dir, 'out');
  mkdirSync(outDir);

  const child = spawnSync(
    process.execPath,
    [
      ...imports.flatMap((url) => ['--import', url]),
      path.join(dir, 'playwright/lib/worker/workerProcessEntry.js'),
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        [runSettingsEnv]: JSON.stringify({ outDir, perTest: false }),
      },
    },
  );

  return { child, outDir };
}

function playwrightWith(t: TestContext, playwrightTest: string) {
  const dir = tempTree(t, 'worker-hook-api-', {
    'node_modules/playwright/package.json': '{"version":"1.64.1"}',
    'node_modules/playwright/test.js': playwrightTest,
    'node_modules/playwright-core/index.js':
      'exports._instrumentation = { addListener() {} };',
  });

  return createRequire(path.join(dir, 'entry.js'));
}

[
  'module.exports = null;',
  'exports.other = {};',
  'exports.test = {};',
  'exports.test = () => {};',
  'exports.test = { info: 1 };',
].forEach((playwrightTest) => {
  test(`the hook refuses a playwright/test without test.info() (${playwrightTest})`, (t) => {
    assert.throws(
      () =>
        hook.install(
          playwrightWith(t, playwrightTest),
          { outDir: 'unused', perTest: false },
          '__apiTest__',
        ),
      {
        message:
          'Playwright 1.64.1 changed the internals this runner calls (playwright/test test.info(), which tells the worker hook the test that runs).',
      },
    );
  });
});

test('during a run the hook installs in the main thread of a Playwright worker, not in its threads', (t) => {
  const { child, outDir } = runWorker(t, [workerHookUrl]);

  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), 'main');
  assert.equal(readdirSync(outDir).length, 1);
});

test('a worker whose hook fails to install leaves the error for the run and exits with it', (t) => {
  const { child, outDir } = runWorker(t, [workerHookUrl], 'exports.test = {};');

  assert.equal(child.status, 1, child.stderr);
  assert.deepEqual(readSnapshotDir(outDir), {
    snapshots: [],
    hookInstalled: false,
    installErrors: [
      'Error: Playwright 1.64.1 changed the internals this runner calls (playwright/test test.info(), which tells the worker hook the test that runs).',
    ],
  });
});

test('a worker whose hook fails to install and cannot leave the error still exits with that error', (t) => {
  const removeOutDir = `import fs from 'node:fs'; fs.rmSync(JSON.parse(process.env.${runSettingsEnv}).outDir, { recursive: true });`;
  const { child } = runWorker(
    t,
    [`data:text/javascript,${encodeURIComponent(removeOutDir)}`, workerHookUrl],
    'exports.test = {};',
  );

  assert.equal(child.status, 1, child.stderr);
  assert.match(
    child.stderr,
    /Error: Playwright 1\.64\.1 changed the internals this runner calls \(playwright\/test test\.info\(\), /,
  );
});

test('a second copy of the hook in the same worker installs nothing', (t) => {
  // Another URL loads the module again, as a second install of this package would.
  const { child, outDir } = runWorker(t, [
    workerHookUrl,
    `${workerHookUrl}?copy=2`,
  ]);

  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), 'main');
  assert.equal(readdirSync(outDir).length, 1);
});

test('the hook installs nothing in a worker where another version of it installed first', (t) => {
  const mark = `globalThis[Symbol.for('@layzee/stryker-playwright-runner/worker-hook')]=1`;
  const { child, outDir } = runWorker(t, [
    `data:text/javascript,${mark}`,
    workerHookUrl,
  ]);

  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), '');
  assert.deepEqual(readdirSync(outDir), []);
});

test('a worker that ran no instrumented code writes nothing at exit', () => {
  const { lines, exit } = worker({ perTest: true });

  exit();

  assert.deepEqual(lines, []);
});

test('a worker writes the coverage its app code recorded at exit, as one line', () => {
  const { ns, lines, exit } = worker({ perTest: false });
  ns.mutantCoverage = { static: { '1': 2 }, perTest: {} };

  exit();

  assert.deepEqual(
    lines.map((line): unknown => JSON.parse(line)),
    [
      {
        mutantCoverage: { static: { '1': 2 }, perTest: {} },
        outlivedItsTest: false,
      },
    ],
  );
});

test('the active mutant is left for the instrumented code to read from the environment', () => {
  const { ns } = worker({ perTest: true, hitLimit: 10 });

  assert.equal(ns.activeMutant, undefined);
  assert.equal(Object.hasOwn(ns, 'activeMutant'), false);
});

test('per-test coverage names the test running at the time, and none between tests', () => {
  let running: string | undefined = 'test-a';
  const { ns } = worker({ perTest: true }, { testId: () => running });

  assert.equal(ns.currentTestId, 'test-a');

  running = undefined;

  assert.equal(ns.currentTestId, undefined);
});

test('without per-test coverage no test id is set', () => {
  const { ns } = worker({ perTest: false }, { testId: () => 'test-a' });

  assert.equal(ns.currentTestId, undefined);
});

test('with a hit limit the worker counts hits from zero and writes the count at exit', () => {
  const { ns, lines, exit } = worker({ perTest: false, hitLimit: 10 });

  assert.equal(ns.hitLimit, 10);
  assert.equal(ns.hitCount, 0);

  ns.hitCount = 4;
  exit();

  assert.deepEqual(
    lines.map((line): unknown => JSON.parse(line)),
    [{ hitCount: 4, outlivedItsTest: false }],
  );
});

test('a worker past its hit limit writes its count at once, and not again at exit', () => {
  const { ns, lines, exit } = worker({ perTest: false, hitLimit: 10 });

  ns.hitCount = 10;

  assert.deepEqual(lines, []);

  ns.hitCount = 11;

  assert.deepEqual(
    lines.map((line): unknown => JSON.parse(line)),
    [{ hitCount: 11, outlivedItsTest: false }],
  );

  ns.hitCount = 12;
  exit();

  assert.equal(lines.length, 1);
});

test('a write that fails at exit does not throw out of the exit listener', () => {
  const { ns, exit } = worker(
    { perTest: false },
    {
      write: () => {
        throw codedError('ENOENT');
      },
    },
  );
  ns.mutantCoverage = { static: { '1': 1 }, perTest: {} };

  assert.doesNotThrow(exit);
});

test('without a hit limit the worker counts no hits', () => {
  const { ns } = worker({ perTest: true });

  assert.equal(ns.hitCount, undefined);
  assert.equal(ns.hitLimit, undefined);
});

// --- install, against a fake Playwright in this process ---

function installed(
  t: TestContext,
  settings: Omit<RunSettings, 'outDir'>,
  options?: Parameters<typeof fakeInstall>[3],
) {
  return fakeInstall(hook.install, t, settings, options);
}

test('install creates the worker snapshot file at once', (t) => {
  assert.equal(installed(t, { perTest: false }).read(), '');
});

test('each install names its snapshot file by the worker pid and a random part', (t) => {
  const name = /^worker-(\d+)-([0-9a-f-]{36})\.ndjson$/;
  const parts = [
    installed(t, { perTest: false }),
    installed(t, { perTest: false }),
  ].map((hooked) => {
    const [file] = hooked.files();
    const match = name.exec(file ?? '');
    assert.ok(match, file);
    const [, pid, random] = match;

    return { pid, random };
  });

  assert.deepEqual(
    parts.map(({ pid }) => pid),
    [String(process.pid), String(process.pid)],
  );
  assert.equal(new Set(parts.map(({ random }) => random)).size, 2);
});

test("install counts the worker's own hits in its namespace and writes them past the limit", (t) => {
  const hooked = installed(t, { perTest: false, hitLimit: 2 });

  hooked.namespace().hitCount = 3;

  assert.equal(hooked.read(), '{"hitCount":3,"outlivedItsTest":false}\n');
});

test("install keeps a namespace the worker's instrumented code made first", (t) => {
  const first: StrykerNamespace = {
    mutantCoverage: { static: {}, perTest: {} },
  };
  const hooked = installed(
    t,
    { perTest: true },
    {
      prepare: (_, ns) => {
        const scope: Record<string, unknown> = globalThis;
        scope[ns] = first;
      },
    },
  );
  hooked.setTest('t1');

  assert.equal(hooked.namespace(), first);
  assert.equal(first.currentTestId, 't1');
});

test('install replaces a namespace that is null with its own', (t) => {
  const hooked = installed(
    t,
    { perTest: true },
    {
      prepare: (_, ns) => {
        const scope: Record<string, unknown> = globalThis;
        scope[ns] = null;
      },
    },
  );
  hooked.setTest('t1');

  assert.equal(hooked.namespace().currentTestId, 't1');
});

test('a frame whose namespace is null holds nothing to read', async (t) => {
  const hooked = installed(t, { perTest: false });
  const created = await hooked.context();
  created.open(
    hooked.page([hooked.frame({ name: '__nullNamespaceHere__' })]).page,
  );
  const scope: Record<string, unknown> = globalThis;
  scope['__nullNamespaceHere__'] = null;
  t.after(() => {
    delete scope['__nullNamespaceHere__'];
  });

  await created.close();

  assert.equal(hooked.read(), '');
});

test("the worker's namespace names the running Playwright test, and none between tests", (t) => {
  const hooked = installed(t, { perTest: true });

  hooked.setTest('t1');

  assert.equal(hooked.namespace().currentTestId, 't1');

  hooked.setTest(undefined);

  assert.equal(hooked.namespace().currentTestId, undefined);
});

test("the worker's namespace names the test in its beforeEach and afterEach hooks", (t) => {
  const hooked = installed(t, { perTest: true });

  hooked.setTest('t1', { type: 'beforeEach' });

  assert.equal(hooked.namespace().currentTestId, 't1');

  hooked.setTest('t1', { type: 'afterEach' });

  assert.equal(hooked.namespace().currentTestId, 't1');
});

test("the worker's namespace names no test in a beforeAll or afterAll hook, a fixture, or an unknown slot", (t) => {
  const hooked = installed(t, { perTest: true });
  const shared: Runnable[] = [
    { type: 'beforeAll' },
    { type: 'afterAll' },
    { type: 'test', fixture: { title: 'server' } },
    { type: 'beforeEach', fixture: { title: 'server' } },
    { type: 'teardown' },
  ];

  shared.forEach((runs) => {
    hooked.setTest('t1', runs);

    assert.equal(
      hooked.namespace().currentTestId,
      undefined,
      JSON.stringify(runs),
    );
  });
});

const running = {
  _timeoutManager: { _running: { runnable: { type: 'test' } } },
};

const refusedInfos = [
  ['is no object', null],
  ['has no string testId', { ...running, testId: 1 }],
] as const;

refusedInfos.forEach(([title, info]) => {
  test(`the worker hook refuses a test.info() that ${title}`, (t) => {
    const hooked = installed(t, { perTest: true }, { info: () => info });

    assert.throws(() => hooked.namespace().currentTestId, {
      message:
        "Playwright 1.64.1 changed the internals this runner calls (playwright/test test.info() returning the running test's testId).",
    });
  });
});

test('at exit the worker writes its Node coverage to its snapshot file', (t) => {
  const hooked = installed(t, { perTest: false });
  hooked.namespace().mutantCoverage = { static: { '1': 1 }, perTest: {} };

  hooked.exitListeners.forEach((exit) => exit(0));

  assert.deepEqual(hooked.lines(), [
    {
      mutantCoverage: { static: { '1': 1 }, perTest: {} },
      outlivedItsTest: false,
    },
  ]);
});

test('every new context gets the init script with the namespace, mutant, test and hit limit', async (t) => {
  const hooked = installed(
    t,
    { perTest: true, hitLimit: 9 },
    { activeMutant: '42' },
  );
  hooked.setTest('t1');

  const { scripts } = await hooked.context();

  assert.deepEqual(scripts, [
    [
      hook.initPage,
      { ns: hooked.ns, activeMutant: '42', testId: 't1', hitLimit: 9 },
    ],
  ]);
});

test('without per-test coverage the init script names no test, and no mutant outside a mutant run', async (t) => {
  const hooked = installed(t, { perTest: false });
  hooked.setTest('t1');

  const { scripts } = await hooked.context();

  assert.deepEqual(scripts, [
    [
      hook.initPage,
      {
        ns: hooked.ns,
        activeMutant: undefined,
        testId: undefined,
        hitLimit: undefined,
      },
    ],
  ]);
});

test('a closing context writes what each frame of each page holds, as one line per frame', async (t) => {
  const hooked = installed(t, { perTest: true });
  hooked.setTest('t1');
  hooked.namespace().mutantCoverage = {
    static: {},
    perTest: { t1: { '1': 1 } },
  };
  hooked.namespace().hitCount = 5;
  const created = await hooked.context();
  created.open(hooked.page([hooked.frame(), hooked.frame()]).page);
  created.open(
    hooked.page([hooked.frame({ name: '__noNamespaceHere__' })]).page,
  );

  await created.close();

  assert.deepEqual(created.events, ['page']);
  const frameLine = {
    mutantCoverage: { static: {}, perTest: { t1: { '1': 1 } } },
    hitCount: 5,
    outlivedItsTest: false,
  };
  assert.equal(
    hooked.read(),
    [frameLine, frameLine].map((line) => JSON.stringify(line)).join('\n') +
      '\n',
  );
});

test('a context closes into the snapshot file once', async (t) => {
  const hooked = installed(t, { perTest: false });
  hooked.namespace().hitCount = 1;
  const created = await hooked.context();
  const { page } = hooked.page();
  created.open(page);
  await page.close();

  await created.close();
  await created.close();

  assert.equal(hooked.lines().length, 1);
});

test('a context the hook never saw created writes nothing', async (t) => {
  const hooked = installed(t, { perTest: false });
  hooked.namespace().hitCount = 1;
  const unseen: HookedContext = {
    pages: () => [hooked.page().page],
    browser: () => null,
    on: () => undefined,
    addInitScript: async () => undefined,
  };

  await hooked.hooks.runBeforeCloseBrowserContext?.(unseen);

  assert.equal(hooked.read(), '');
});

test('a context with no instrumented frame writes nothing', async (t) => {
  const hooked = installed(t, { perTest: false });
  const created = await hooked.context();
  created.open(
    hooked.page([hooked.frame({ name: '__noNamespaceHere__' })]).page,
  );

  await created.close();

  assert.equal(hooked.read(), '');
});

test('per-test coverage of a context that outlived its test, or began outside one, counts as shared', async (t) => {
  const hooked = installed(t, { perTest: true });
  hooked.namespace().hitCount = 1;
  hooked.setTest('t1');
  const sameTest = await hooked.context();
  const laterTest = await hooked.context();
  hooked.setTest(undefined);
  const noTest = await hooked.context();

  [sameTest, laterTest, noTest].forEach((created) =>
    created.open(hooked.page().page),
  );

  hooked.setTest('t1');
  await sameTest.close();
  hooked.setTest('t2');
  await laterTest.close();
  hooked.setTest(undefined);
  await noTest.close();

  assert.deepEqual(
    hooked.lines().map((line) => line['outlivedItsTest']),
    [false, true, true],
  );
});

test('a context a beforeAll or afterAll hook opens and closes counts as shared, and its pages name no test', async (t) => {
  const hooked = installed(t, { perTest: true });
  hooked.namespace().hitCount = 1;
  const created: Awaited<ReturnType<typeof hooked.context>>[] = [];

  for (const type of ['beforeAll', 'afterAll'] as const) {
    hooked.setTest('t1', { type });
    const opened = await hooked.context();
    opened.open(hooked.page().page);
    await opened.close();
    created.push(opened);
  }

  assert.deepEqual(
    created.map(({ scripts }) =>
      scripts.map(([, settings]) => settings.testId),
    ),
    [[undefined], [undefined]],
  );
  assert.deepEqual(
    hooked.lines().map((line) => line['outlivedItsTest']),
    [true, true],
  );
});

test("a context a test's own fixture opens belongs to that test", async (t) => {
  const hooked = installed(t, { perTest: true });
  hooked.namespace().hitCount = 1;
  hooked.setTest('t1', { type: 'test', fixture: { title: 'context' } });
  const opened = await hooked.context();
  opened.open(hooked.page().page);
  await opened.close();

  assert.deepEqual(
    opened.scripts.map(([, settings]) => settings.testId),
    ['t1'],
  );
  assert.deepEqual(
    hooked.lines().map((line) => line['outlivedItsTest']),
    [false],
  );
});

test('a context that began outside a test and closes inside one counts as shared', async (t) => {
  const hooked = installed(t, { perTest: true });
  hooked.namespace().hitCount = 1;
  const created = await hooked.context();
  created.open(hooked.page().page);
  hooked.setTest('t1');

  await created.close();

  assert.deepEqual(
    hooked.lines().map((line) => line['outlivedItsTest']),
    [true],
  );
});

test('without per-test coverage no context counts as shared', async (t) => {
  const hooked = installed(t, { perTest: false });
  hooked.namespace().hitCount = 1;
  hooked.setTest('t1');
  const created = await hooked.context();
  created.open(hooked.page().page);
  hooked.setTest('t2');

  await created.close();

  assert.deepEqual(
    hooked.lines().map((line) => line['outlivedItsTest']),
    [false],
  );
});

test('a page closed before its context is read first, once, and closes with its options', async (t) => {
  const hooked = installed(t, { perTest: false });
  hooked.namespace().hitCount = 1;
  const created = await hooked.context();
  const { page, closed } = hooked.page();
  created.open(page);

  await page.close({ reason: 'done' });
  hooked.namespace().hitCount = 2;
  await created.close();

  assert.deepEqual(closed, [{ reason: 'done' }]);
  assert.deepEqual(
    hooked.lines().map((line) => line['hitCount']),
    [1],
  );
});

test('a closing browser first collects every context it holds, and is patched once', async (t) => {
  const hooked = installed(t, { perTest: false });
  hooked.namespace().hitCount = 1;
  const owner = hooked.browser();
  const first = await hooked.context(owner);
  const patched = owner.browser.close;
  const second = await hooked.context(owner);

  assert.equal(owner.browser.close, patched);

  first.open(hooked.page().page);
  second.open(hooked.page().page);

  await owner.browser.close({ reason: 'end' });
  await first.close();

  assert.deepEqual(owner.closed, [{ reason: 'end' }]);
  assert.equal(hooked.lines().length, 2);
});

test('a frame that fails to answer is lost unless it was detached', async (t) => {
  const hooked = installed(t, { perTest: false });
  const created = await hooked.context();
  const failing = () => Promise.reject(new Error('context closed'));
  created.open(
    hooked.page([
      hooked.frame({ evaluate: failing }),
      hooked.frame({ evaluate: failing, detached: true }),
    ]).page,
  );

  await created.close();

  assert.deepEqual(hooked.lines(), [{ lost: true, outlivedItsTest: false }]);
});

test('a frame that does not answer in time is lost', async (t) => {
  const hooked = installed(t, { perTest: false });
  const created = await hooked.context();
  created.open(
    hooked.page([
      hooked.frame({ evaluate: () => new Promise(() => undefined) }),
    ]).page,
  );
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const closing = created.close();
  t.mock.timers.tick(frameReadTimeoutMs - 1);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(hooked.read(), '');

  t.mock.timers.tick(1);
  await closing;

  assert.deepEqual(hooked.lines(), [{ lost: true, outlivedItsTest: false }]);
});

test('a frame that answers leaves no read timer to hold the worker open', async (t) => {
  const hooked = installed(t, { perTest: false });
  const created = await hooked.context();
  created.open(hooked.page().page);
  const timers = () =>
    process.getActiveResourcesInfo().filter((type) => type === 'Timeout')
      .length;
  const before = timers();

  await created.close();

  assert.equal(timers(), before);
});
