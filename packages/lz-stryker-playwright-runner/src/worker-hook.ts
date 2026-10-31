import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isMainThread } from 'node:worker_threads';

import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';

import { fieldOf, isRecord } from './is-record.ts';
import {
  type HookedBrowser,
  type HookedContext,
  type HookedFrame,
  type HookedPage,
  instrumentationOf,
  type RunningSlot,
  runningSlotOf,
  type SlotType,
  workerEntry,
} from './playwright-internals.ts';
import {
  frameReadTimeoutMs,
  installErrorSuffix,
  readRunSettings,
  type RunSettings,
  serializeSnapshot,
  snapshotSuffix,
  type SnapshotLine,
} from './protocol.ts';

type FrameRead = Omit<SnapshotLine, 'outlivedItsTest'>;

interface FrameReads extends ReadonlyArray<FrameRead> {
  push(...items: FrameRead[]): number;
}

interface ContextState {
  readonly testId?: string | undefined;
  readonly closedPageSnapshots: FrameReads;
}

type Writable<T> = { -readonly [K in keyof T]: T[K] };

export interface PageSettings extends Pick<RunSettings, 'hitLimit'> {
  readonly ns: string;
  readonly activeMutant?: string | undefined;
  readonly testId?: string | undefined;
}

interface RunningTest {
  readonly testId: string;
  readonly slot: RunningSlot | undefined;
}

/** The test that runs now, read through test.info(); undefined while none runs. */
type CurrentTest = () => RunningTest | undefined;

// Playwright's `test` is a function, and playwright/test exports that function as the module itself.
function memberOf(value: unknown, key: string): unknown {
  return typeof value === 'function' || isRecord(value)
    ? Reflect.get(value, key)
    : undefined;
}

/** Reads test.info() of playwright/test's `test`, and parses what it returns. */
function currentTestOf(playwrightTest: unknown): CurrentTest {
  const test = memberOf(playwrightTest, 'test');
  const info = memberOf(test, 'info');

  if (typeof info !== 'function') {
    throw new Error(
      'The worker hook needs test.info() from playwright/test, which tells it the test that runs.',
    );
  }

  return () => {
    let found: unknown;

    try {
      found = info.call(test);
    } catch {
      // test.info() throws while no test runs.
      return undefined;
    }

    const version = fieldOf(fieldOf(found, 'config'), 'version');

    if (
      !isRecord(found) ||
      typeof found['testId'] !== 'string' ||
      typeof version !== 'string'
    ) {
      throw new Error(
        "The worker hook needs test.info() from playwright/test to return the running test's testId and config.version.",
      );
    }

    return { testId: found['testId'], slot: runningSlotOf(found, version) };
  };
}

// Undefined under `node -e`, which a worker's NODE_OPTIONS can reach.
const entry = process.argv[1];
const settings = readRunSettings(process.env);
// `Symbol.for`, so a second copy of this package in the worker, from another install, sees the mark
// of the first and leaves the worker's coverage to it.
const installed: unique symbol = Symbol.for(
  '@layzee/lz-stryker-playwright-runner/worker-hook',
);

if (
  settings &&
  isMainThread &&
  entry !== undefined &&
  workerEntry.test(entry) &&
  !(installed in globalThis)
) {
  Reflect.set(globalThis, installed, installed);

  try {
    install(createRequire(entry), settings);
  } catch (error) {
    try {
      fs.writeFileSync(
        path.join(
          settings.outDir,
          `worker-${process.pid}${installErrorSuffix}`,
        ),
        String(error),
      );
    } catch {
      // The worker still exits with the install error; the run then reports only a crashed worker.
    }

    throw error;
  }
}

export function install(
  playwrightRequire: (id: string) => unknown,
  { outDir, perTest, hitLimit }: RunSettings,
  ns: string = INSTRUMENTER_CONSTANTS.NAMESPACE,
): void {
  const test = currentTestOf(playwrightRequire('playwright/test'));
  const instrumentation = instrumentationOf(
    playwrightRequire('playwright-core'),
  );
  const activeMutant =
    process.env[INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE];
  const outFile = path.join(
    outDir,
    `worker-${process.pid}-${randomUUID()}${snapshotSuffix}`,
  );
  const contexts = new WeakMap<HookedContext, ContextState>();
  const collected = new WeakSet<HookedContext>();
  const alreadyRead = new WeakSet<HookedPage>();
  const patchedBrowsers = new WeakSet<HookedBrowser>();

  fs.writeFileSync(outFile, '');
  recordNodeCoverage(
    workerNamespace(ns),
    { perTest, hitLimit },
    () => nodeTestId(test),
    (line) => fs.appendFileSync(outFile, line + '\n'),
  );

  // Closing a page that owns its context closes the context first, so the same page can come up twice.
  function readOnce(pages: HookedPage[]): Promise<FrameRead[]> {
    const fresh = pages.filter((page) => !alreadyRead.has(page));
    fresh.forEach((page) => alreadyRead.add(page));

    return readPages(fresh, ns);
  }

  async function collect(context: HookedContext) {
    const state = contexts.get(context);

    if (!state || collected.has(context)) {
      return;
    }

    collected.add(context);
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
  function collectBeforePageCloses(state: ContextState, page: HookedPage) {
    const close = page.close.bind(page);
    page.close = async (options) => {
      state.closedPageSnapshots.push(...(await readOnce([page])));

      return close(options);
    };
  }

  function collectBeforeBrowserCloses(browser: HookedBrowser | null) {
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
export type StrykerNamespace = Writable<StrykerNamespaceFields>;

interface StrykerNamespaceFields {
  readonly activeMutant?: unknown;
  readonly currentTestId?: unknown;
  readonly mutantCoverage?: unknown;
  readonly hitCount?: unknown;
  readonly hitLimit?: unknown;
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
  { perTest, hitLimit }: Pick<RunSettings, 'perTest' | 'hitLimit'>,
  currentTestId: () => string | undefined,
  write: (line: string) => void,
  onExit: (listener: () => void) => void = (listener) => {
    process.on('exit', listener);
  },
): void {
  let written = false;
  const writeOnce = () => {
    if (written) {
      return;
    }

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

        if (hits > hitLimit) {
          writeOnce();
        }
      },
    });
  }

  if (perTest) {
    Object.defineProperty(ns, 'currentTestId', { get: currentTestId });
  }

  onExit(() => {
    if (ns.mutantCoverage === undefined && !ns.hitCount) {
      return;
    }

    writeOnce();
  });
}

// Playwright makes a test current before it runs the beforeAll hooks and sets up the fixtures it
// needs, so test.info() alone names the first test of a group for code that serves the whole group.
// Fixtures differ between the two rules: Node code cannot tell a worker fixture from a test's own, so
// it counts for no test, while a context a fixture opens is checked again at close (outlivedItsTest).
const perTestSlots: ReadonlySet<SlotType> = new Set([
  'test',
  'beforeEach',
  'afterEach',
]);
const groupHooks: ReadonlySet<SlotType> = new Set(['beforeAll', 'afterAll']);

/** The test that Node code running now belongs to: none in a beforeAll or afterAll hook or a fixture. */
function nodeTestId(test: CurrentTest): string | undefined {
  const running = test();

  if (running === undefined) {
    return undefined;
  }

  const { slot } = running;

  return slot && !slot.inFixture && perTestSlots.has(slot.type)
    ? running.testId
    : undefined;
}

/**
 * The test a context opened or closed now belongs to: none in a beforeAll or afterAll hook. A fixture's
 * context, a worker fixture's too, gets the current test until it outlives that test.
 */
function contextTestId(test: CurrentTest): string | undefined {
  const running = test();
  const type = running?.slot?.type;

  return type !== undefined && groupHooks.has(type)
    ? undefined
    : running?.testId;
}

async function readPages(
  pages: HookedPage[],
  ns: string,
): Promise<FrameRead[]> {
  const snapshots = await Promise.all(
    pages
      .flatMap((page) => page.frames())
      .map((frame) => readNamespace(frame, ns)),
  );

  return snapshots.filter((snapshot) => snapshot !== undefined);
}

async function readNamespace(
  frame: HookedFrame,
  ns: string,
): Promise<FrameRead | undefined> {
  const { promise: lost, resolve } = Promise.withResolvers<FrameRead>();
  const timer = setTimeout(() => resolve({ lost: true }), frameReadTimeoutMs);
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
    .then(frameRead)
    .catch(() =>
      frame.isDetached() ? undefined : ({ lost: true } satisfies FrameRead),
    );

  try {
    return await Promise.race([read, lost]);
  } finally {
    clearTimeout(timer);
  }
}

// What a page's evaluate returns has crossed a serialization boundary.
function frameRead(value: unknown): FrameRead | undefined {
  return isRecord(value)
    ? { mutantCoverage: value['mutantCoverage'], hitCount: value['hitCount'] }
    : undefined;
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
