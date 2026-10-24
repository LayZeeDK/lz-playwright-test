// Preloaded into every Node process the runner spawns (NODE_OPTIONS=--require), and active only in
// Playwright Test worker processes. It injects the Stryker namespace into every page through
// Playwright's client instrumentation, so one build that contains every mutant serves all runs.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const entry = process.argv[1] ?? '';

if (/[\\/]playwright[\\/]lib[\\/]worker[\\/]workerProcessEntry\.js$/.test(entry)) {
  install(createRequire(entry));
}

function install(playwrightRequire) {
  const { test } = playwrightRequire('playwright/test');
  const { _instrumentation: instrumentation } = playwrightRequire('playwright-core');
  const ns = process.env.STRYKER_PW_NAMESPACE ?? '__stryker__';
  const activeMutant = process.env.__STRYKER_ACTIVE_MUTANT__;
  const hitLimit = process.env.STRYKER_PW_HIT_LIMIT ? Number(process.env.STRYKER_PW_HIT_LIMIT) : undefined;
  const perTest = process.env.STRYKER_PW_COVERAGE === 'perTest';
  const outFile = path.join(process.env.STRYKER_PW_OUT_DIR, `worker-${process.pid}.ndjson`);
  const testIds = new WeakMap();

  instrumentation.addListener({
    async runAfterCreateBrowserContext(context) {
      const testId = perTest ? currentTestId(test) : undefined;
      testIds.set(context, testId);
      await context.addInitScript(initPage, { ns, activeMutant, testId, hitLimit });
    },
    async runBeforeCloseBrowserContext(context) {
      const snapshots = await Promise.all(
        context.pages().flatMap((page) => page.frames()).map((frame) => readNamespace(frame, ns)),
      );
      // A context that outlives its test (created in beforeAll or a worker fixture) served several
      // tests, so its coverage cannot be credited to one: report it as static, which runs every test.
      const ownedByOneTest = testIds.get(context) !== undefined && testIds.get(context) === currentTestId(test);
      const lines = snapshots
        .filter(Boolean)
        .map((snapshot) => JSON.stringify(ownedByOneTest ? snapshot : { ...snapshot, mutantCoverage: asStatic(snapshot.mutantCoverage) }));

      if (lines.length) {
        fs.appendFileSync(outFile, lines.join('\n') + '\n');
      }
    },
  });
}

function asStatic(coverage) {
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

function currentTestId(test) {
  try {
    return test.info().testId;
  } catch {
    return undefined;
  }
}

async function readNamespace(frame, ns) {
  const timeout = new Promise((resolve) => setTimeout(resolve, 2000, undefined));
  const read = frame
    .evaluate((name) => {
      const s = globalThis[name];

      return s ? { mutantCoverage: s.mutantCoverage, hitCount: s.hitCount } : undefined;
    }, ns)
    .catch(() => undefined);

  return Promise.race([read, timeout]);
}

// Runs in the browser before any page script. Coverage and the hit count are carried across
// same-origin navigations of the top frame through sessionStorage, which survives a page load.
function initPage({ ns, activeMutant, testId, hitLimit }) {
  const s = globalThis[ns] || (globalThis[ns] = {});
  const key = `${ns}:carry`;
  const top = globalThis.top === globalThis;

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

  if (!top) {
    return;
  }

  try {
    const carried = JSON.parse(sessionStorage.getItem(key) ?? 'null');

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
