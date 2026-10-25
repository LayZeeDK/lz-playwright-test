// Preloaded into Playwright's worker processes (NODE_OPTIONS=--import, set only while a run lasts).
// It injects the Stryker namespace into every page through Playwright's client instrumentation, so
// one build that contains every mutant serves all runs.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type {
  Browser,
  BrowserContext,
  Frame,
  Page,
  TestType,
} from '@playwright/test';
import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';

import {
  FRAME_READ_TIMEOUT_MS,
  readRunSettings,
  type RunSettings,
  type Snapshot,
} from './protocol.ts';

interface Instrumentation {
  addListener(listener: {
    runAfterCreateBrowserContext?(context: BrowserContext): Promise<void>;
    runBeforeCloseBrowserContext?(context: BrowserContext): Promise<void>;
  }): void;
}

interface ContextState {
  testId?: string;
  closedPageSnapshots: Snapshot[];
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

if (
  settings &&
  /[\\/]playwright[\\/]lib[\\/]worker[\\/]workerProcessEntry\.js$/.test(entry)
) {
  install(createRequire(entry), settings);
}

function install(
  playwrightRequire: NodeJS.Require,
  { outDir, perTest, hitLimit }: RunSettings,
) {
  const { test } = playwrightRequire('playwright/test') as { test: Test };
  const { _instrumentation: instrumentation } = playwrightRequire(
    'playwright-core',
  ) as {
    _instrumentation: Instrumentation;
  };
  const ns = INSTRUMENTER_CONSTANTS.NAMESPACE;
  const activeMutant =
    process.env[INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE];
  const outFile = path.join(outDir, `worker-${process.pid}.ndjson`);
  const contexts = new WeakMap<BrowserContext, ContextState>();
  const alreadyRead = new WeakSet<Page>();
  const patchedBrowsers = new WeakSet<Browser>();

  // The file exists from install on, so the runner can tell "the hook never installed" apart from
  // "no page loaded instrumented code".
  fs.writeFileSync(outFile, '');

  // Closing a page that owns its context closes the context first, so the same page can come up twice.
  function readOnce(pages: Page[]): Promise<Snapshot[]> {
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
      JSON.stringify({ ...snapshot, outlivedItsTest } satisfies Snapshot),
    );

    if (lines.length) {
      fs.appendFileSync(outFile, lines.join('\n') + '\n');
    }
  }

  // page.close() and browser.close() skip the before-close hook for what they close, so read first.
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

function currentTestId(test: Test): string | undefined {
  try {
    return test.info().testId;
  } catch {
    return undefined;
  }
}

async function readPages(pages: Page[], ns: string): Promise<Snapshot[]> {
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
): Promise<Snapshot | undefined> {
  const { promise: lost, resolve } = Promise.withResolvers<Snapshot>();
  const timer = setTimeout(
    () => resolve({ lost: true }),
    FRAME_READ_TIMEOUT_MS,
  );
  const read = frame
    .evaluate((name) => {
      const s = (globalThis as unknown as Record<string, Snapshot | undefined>)[
        name
      ];

      return s
        ? { mutantCoverage: s.mutantCoverage, hitCount: s.hitCount }
        : undefined;
    }, ns)
    .catch(() =>
      frame.isDetached() ? undefined : ({ lost: true } satisfies Snapshot),
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
    ) as Snapshot | null;

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
