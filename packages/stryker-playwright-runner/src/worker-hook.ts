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

type FrameRead = Omit<SnapshotLine, 'outlivedItsTest'>;

interface ContextState {
  testId?: string;
  closedPageSnapshots: FrameRead[];
  collected: boolean;
}

export interface PageSettings {
  ns: string;
  activeMutant?: string;
  testId?: string;
  hitLimit?: number;
}

type Test = TestType<object, object>;

// Undefined under `node -e`, which a worker's NODE_OPTIONS can reach; RegExp.test reads it as "undefined".
const entry = process.argv[1];
const settings = readRunSettings(process.env);

if (settings && isMainThread && WORKER_ENTRY.test(entry)) {
  install(createRequire(entry), settings);
}

export function install(
  playwrightRequire: NodeJS.Require,
  { outDir, perTest, hitLimit }: RunSettings,
  ns: string = INSTRUMENTER_CONSTANTS.NAMESPACE,
): void {
  const { test }: { test: Test } = playwrightRequire('playwright/test');
  const instrumentation = instrumentationOf(playwrightRequire);
  const activeMutant =
    process.env[INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE];
  const outFile = path.join(outDir, `worker-${process.pid}${SNAPSHOT_SUFFIX}`);
  const contexts = new WeakMap<BrowserContext, ContextState>();
  const alreadyRead = new WeakSet<Page>();
  const patchedBrowsers = new WeakSet<Browser>();

  fs.writeFileSync(outFile, '', { flag: 'a' });
  const scope = globalThis as unknown as Record<
    string,
    NodeNamespace | undefined
  >;
  recordNodeCoverage(
    (scope[ns] ??= {}),
    { perTest, hitLimit },
    () => currentTestId(test),
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

export interface NodeNamespace {
  activeMutant?: string;
  currentTestId?: string;
  mutantCoverage?: unknown;
  hitCount?: number;
  hitLimit?: number;
}

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

export function initPage({
  ns,
  activeMutant,
  testId,
  hitLimit,
}: PageSettings): void {
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
    const carried: FrameRead | null = JSON.parse(
      sessionStorage.getItem(key) ?? 'null',
    );

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
