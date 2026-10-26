// Preloaded into Playwright's worker processes (NODE_OPTIONS=--import, set only while a run lasts).
// It injects the Stryker namespace into every page through Playwright's client instrumentation, so
// one build that contains every mutant serves all runs.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isMainThread } from 'node:worker_threads';

import type {
  Browser,
  BrowserContext,
  Frame,
  Page,
  TestType,
} from '@playwright/test';
import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';

import { instrumentationOf, WORKER_ENTRY } from './playwright-internals.ts';
import {
  FRAME_READ_TIMEOUT_MS,
  readRunSettings,
  type RunSettings,
  serializeSnapshot,
  SNAPSHOT_SUFFIX,
  type SnapshotLine,
} from './protocol.ts';

/** What the hook reads from one frame before its browser context closes. */
type FrameRead = Omit<SnapshotLine, 'outlivedItsTest'>;

interface ContextState {
  testId?: string;
  closedPageSnapshots: FrameRead[];
  collected: boolean;
}

interface PageSettings {
  ns: string;
  activeMutant?: string;
  testId?: string;
  hitLimit?: number;
}

type Test = TestType<object, object>;

const entry = process.argv[1] ?? '';
const settings = readRunSettings(process.env);

if (settings && isMainThread && WORKER_ENTRY.test(entry)) {
  install(createRequire(entry), settings);
}

function install(
  playwrightRequire: NodeJS.Require,
  { outDir, perTest, hitLimit }: RunSettings,
) {
  const { test } = playwrightRequire('playwright/test') as { test: Test };
  const instrumentation = instrumentationOf(playwrightRequire);
  const ns = INSTRUMENTER_CONSTANTS.NAMESPACE;
  const activeMutant =
    process.env[INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE];
  const outFile = path.join(outDir, `worker-${process.pid}${SNAPSHOT_SUFFIX}`);
  const contexts = new WeakMap<BrowserContext, ContextState>();
  const alreadyRead = new WeakSet<Page>();
  const patchedBrowsers = new WeakSet<Browser>();

  // The file exists from install on, so the runner can tell "the hook never installed" apart from
  // "no page loaded instrumented code". Appending keeps the snapshots of an earlier worker in this
  // run that had the same pid.
  fs.writeFileSync(outFile, '', { flag: 'a' });
  // Before any test file is imported: the hook is preloaded with --import.
  recordNodeCoverage(
    ((globalThis as Record<string, unknown>)[ns] ??= {}) as NodeNamespace,
    { perTest, hitLimit },
    () => currentTestId(test),
    // The leading newline ends a partial line a killed worker with the same pid left behind.
    (line) => fs.appendFileSync(outFile, '\n' + line + '\n'),
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
      (state.testId === undefined || state.testId !== currentTestId(test));
    const lines = snapshots.map((snapshot) =>
      serializeSnapshot({ ...snapshot, outlivedItsTest }),
    );

    // The leading newline ends a partial line a killed worker with the same pid left behind.
    if (lines.length) {
      fs.appendFileSync(outFile, '\n' + lines.join('\n') + '\n');
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
        testId: perTest ? currentTestId(test) : undefined,
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

/** The fields of the worker's own Stryker namespace that the hook sets or reads. */
export interface NodeNamespace {
  activeMutant?: string;
  currentTestId?: string;
  mutantCoverage?: unknown;
  hitCount?: number;
  hitLimit?: number;
}

/**
 * Makes the worker's own namespace report the coverage and hits of the app code its tests import. It
 * leaves activeMutant alone: the instrumented code reads it from the environment only while it is
 * unset. The instrumented code reads currentTestId on every call, so a getter puts coverage made
 * during a test under that test, and coverage made while no test runs, such as at import, in static.
 * runTests resolves after its workers exit, so a line written at exit is there to read, except after a
 * failure that reaches maxFailures: then it may resolve first. The hit limit throws, which fails the
 * test, so the count is written the moment it passes the limit instead.
 */
export function recordNodeCoverage(
  ns: NodeNamespace,
  { perTest, hitLimit }: { perTest: boolean; hitLimit?: number },
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
      // Nothing reads this run's snapshots any more.
    }
  };

  // Stryker sizes the limit from the dry run's hits, Node hits included, so Node code counts too.
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
      configurable: true,
      enumerable: true,
    });
  }

  if (perTest) {
    Object.defineProperty(ns, 'currentTestId', {
      get: currentTestId,
      configurable: true,
      enumerable: true,
    });
  }

  onExit(() => {
    if (written || (ns.mutantCoverage === undefined && !ns.hitCount)) {
      return;
    }

    writeOnce();
  });
}

function currentTestId(test: Test): string | undefined {
  try {
    return test.info().testId;
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
      const s = (
        globalThis as unknown as Record<string, FrameRead | undefined>
      )[name];

      return s
        ? { mutantCoverage: s.mutantCoverage, hitCount: s.hitCount }
        : undefined;
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

// Runs in the browser before any page script. Coverage and the hit count are carried across
// same-origin navigations of the top frame through sessionStorage, which survives a page load.
function initPage({ ns, activeMutant, testId, hitLimit }: PageSettings) {
  const scope = globalThis as unknown as Record<
    string,
    Record<string, unknown> | undefined
  >;
  const s = (scope[ns] ??= {});
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
    const carried = JSON.parse(
      sessionStorage.getItem(key) ?? 'null',
    ) as FrameRead | null;

    if (carried) {
      s.mutantCoverage = carried.mutantCoverage;

      if (hitLimit !== undefined) {
        s.hitCount = carried.hitCount ?? 0;
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
