import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { before, type TestContext, test } from 'node:test';

import type { Browser, BrowserContext, Frame, Page } from '@playwright/test';
import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';

import type { Instrumentation } from '../src/playwright-internals.ts';
import {
  FRAME_READ_TIMEOUT_MS,
  RUN_SETTINGS,
  type RunSettings,
} from '../src/protocol.ts';
import type * as Hook from '../src/worker-hook.ts';
import type { NodeNamespace, PageSettings } from '../src/worker-hook.ts';

const ACTIVE_MUTANT = INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE;

let hook: typeof Hook;

// The hook installs at import when its gate opens, so a mutant that breaks the gate fails in a test.
before(async () => {
  hook = await import('../src/worker-hook.ts');
});

// Records a worker's namespace with fake I/O; `exit()` runs what the worker does at process exit.
function worker(
  settings: { perTest: boolean; hitLimit?: number },
  testId?: () => string | undefined,
) {
  const ns: NodeNamespace = {};
  const lines: string[] = [];
  const listeners: (() => void)[] = [];
  hook.recordNodeCoverage(
    ns,
    settings,
    testId ?? (() => undefined),
    (line) => lines.push(line),
    (listener) => listeners.push(listener),
  );

  return {
    ns,
    lines,
    exit: () => listeners.forEach((listener) => listener()),
  };
}

test('a Playwright worker outside a Stryker run loads the hook and installs nothing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'worker-hook-test-'));

  try {
    // A path that ends like Playwright's worker entry, so only the run-settings check keeps the hook out.
    const entry = path.join(dir, 'playwright/lib/worker/workerProcessEntry.js');
    mkdirSync(path.dirname(entry), { recursive: true });
    writeFileSync(entry, `console.log('entry ran');`);

    // An install without run settings throws at import, before the entry runs.
    const child = spawnSync(
      process.execPath,
      [
        '--import',
        new URL('../src/worker-hook.ts', import.meta.url).href,
        entry,
      ],
      {
        encoding: 'utf8',
        // The child keeps NODE_OPTIONS: under Stryker, the test runner's preload there reports the
        // coverage the gate makes in the child.
        env: { ...process.env, [RUN_SETTINGS]: undefined },
      },
    );

    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), 'entry ran');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('during a run the hook installs in the main thread of a Playwright worker, not in its threads', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'worker-hook-gate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const files: Record<string, string> = {
    'node_modules/playwright/test.js':
      'exports.test = { info() { throw new Error("no test"); } };',
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
  };

  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  }

  const outDir = path.join(dir, 'out');
  mkdirSync(outDir);

  const child = spawnSync(
    process.execPath,
    [
      '--import',
      new URL('../src/worker-hook.ts', import.meta.url).href,
      path.join(dir, 'playwright/lib/worker/workerProcessEntry.js'),
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        [RUN_SETTINGS]: JSON.stringify({ outDir, perTest: false }),
      },
    },
  );

  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), 'main');
  assert.equal(readdirSync(outDir).length, 1);
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
    lines.map((line) => JSON.parse(line)),
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
  const { ns } = worker({ perTest: true }, () => running);

  assert.equal(ns.currentTestId, 'test-a');

  running = undefined;

  assert.equal(ns.currentTestId, undefined);
});

test('without per-test coverage no test id is set', () => {
  const { ns } = worker({ perTest: false }, () => 'test-a');

  assert.equal(ns.currentTestId, undefined);
});

test('with a hit limit the worker counts hits from zero and writes the count at exit', () => {
  const { ns, lines, exit } = worker({ perTest: false, hitLimit: 10 });

  assert.equal(ns.hitLimit, 10);
  assert.equal(ns.hitCount, 0);

  ns.hitCount = 4;
  exit();

  assert.deepEqual(
    lines.map((line) => JSON.parse(line)),
    [{ hitCount: 4, outlivedItsTest: false }],
  );
});

test('a worker past its hit limit writes its count at once, and not again at exit', () => {
  const { ns, lines, exit } = worker({ perTest: false, hitLimit: 10 });

  ns.hitCount = 10;

  assert.deepEqual(lines, []);

  ns.hitCount = 11;

  assert.deepEqual(
    lines.map((line) => JSON.parse(line)),
    [{ hitCount: 11, outlivedItsTest: false }],
  );

  ns.hitCount = 12;
  exit();

  assert.equal(lines.length, 1);
});

test('a write that fails at exit does not throw out of the exit listener', () => {
  const ns: NodeNamespace = {};
  const listeners: (() => void)[] = [];
  hook.recordNodeCoverage(
    ns,
    { perTest: false },
    () => undefined,
    () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    (listener) => listeners.push(listener),
  );
  ns.mutantCoverage = { static: { '1': 1 }, perTest: {} };

  assert.doesNotThrow(() => listeners.forEach((listener) => listener()));
});

test('without a hit limit the worker counts no hits', () => {
  const { ns } = worker({ perTest: true });

  assert.equal(ns.hitCount, undefined);
  assert.equal(ns.hitLimit, undefined);
});

// --- install, against a fake Playwright in this process ---

type Listener = Parameters<Instrumentation['addListener']>[0];

interface FakeFrame {
  /** The global name the frame's namespace has; undefined reads the name the hook asks for. */
  name?: string;
  evaluate?: (fn: (name: string) => unknown, name: string) => Promise<unknown>;
  detached?: boolean;
}

/**
 * Installs the hook with a fake Playwright and a namespace no other code in this process uses. The
 * namespace stands in for the worker's and for every fake page's, since the fake frames read it here.
 */
function installed(
  t: TestContext,
  settings: Omit<RunSettings, 'outDir'>,
  {
    activeMutant,
    prepare,
  }: {
    activeMutant?: string;
    /** Runs before install, as the worker's earlier code would. */
    prepare?: (outDir: string, ns: string) => void;
  } = {},
) {
  const ns = `__hookTest${Math.random().toString(36).slice(2)}__`;
  const outDir = mkdtempSync(path.join(tmpdir(), 'worker-hook-install-'));
  const scope = globalThis as unknown as Record<
    string,
    NodeNamespace & Record<string, unknown>
  >;
  prepare?.(outDir, ns);
  const exitListeners = process.listeners('exit');
  const previousMutant = process.env[ACTIVE_MUTANT];
  let running: string | undefined;
  let listener: Listener | undefined;
  const test = {
    info: () => {
      if (running === undefined) {
        throw new Error(
          'test.info() can only be called while a test is running',
        );
      }

      return { testId: running };
    },
  };
  const modules: Record<string, unknown> = {
    'playwright/test': { test },
    'playwright-core': {
      _instrumentation: {
        addListener: (added: Listener) => {
          listener = added;
        },
      },
    },
  };

  if (activeMutant === undefined) {
    delete process.env[ACTIVE_MUTANT];
  } else {
    process.env[ACTIVE_MUTANT] = activeMutant;
  }

  try {
    hook.install(
      ((id: string) => modules[id]) as NodeJS.Require,
      { outDir, ...settings },
      ns,
    );
  } finally {
    if (previousMutant === undefined) {
      delete process.env[ACTIVE_MUTANT];
    } else {
      process.env[ACTIVE_MUTANT] = previousMutant;
    }
  }

  const added = process
    .listeners('exit')
    .filter((exit) => !exitListeners.includes(exit));
  t.after(() => {
    added.forEach((exit) => process.off('exit', exit));
    delete scope[ns];
    rmSync(outDir, { recursive: true, force: true });
  });

  assert.ok(listener);
  const hooks = listener;

  function frame({ name, evaluate, detached = false }: FakeFrame = {}): Frame {
    return {
      evaluate: (fn: (name: string) => unknown, asked: string) =>
        evaluate ? evaluate(fn, asked) : Promise.resolve(fn(name ?? asked)),
      isDetached: () => detached,
    } as unknown as Frame;
  }

  function page(frames: Frame[] = [frame()]) {
    const closed: unknown[] = [];
    const fake = {
      frames: () => frames,
      close: async (options?: unknown) => {
        closed.push(options);
      },
    };

    return { page: fake as unknown as Page, closed };
  }

  function browser() {
    const contexts: BrowserContext[] = [];
    const closed: unknown[] = [];
    const fake = {
      contexts: () => contexts,
      close: async (options?: unknown) => {
        closed.push(options);
      },
    };

    return { browser: fake as unknown as Browser, contexts, closed };
  }

  /** A context as Playwright creates it, which the hook sees through the instrumentation. */
  async function context(owner: ReturnType<typeof browser> | null = null) {
    const pages: Page[] = [];
    const onPage: ((page: Page) => void)[] = [];
    const scripts: [unknown, PageSettings][] = [];
    const events: string[] = [];
    const fake = {
      pages: () => pages,
      browser: () => owner?.browser ?? null,
      on: (event: string, handler: (page: Page) => void) => {
        events.push(event);
        onPage.push(handler);
      },
      addInitScript: async (script: unknown, arg: PageSettings) => {
        scripts.push([script, arg]);
      },
    };
    const created = fake as unknown as BrowserContext;
    owner?.contexts.push(created);
    await hooks.runAfterCreateBrowserContext?.(created);

    return {
      context: created,
      scripts,
      events,
      open: (opened: Page) => {
        pages.push(opened);
        onPage.forEach((handler) => handler(opened));
      },
      close: () => hooks.runBeforeCloseBrowserContext?.(created),
    };
  }

  return {
    ns,
    scope,
    hooks,
    read: () =>
      readFileSync(path.join(outDir, `worker-${process.pid}.ndjson`), 'utf8'),
    setTest: (id: string | undefined) => {
      running = id;
    },
    exitListeners: added,
    frame,
    page,
    browser,
    context,
  };
}

function parsedLines(content: string) {
  return content
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test('install creates the worker snapshot file at once', (t) => {
  assert.equal(installed(t, { perTest: false }).read(), '');
});

test('install keeps what an earlier worker with the same pid wrote', (t) => {
  const hooked = installed(
    t,
    { perTest: false },
    {
      prepare: (outDir) =>
        writeFileSync(
          path.join(outDir, `worker-${process.pid}.ndjson`),
          '{"earlier":true}\n',
        ),
    },
  );

  assert.equal(hooked.read(), '{"earlier":true}\n');
});

test("install counts the worker's own hits in its namespace and writes them past the limit", (t) => {
  const hooked = installed(t, { perTest: false, hitLimit: 2 });

  hooked.scope[hooked.ns].hitCount = 3;

  assert.equal(hooked.read(), '\n{"hitCount":3,"outlivedItsTest":false}\n');
});

test("install keeps a namespace the worker's instrumented code made first", (t) => {
  const first: NodeNamespace = { mutantCoverage: { static: {}, perTest: {} } };
  const hooked = installed(
    t,
    { perTest: true },
    {
      prepare: (_, ns) => {
        (globalThis as unknown as Record<string, unknown>)[ns] = first;
      },
    },
  );
  hooked.setTest('t1');

  assert.equal(hooked.scope[hooked.ns], first);
  assert.equal(first.currentTestId, 't1');
});

test("the worker's namespace names the running Playwright test, and none between tests", (t) => {
  const hooked = installed(t, { perTest: true });

  hooked.setTest('t1');

  assert.equal(hooked.scope[hooked.ns].currentTestId, 't1');

  hooked.setTest(undefined);

  assert.equal(hooked.scope[hooked.ns].currentTestId, undefined);
});

test('at exit the worker writes its Node coverage to its snapshot file', (t) => {
  const hooked = installed(t, { perTest: false });
  hooked.scope[hooked.ns].mutantCoverage = { static: { '1': 1 }, perTest: {} };

  hooked.exitListeners.forEach((exit) => exit(0));

  assert.deepEqual(parsedLines(hooked.read()), [
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

  assert.deepEqual(scripts[0][1], {
    ns: hooked.ns,
    activeMutant: undefined,
    testId: undefined,
    hitLimit: undefined,
  });
});

test('a closing context writes what each frame of each page holds, as one line per frame', async (t) => {
  const hooked = installed(t, { perTest: true });
  hooked.setTest('t1');
  hooked.scope[hooked.ns].mutantCoverage = {
    static: {},
    perTest: { t1: { '1': 1 } },
  };
  hooked.scope[hooked.ns].hitCount = 5;
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
    '\n' +
      [frameLine, frameLine].map((line) => JSON.stringify(line)).join('\n') +
      '\n',
  );
});

test('a context closes into the snapshot file once', async (t) => {
  const hooked = installed(t, { perTest: false });
  hooked.scope[hooked.ns].hitCount = 1;
  const created = await hooked.context();
  const { page } = hooked.page();
  created.open(page);
  await page.close();

  await created.close();
  await created.close();

  assert.equal(parsedLines(hooked.read()).length, 1);
});

test('a context the hook never saw created writes nothing', async (t) => {
  const hooked = installed(t, { perTest: false });
  hooked.scope[hooked.ns].hitCount = 1;
  const unseen = {
    pages: () => [hooked.page().page],
  } as unknown as BrowserContext;

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
  hooked.scope[hooked.ns].hitCount = 1;
  hooked.setTest('t1');
  const sameTest = await hooked.context();
  const laterTest = await hooked.context();
  hooked.setTest(undefined);
  const noTest = await hooked.context();

  for (const created of [sameTest, laterTest, noTest]) {
    created.open(hooked.page().page);
  }

  hooked.setTest('t1');
  await sameTest.close();
  hooked.setTest('t2');
  await laterTest.close();
  hooked.setTest(undefined);
  await noTest.close();

  assert.deepEqual(
    parsedLines(hooked.read()).map((line) => line.outlivedItsTest),
    [false, true, true],
  );
});

test('a context that began outside a test and closes inside one counts as shared', async (t) => {
  const hooked = installed(t, { perTest: true });
  hooked.scope[hooked.ns].hitCount = 1;
  const created = await hooked.context();
  created.open(hooked.page().page);
  hooked.setTest('t1');

  await created.close();

  assert.deepEqual(parsedLines(hooked.read())[0].outlivedItsTest, true);
});

test('without per-test coverage no context counts as shared', async (t) => {
  const hooked = installed(t, { perTest: false });
  hooked.scope[hooked.ns].hitCount = 1;
  hooked.setTest('t1');
  const created = await hooked.context();
  created.open(hooked.page().page);
  hooked.setTest('t2');

  await created.close();

  assert.equal(parsedLines(hooked.read())[0].outlivedItsTest, false);
});

test('a page closed before its context is read first, once, and closes with its options', async (t) => {
  const hooked = installed(t, { perTest: false });
  hooked.scope[hooked.ns].hitCount = 1;
  const created = await hooked.context();
  const { page, closed } = hooked.page();
  created.open(page);

  await page.close({ reason: 'done' });
  hooked.scope[hooked.ns].hitCount = 2;
  await created.close();

  assert.deepEqual(closed, [{ reason: 'done' }]);
  assert.deepEqual(
    parsedLines(hooked.read()).map((line) => line.hitCount),
    [1],
  );
});

test('a closing browser first collects every context it holds, and is patched once', async (t) => {
  const hooked = installed(t, { perTest: false });
  hooked.scope[hooked.ns].hitCount = 1;
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
  assert.equal(parsedLines(hooked.read()).length, 2);
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

  assert.deepEqual(parsedLines(hooked.read()), [
    { lost: true, outlivedItsTest: false },
  ]);
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
  t.mock.timers.tick(FRAME_READ_TIMEOUT_MS - 1);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(hooked.read(), '');

  t.mock.timers.tick(1);
  await closing;

  assert.deepEqual(parsedLines(hooked.read()), [
    { lost: true, outlivedItsTest: false },
  ]);
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

// --- initPage, in a fake page ---

interface FakePage {
  top?: boolean;
  carried?: string | null;
  storageThrows?: boolean;
}

/** Runs the init script with the page globals it uses, and returns the namespace and storage it left. */
function pageRun(
  t: TestContext,
  settings: Omit<PageSettings, 'ns'>,
  { top = true, carried = null, storageThrows = false }: FakePage = {},
) {
  const ns = `__pageTest${Math.random().toString(36).slice(2)}__`;
  const stored = new Map<string, string>();
  const listeners: [string, () => void][] = [];

  if (carried !== null) {
    stored.set(`${ns}:carry`, carried);
  }

  const win: { top?: unknown } = {};
  win.top = top ? win : {};
  const globals: Record<string, unknown> = {
    window: win,
    sessionStorage: {
      getItem: (key: string) => {
        if (storageThrows) {
          throw new Error('SecurityError');
        }

        return stored.get(key) ?? null;
      },
      setItem: (key: string, value: string) => stored.set(key, value),
    },
    addEventListener: (event: string, listener: () => void) =>
      listeners.push([event, listener]),
  };
  const saved = Object.keys(globals).map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  const scope = globalThis as unknown as Record<
    string,
    Record<string, unknown>
  >;
  t.after(() => {
    delete scope[ns];
  });

  // The page globals exist only while page code runs, so nothing else in this process sees them.
  function inPage(run: () => void) {
    for (const [name, value] of Object.entries(globals)) {
      Object.defineProperty(globalThis, name, {
        value,
        configurable: true,
        writable: true,
      });
    }

    try {
      run();
    } finally {
      for (const [name, descriptor] of saved) {
        if (descriptor) {
          Object.defineProperty(globalThis, name, descriptor);
        } else {
          delete (globalThis as Record<string, unknown>)[name];
        }
      }
    }
  }

  inPage(() => hook.initPage({ ns, ...settings }));

  return {
    ns,
    s: scope[ns],
    stored,
    listeners,
    fire: (event: string) =>
      inPage(() =>
        listeners
          .filter(([name]) => name === event)
          .forEach(([, listener]) => listener()),
      ),
  };
}

test('the init script sets the mutant, the test and a zeroed hit count in the page namespace', (t) => {
  const { s } = pageRun(t, { activeMutant: '3', testId: 't1', hitLimit: 7 });

  assert.deepEqual(
    { ...s },
    {
      activeMutant: '3',
      hitLimit: 7,
      hitCount: 0,
      currentTestId: 't1',
    },
  );
});

test('the init script sets nothing it was not given', (t) => {
  const { s } = pageRun(t, {});

  assert.deepEqual({ ...s }, {});
});

test('the init script keeps a namespace the page already has', (t) => {
  const ns = '__pageTestExisting__';
  const existing = { kept: true };
  const scope = globalThis as unknown as Record<string, unknown>;
  scope[ns] = existing;
  t.after(() => {
    delete scope[ns];
  });
  const win: { top?: unknown } = {};
  win.top = {};
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
    writable: true,
  });

  try {
    hook.initPage({ ns, testId: 't1' });
  } finally {
    delete (globalThis as Record<string, unknown>).window;
  }

  assert.equal(scope[ns], existing);
  assert.deepEqual(existing, { kept: true, currentTestId: 't1' });
});

test('a child frame carries nothing across navigations', (t) => {
  const { s, listeners } = pageRun(
    t,
    { hitLimit: 7 },
    {
      top: false,
      carried: '{"mutantCoverage":{"static":{"1":1}},"hitCount":4}',
    },
  );

  assert.deepEqual({ ...s }, { hitLimit: 7, hitCount: 0 });
  assert.deepEqual(listeners, []);
});

test('the top frame takes over the coverage and hit count the last page left', (t) => {
  const { s } = pageRun(
    t,
    { hitLimit: 7 },
    { carried: '{"mutantCoverage":{"static":{"1":1}},"hitCount":4}' },
  );

  assert.deepEqual(
    { ...s },
    {
      hitLimit: 7,
      hitCount: 4,
      mutantCoverage: { static: { '1': 1 } },
    },
  );
});

test('a carried page without a hit count starts from zero, and without a hit limit counts nothing', (t) => {
  const limited = pageRun(
    t,
    { hitLimit: 7 },
    { carried: '{"mutantCoverage":{}}' },
  );
  const unlimited = pageRun(
    t,
    {},
    { carried: '{"mutantCoverage":{},"hitCount":4}' },
  );

  assert.equal(limited.s.hitCount, 0);
  assert.equal(unlimited.s.hitCount, undefined);
  assert.equal(Object.hasOwn(unlimited.s, 'hitCount'), false);
});

test('a first page carries nothing in', (t) => {
  const { s } = pageRun(t, {});

  assert.equal(Object.hasOwn(s, 'mutantCoverage'), false);
});

test('the top frame stores its coverage and hit count when the page goes away', (t) => {
  const { ns, s, stored, listeners, fire } = pageRun(t, { hitLimit: 7 });
  s.mutantCoverage = { static: { '2': 1 } };
  s.hitCount = 3;

  assert.deepEqual(
    listeners.map(([event]) => event),
    ['pagehide'],
  );

  fire('pagehide');

  assert.equal(
    stored.get(`${ns}:carry`),
    '{"mutantCoverage":{"static":{"2":1}},"hitCount":3}',
  );
});

test('a page without session storage still gets its namespace', (t) => {
  const { s } = pageRun(t, { testId: 't1' }, { storageThrows: true });

  assert.deepEqual({ ...s }, { currentTestId: 't1' });
});
