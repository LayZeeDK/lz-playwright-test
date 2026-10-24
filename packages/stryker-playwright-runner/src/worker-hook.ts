// Preloaded into every Node process the runner's Playwright spawns (NODE_OPTIONS=--import), and active
// only in Playwright Test worker processes. It injects the Stryker namespace into every page through
// Playwright's client instrumentation, so one build that contains every mutant serves all runs.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { BrowserContext, Frame, TestType } from '@playwright/test';
import type { MutantCoverage } from '@stryker-mutator/api/core';

import { ENV, type Snapshot } from './protocol.ts';

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

if (/[\\/]playwright[\\/]lib[\\/]worker[\\/]workerProcessEntry\.js$/.test(entry)) {
  install(createRequire(entry));
}

function install(playwrightRequire: NodeJS.Require) {
  const { test } = playwrightRequire('playwright/test') as { test: Test };
  const { _instrumentation: instrumentation } = playwrightRequire('playwright-core') as {
    _instrumentation: Instrumentation;
  };
  const ns = process.env[ENV.namespace] ?? '__stryker__';
  const activeMutant = process.env[ENV.activeMutant];
  const hitLimit = process.env[ENV.hitLimit] ? Number(process.env[ENV.hitLimit]) : undefined;
  const perTest = process.env[ENV.coverage] === 'perTest';
  const outFile = path.join(process.env[ENV.outDir]!, `worker-${process.pid}.ndjson`);
  const testIds = new WeakMap<BrowserContext, string | undefined>();

  instrumentation.addListener({
    async runAfterCreateBrowserContext(context) {
      const testId = perTest ? currentTestId(test) : undefined;
      testIds.set(context, testId);
      await context.addInitScript(initPage, { ns, activeMutant, testId, hitLimit } satisfies PageSettings);
    },
    async runBeforeCloseBrowserContext(context) {
      const snapshots = await Promise.all(
        context
          .pages()
          .flatMap((page) => page.frames())
          .map((frame) => readNamespace(frame, ns)),
      );
      // A context that outlives its test (created in beforeAll or a worker fixture) served several
      // tests, so its coverage cannot be credited to one: report it as static, which runs every test.
      const createdFor = testIds.get(context);
      const ownedByOneTest = createdFor !== undefined && createdFor === currentTestId(test);
      const lines = snapshots
        .filter((snapshot) => snapshot !== undefined)
        .map((snapshot) =>
          JSON.stringify(ownedByOneTest ? snapshot : { ...snapshot, mutantCoverage: asStatic(snapshot.mutantCoverage) }),
        );

      if (lines.length) {
        fs.appendFileSync(outFile, lines.join('\n') + '\n');
      }
    },
  });
}

function asStatic(coverage: MutantCoverage | undefined): MutantCoverage | undefined {
  if (!coverage) {
    return coverage;
  }

  const all = { ...coverage.static };

  for (const hits of Object.values(coverage.perTest ?? {})) {
    for (const [mutantId, count] of Object.entries(hits)) {
      all[mutantId] = (all[mutantId] ?? 0) + count;
    }
  }

  return { static: all, perTest: {} };
}

function currentTestId(test: Test): string | undefined {
  try {
    return test.info().testId;
  } catch {
    return undefined;
  }
}

async function readNamespace(frame: Frame, ns: string): Promise<Snapshot | undefined> {
  const timeout = new Promise<undefined>((resolve) => setTimeout(resolve, 2000, undefined));
  const read = frame
    .evaluate((name) => {
      const s = (globalThis as unknown as Record<string, Snapshot | undefined>)[name];

      return s ? { mutantCoverage: s.mutantCoverage, hitCount: s.hitCount } : undefined;
    }, ns)
    .catch(() => undefined);

  return Promise.race([read, timeout]);
}

// Runs in the browser before any page script. Coverage and the hit count are carried across
// same-origin navigations of the top frame through sessionStorage, which survives a page load.
function initPage({ ns, activeMutant, testId, hitLimit }: PageSettings) {
  const scope = globalThis as unknown as Record<string, Record<string, unknown> | undefined>;
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
    const carried = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Snapshot | null;

    if (carried) {
      s.mutantCoverage = carried.mutantCoverage;

      if (hitLimit !== undefined) {
        s.hitCount = carried.hitCount ?? 0;
      }
    }

    addEventListener('pagehide', () => {
      sessionStorage.setItem(key, JSON.stringify({ mutantCoverage: s.mutantCoverage, hitCount: s.hitCount }));
    });
  } catch {
    // Opaque origins (about:blank, data: URLs) have no sessionStorage.
  }
}
