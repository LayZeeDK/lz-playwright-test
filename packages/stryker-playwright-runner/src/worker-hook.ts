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
  INSTALLED_SUFFIX,
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
  const testIds = new WeakMap<BrowserContext, string | undefined>();
  const closedPageSnapshots = new WeakMap<BrowserContext, Snapshot[]>();
  const collected = new WeakSet<BrowserContext>();
  const patchedBrowsers = new WeakSet<Browser>();

  fs.writeFileSync(
    path.join(outDir, `worker-${process.pid}${INSTALLED_SUFFIX}`),
    '',
  );

  function ownedByCurrentTest(context: BrowserContext): boolean {
    const createdFor = testIds.get(context);

    return createdFor !== undefined && createdFor === currentTestId(test);
  }

  async function collect(context: BrowserContext) {
    if (collected.has(context)) {
      return;
    }

    collected.add(context);
    const snapshots = [
      ...(closedPageSnapshots.get(context) ?? []),
      ...(await readPages(context.pages(), ns)),
    ];
    const outlivedItsTest = !ownedByCurrentTest(context);
    const lines = snapshots.map((snapshot) =>
      JSON.stringify({ ...snapshot, outlivedItsTest } satisfies Snapshot),
    );

    if (lines.length) {
      fs.appendFileSync(outFile, lines.join('\n') + '\n');
    }
  }

  // page.close() and browser.close() skip the before-close hook for what they close, so read first.
  function collectBeforePageCloses(context: BrowserContext, page: Page) {
    const close = page.close.bind(page);
    page.close = async (options) => {
      const snapshots = closedPageSnapshots.get(context) ?? [];
      snapshots.push(...(await readPages([page], ns)));
      closedPageSnapshots.set(context, snapshots);

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
      const testId = perTest ? currentTestId(test) : undefined;
      testIds.set(context, testId);
      collectBeforeBrowserCloses(context.browser());
      context.on('page', (page) => collectBeforePageCloses(context, page));
      await context.addInitScript(initPage, {
        ns,
        activeMutant,
        testId,
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
  const timer = setTimeout(() => resolve({ lost: true }), 2000);
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
