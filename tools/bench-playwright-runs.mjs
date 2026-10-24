// Times the phases of repeated in-process Playwright runs, the way the Stryker runner drives them.
// BENCH_SHARED_BROWSER=1 connects every run to one browser server instead of launching a browser per run.
// Usage: node tools/bench-playwright-runs.mjs <playwright config> [runs=3] [testId...]
import { createRequire } from 'node:module';
import path from 'node:path';

const [configArg, runsArg = '3', ...testIds] = process.argv.slice(2);
const configFile = path.resolve(configArg);
const playwrightRequire = createRequire(createRequire(configFile).resolve('@playwright/test'));
const { testRunner } = playwrightRequire('playwright/lib/runner');
const { configLoader } = playwrightRequire('playwright/lib/common');

const browserServer = process.env.BENCH_SHARED_BROWSER
  ? await playwrightRequire('playwright-core').chromium.launchServer()
  : undefined;
const runner = new testRunner.TestRunner(configLoader.resolveConfigLocation(configFile), {});
await runner.initialize({});

let t0 = performance.now();
const ms = () => Math.round(performance.now() - t0);
await runner.runGlobalSetup([{ onError: (e) => console.error(e.message) }]);
console.log(`globalSetup (webServer) ${ms()} ms`);

for (let i = 0; i < Number(runsArg); i++) {
  const marks = {};
  const reporter = {
    onBegin: () => (marks.loaded = ms()),
    onTestBegin: () => (marks.firstTest ??= ms()),
    onTestEnd: () => (marks.lastTestEnd = ms()),
    onError: (e) => console.error(e.message),
  };
  t0 = performance.now();
  const { status } = await runner.runTests(reporter, {
    locations: [],
    testIds: testIds.length ? testIds : undefined,
    workers: 1,
    connectWsEndpoint: browserServer?.wsEndpoint(),
    disableConfigReporters: true,
  });
  console.log(`run ${i}: ${status} load ${marks.loaded} ms, first test begins ${marks.firstTest} ms, last test ends ${marks.lastTestEnd} ms, done ${ms()} ms`);
}

await runner.runGlobalTeardown();
await browserServer?.close();
