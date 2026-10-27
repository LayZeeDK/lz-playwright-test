import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isMainThread } from 'node:worker_threads';

import type {
  Browser,
  BrowserContext,
  Frame,
  Page,
  TestInfo,
  TestType,
} from '@playwright/test';
import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';

import {
  instrumentationOf,
  isRecord,
  runningSlotOf,
  type SlotType,
  WORKER_ENTRY,
} from './playwright-internals.ts';
import {
  FRAME_READ_TIMEOUT_MS,
  readRunSettings,
  type RunSettings,
  serializeSnapshot,
  SNAPSHOT_SUFFIX,
  type SnapshotLine,
} from './protocol.ts';

type FrameRead = Omit<SnapshotLine, 'outlivedItsTest'>;

interface ContextState {
  testId?: string | undefined;
  closedPageSnapshots: FrameRead[];
  collected: boolean;
}

export interface PageSettings {
  ns: string;
  activeMutant?: string | undefined;
  testId?: string | undefined;
  hitLimit?: number | undefined;
}

type Test = Pick<TestType<object, object>, 'info'>;

/** The `test` of playwright/test; the check covers that `test.info` is a function, not what it returns. */
function testOf(playwrightTest: unknown): Test {
  const test = isRecord(playwrightTest) ? playwrightTest.test : undefined;

  if (!hasInfo(test)) {
    throw new Error(
      'The worker hook needs test.info() from playwright/test, which tells it the test that runs.',
    );
  }

  return test;
}

function hasInfo(value: unknown): value is Test {
  return (
    (typeof value === 'function' || isRecord(value)) &&
    typeof Reflect.get(value, 'info') === 'function'
  );
}

// Undefined under `node -e`, which a worker's NODE_OPTIONS can reach; RegExp.test reads it as "undefined".
const entry = process.argv[1];
const settings = readRunSettings(process.env);
// `Symbol.for`, so a second copy of this package in the worker, from another install, sees the mark
// of the first and leaves the worker's coverage to it.
const INSTALLED: unique symbol = Symbol.for(
  '@layzee/lz-stryker-playwright-runner/worker-hook',
);

if (
  settings &&
  isMainThread &&
  WORKER_ENTRY.test(entry) &&
  !(INSTALLED in globalThis)
) {
  Reflect.set(globalThis, INSTALLED, INSTALLED);
  install(createRequire(entry), settings);
}

export function install(
  playwrightRequire: NodeJS.Require,
  { outDir, perTest, hitLimit }: RunSettings,
  ns: string = INSTRUMENTER_CONSTANTS.NAMESPACE,
): void {
  const test = testOf(playwrightRequire('playwright/test'));
  const instrumentation = instrumentationOf(
    playwrightRequire('playwright-core'),
  );
  const activeMutant =
    process.env[INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE];
  const outFile = path.join(
    outDir,
    `worker-${process.pid}-${randomUUID()}${SNAPSHOT_SUFFIX}`,
  );
  const contexts = new WeakMap<BrowserContext, ContextState>();
  const alreadyRead = new WeakSet<Page>();
  const patchedBrowsers = new WeakSet<Browser>();

  fs.writeFileSync(outFile, '');
  recordNodeCoverage(
    workerNamespace(ns),
    { perTest, hitLimit },
    () => nodeTestId(test),
    (line) => fs.appendFileSync(outFile, line + '\n'),
  );

  // Closing a page that owns its context closes the context first, so the same page can come up twice.
  function readOnce(pages: Page[]): Promise<FrameRead[]> {
    const fresh = pages.filter((page) => !alreadyRead.has(page));
    fresh.forEach((page) => alreadyRead.add(page));

    return readPages(fresh, ns);
  }

  async function collect(context: BrowserContext) {
    const state = contexts.get(context);

    if (!state || state.collected) {
      return;
    }

    state.collected = true;
    const snapshots = [
      ...state.closedPageSnapshots,
      ...(await readOnce(context.pages())),
    ];
    const outlivedItsTest =
      perTest &&
      (state.testId === undefined || state.testId !== contextTestId(test));
    const lines = snapshots.map((snapshot) =>
      serializeSnapshot({ ...snapshot, outlivedItsTest }),
    );

    if (lines.length) {
      fs.appendFileSync(outFile, lines.join('\n') + '\n');
    }
  }

  // browser.close(), and page.close() on a page whose context stays open, skip the before-close hook for
  // what they close, so read first.
  function collectBeforePageCloses(state: ContextState, page: Page) {
    const close = page.close.bind(page);
    page.close = async (options) => {
      state.closedPageSnapshots.push(...(await readOnce([page])));

      return close(options);
    };
  }

  function collectBeforeBrowserCloses(browser: Browser | null) {
    if (!browser || patchedBrowsers.has(browser)) {
      return;
    }

    patchedBrowsers.add(browser);
    const close = browser.close.bind(browser);
    browser.close = async (options) => {
      await Promise.all(browser.contexts().map(collect));

      return close(options);
    };
  }

  instrumentation.addListener({
    async runAfterCreateBrowserContext(context) {
      const state: ContextState = {
        testId: perTest ? contextTestId(test) : undefined,
        closedPageSnapshots: [],
        collected: false,
      };
      contexts.set(context, state);
      collectBeforeBrowserCloses(context.browser());
      context.on('page', (page) => collectBeforePageCloses(state, page));
      await context.addInitScript(initPage, {
        ns,
        activeMutant,
        testId: state.testId,
        hitLimit,
      } satisfies PageSettings);
    },
    runBeforeCloseBrowserContext: collect,
  });
}

/**
 * The global that Stryker's instrumented code and this hook share, in the worker and in every page.
 * Instrumented code may create it first, so each field claims nothing.
 */
export interface StrykerNamespace {
  activeMutant?: unknown;
  currentTestId?: unknown;
  mutantCoverage?: unknown;
  hitCount?: unknown;
  hitLimit?: unknown;
}

function workerNamespace(name: string): StrykerNamespace {
  const scope: Record<string, unknown> = globalThis;
  const found = scope[name];

  if (isRecord(found)) {
    return found;
  }

  const created: StrykerNamespace = {};
  scope[name] = created;

  return created;
}

export function recordNodeCoverage(
  ns: StrykerNamespace,
  { perTest, hitLimit }: { perTest: boolean; hitLimit?: number | undefined },
  currentTestId: () => string | undefined,
  write: (line: string) => void,
  onExit: (listener: () => void) => void = (listener) => {
    process.on('exit', listener);
  },
): void {
  let written = false;
  const writeOnce = () => {
    written = true;

    // After a failure that reaches maxFailures the runner may have read and removed the run's
    // directory already. A throw in an exit listener keeps Playwright's worker from exiting until
    // its 5-minute force-kill, so a write with nowhere to go is dropped.
    try {
      write(
        serializeSnapshot({
          mutantCoverage: ns.mutantCoverage,
          hitCount: ns.hitCount,
          outlivedItsTest: false,
        }),
      );
    } catch {
      // Dropped, as above.
    }
  };

  if (hitLimit !== undefined) {
    let hits = 0;
    ns.hitLimit = hitLimit;
    Object.defineProperty(ns, 'hitCount', {
      get: () => hits,
      set: (value: number) => {
        hits = value;

        if (hits > hitLimit && !written) {
          writeOnce();
        }
      },
    });
  }

  if (perTest) {
    Object.defineProperty(ns, 'currentTestId', { get: currentTestId });
  }

  onExit(() => {
    if (written || (ns.mutantCoverage === undefined && !ns.hitCount)) {
      return;
    }

    writeOnce();
  });
}

// Playwright makes a test current before it runs the beforeAll hooks and sets up the fixtures it
// needs, so test.info() alone names the first test of a group for code that serves the whole group.
// Fixtures differ between the two rules: Node code cannot tell a worker fixture from a test's own, so
// it counts for no test, while a context a fixture opens is checked again at close (outlivedItsTest).
const PER_TEST_SLOTS: ReadonlySet<SlotType> = new Set([
  'test',
  'beforeEach',
  'afterEach',
]);
const GROUP_HOOKS: ReadonlySet<SlotType> = new Set(['beforeAll', 'afterAll']);

/** The test that Node code running now belongs to: none in a beforeAll or afterAll hook or a fixture. */
function nodeTestId(test: Test): string | undefined {
  const info = testInfoOf(test);

  if (info === undefined) {
    return undefined;
  }

  const slot = runningSlotOf(info, info.config.version);

  return slot && !slot.inFixture && PER_TEST_SLOTS.has(slot.type)
    ? info.testId
    : undefined;
}

/**
 * The test a context opened or closed now belongs to: none in a beforeAll or afterAll hook. A fixture's
 * context, a worker fixture's too, gets the current test until it outlives that test.
 */
function contextTestId(test: Test): string | undefined {
  const info = testInfoOf(test);
  const type = info && runningSlotOf(info, info.config.version)?.type;

  return type !== undefined && GROUP_HOOKS.has(type) ? undefined : info?.testId;
}

function testInfoOf(test: Test): TestInfo | undefined {
  try {
    return test.info();
  } catch {
    return undefined;
  }
}

async function readPages(pages: Page[], ns: string): Promise<FrameRead[]> {
  const snapshots = await Promise.all(
    pages
      .flatMap((page) => page.frames())
      .map((frame) => readNamespace(frame, ns)),
  );

  return snapshots.filter((snapshot) => snapshot !== undefined);
}

async function readNamespace(
  frame: Frame,
  ns: string,
): Promise<FrameRead | undefined> {
  const { promise: lost, resolve } = Promise.withResolvers<FrameRead>();
  const timer = setTimeout(
    () => resolve({ lost: true }),
    FRAME_READ_TIMEOUT_MS,
  );
  const read = frame
    .evaluate((name) => {
      const scope: Record<string, unknown> = globalThis;
      const found = scope[name];

      if (typeof found !== 'object' || found === null) {
        return undefined;
      }

      const { mutantCoverage, hitCount }: StrykerNamespace = found;

      return { mutantCoverage, hitCount };
    }, ns)
    .catch(() =>
      frame.isDetached() ? undefined : ({ lost: true } satisfies FrameRead),
    );

  try {
    return await Promise.race([read, lost]);
  } finally {
    clearTimeout(timer);
  }
}

export function initPage({
  ns,
  activeMutant,
  testId,
  hitLimit,
}: PageSettings): void {
  const scope: Record<string, unknown> = globalThis;
  const found = scope[ns];
  const s: StrykerNamespace =
    typeof found === 'object' && found !== null ? found : (scope[ns] = {});
  const key = `${ns}:carry`;

  if (activeMutant !== undefined) {
    s.activeMutant = activeMutant;
  }

  if (hitLimit !== undefined) {
    s.hitLimit = hitLimit;
    s.hitCount = 0;
  }

  if (testId !== undefined) {
    s.currentTestId = testId;
  }

  if (window.top !== window) {
    return;
  }

  try {
    const carried: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null');

    if (typeof carried === 'object' && carried !== null) {
      const { mutantCoverage, hitCount }: StrykerNamespace = carried;
      s.mutantCoverage = mutantCoverage;

      if (hitLimit !== undefined) {
        s.hitCount = hitCount ?? 0;
      }
    }

    addEventListener('pagehide', () => {
      sessionStorage.setItem(
        key,
        JSON.stringify({
          mutantCoverage: s.mutantCoverage,
          hitCount: s.hitCount,
        }),
      );
    });
  } catch {
    // Opaque origins (about:blank, data: URLs) have no sessionStorage.
  }
}
