// Times the phases of repeated in-process Playwright runs, the way the Stryker runner drives them.
// BENCH_SHARED_BROWSER=1 connects every run to one browser server instead of launching a browser per run.
// Usage: node tools/bench-playwright-runs.ts <playwright config> [runs=3] [testId...]
import { createRequire } from 'node:module';
import path from 'node:path';

import type { BrowserType } from '@playwright/test';
import type { TestError } from '@playwright/test/reporter';

import { fieldOf } from '../packages/stryker-playwright-runner/src/is-record.ts';
import {
  loadPlaywright,
  type RunTestsParams,
} from '../packages/stryker-playwright-runner/src/playwright-internals.ts';

function isBrowserType(value: unknown): value is BrowserType {
  return typeof fieldOf(value, 'launchServer') === 'function';
}

function chromiumNextTo(configFile: string): BrowserType {
  const playwrightTest: unknown = createRequire(configFile)('@playwright/test');
  const chromium = fieldOf(playwrightTest, 'chromium');

  if (!isBrowserType(chromium)) {
    throw new Error(
      `The @playwright/test next to ${configFile} has no chromium.launchServer.`,
    );
  }

  return chromium;
}

const [configArg, runsArg = '3', ...testIds] = process.argv.slice(2);

if (configArg === undefined) {
  throw new Error(
    'Usage: node tools/bench-playwright-runs.ts <playwright config> [runs=3] [testId...]',
  );
}

const configFile = path.resolve(configArg);

const browserServer = process.env['BENCH_SHARED_BROWSER']
  ? await chromiumNextTo(configFile).launchServer()
  : undefined;
const runner = await loadPlaywright(configFile).createTestRunner(
  configFile,
  {},
);

let t0 = performance.now();
const ms = () => Math.round(performance.now() - t0);
const onError = (error: TestError) => console.error(error.message);
await runner.runGlobalSetup([{ onError }]);
console.log(`globalSetup (webServer) ${ms()} ms`);

try {
  for (let i = 0; i < Number(runsArg); i++) {
    const marks: { loaded?: number; firstTest?: number; lastTestEnd?: number } =
      {};
    const reporter = {
      onBegin: () => (marks.loaded = ms()),
      onTestBegin: () => (marks.firstTest ??= ms()),
      onTestEnd: () => (marks.lastTestEnd = ms()),
      onError,
    };
    t0 = performance.now();
    const params: RunTestsParams & { connectWsEndpoint?: string | undefined } =
      {
        locations: [],
        testIds: testIds.length ? testIds : undefined,
        workers: 1,
        connectWsEndpoint: browserServer?.wsEndpoint(),
        disableConfigReporters: true,
      };
    const { status } = await runner.runTests(reporter, params);
    console.log(
      `run ${i}: ${status} load ${marks.loaded} ms, first test begins ${marks.firstTest} ms, last test ends ${marks.lastTestEnd} ms, done ${ms()} ms`,
    );
  }
} finally {
  await runner.runGlobalTeardown();
  await browserServer?.close();
}
