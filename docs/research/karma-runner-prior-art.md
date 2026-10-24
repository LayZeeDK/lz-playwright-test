# Karma runner: prior art for the Playwright runner

Scope: what StrykerJS's first-party `@stryker-mutator/karma-runner` (StrykerJS v10.1.1) does to run mutants in real browsers, and which of its choices carry over to the prototype `stryker-playwright-runner`.

Labels: [checked] = read in source, docs, an issue or PR, with a citation. [inferred] = reasoning from checked facts.

Citation shorthand:

- `KR:<path>:<line>` = `git show v10.1.1:packages/karma-runner/<path>` in `D:/projects/github/stryker-mutator/stryker-js`.
- `CORE:<path>:<line>` = `git show v10.1.1:packages/core/<path>` in the same clone.
- `PW:<file>:<line>` = `D:/projects/sandbox/stryker-playwright-runner/packages/stryker-playwright-runner/src/<file>`.
- `#N` = `https://github.com/stryker-mutator/stryker-js/issues/N` (or pull N), read with `gh`.

The local clone is shallow (`git rev-parse --is-shallow-repository` = true; 6 commits under `packages/karma-runner`), so history comes from `KR:CHANGELOG.md` and GitHub, not `git log`.

## 1. Lifetime and reset

What stays alive across runs:

- One Karma server per Stryker test-runner process, started once in `init()` and stopped in `dispose()`. [checked `KR:src/karma-test-runner.ts:80-114,136-144`; `KR:src/starters/karma-starter.ts:24-28`]
- The browser stays alive. Karma launches it once; `init()` waits for `onBrowsersReady` before it returns. [checked `KR:src/karma-test-runner.ts:92-98`; `KR:src/karma-plugins/stryker-reporter.ts:65-68`]
- Stryker forces the lifecycle settings and the docs call them "non overridable": `autoWatch: false`, `singleRun: false`, `detached: false`, `browserNoActivityTimeout: 1000000` (the last one because "Default value 10000 might not enough to send perTest coverage results"). [checked `KR:src/karma-plugins/stryker-karma.conf.ts:71-82`; `docs/karma-runner.md:87-98`]
- With Angular, the Angular CLI's karma builder builds the bundle once and keeps serving it. Karma's own file watching is off, and the sandbox does not change between runs because all mutants are in one instrumented build. [inferred from `autoWatch: false` and mutant switching at run time]

How a run is triggered: each `dryRun`/`mutantRun` calls `karma.runner.run(runConfig)`, Karma's public HTTP "run" API against the running server, and waits for the reporter's `onRunComplete`. The `runConfig` is parsed once in `init()` with only hostname/port/listenAddress so the user's config file is not executed again on every run. [checked `KR:src/karma-test-runner.ts:106-112,130-134,156-160`; #2847]

How state is reset: Karma reloads the test context (the iframe) on every run, so all scripts, including the bundle and the Stryker hooks script, run again from scratch. Issue #3454 ("Implement hot-reload for karma") states the cost: hot reload "would improve performance by preventing full page reloads for runtime mutants". It is still open and unimplemented. [checked #3454] The reporter resets its own Node-side state in `onRunStart`. [checked `KR:src/karma-plugins/stryker-reporter.ts:122-128`]

Static mutants: the runner reports `capabilities() { return { reloadEnvironment: true } }` and never reads `options.reloadEnvironment`, because every run is already a full context reload. [checked `KR:src/karma-test-runner.ts:76-78`; `git grep reloadEnvironment v10.1.1 -- packages/karma-runner/src` finds only the capability] Core's `ReloadEnvironmentDecorator` would restart the process only for runners without that capability. [checked `CORE:src/test-runner/reload-environment-decorator.ts:33-67`]

`clearContext` is disabled. Karma navigated the iframe to `about:blank` after a run, which raced with the next run and produced false `RuntimeError` results. [checked `KR:src/karma-plugins/stryker-karma.conf.ts:89-94`; #2049, #2048]

## 2. Mutant activation in the browser

- A "test hooks" script is served by a Karma `beforeMiddleware`. Its content is a string the runner rebuilds before each run, served with `Cache-Control: no-cache`. [checked `KR:src/karma-plugins/test-hooks-middleware.ts:128-139`]
- The script is put at the front of Karma's `files` list (`included: true, served: false, nocache: true`), so it runs before the code under test. A second file, the coverage adapter, is also put at the front. [checked `KR:src/karma-plugins/stryker-karma.conf.ts:154-189`]
- For a mutant run the script sets `window.__stryker__.activeMutant = "<id>"`, `hitCount = 0` (or `undefined` with no limit), and `hitLimit`. It also turns off coverage reporting. [checked `KR:src/karma-plugins/test-hooks-middleware.ts:66-97`]
- When: on every page (context) load, before any user script, because the context reloads per run (section 1). [inferred]
- Values travel from Stryker's Node process to the page through the middleware's in-memory string. Karma's `client` config is used only for framework options (section 4). [checked `KR:src/karma-test-runner.ts:123-128`]
- Hit limit: the instrumenter throws once `hitCount` exceeds `hitLimit`. The runner reads `hitCount` after the run and turns it into `Timeout` with `determineHitLimitReached`. The PR adding it says the karma runner is "the most expensive one to restart, so it has the most to gain", and that a thrown error can be caught by user code, so a timeout can still happen. [checked #3031; `KR:src/karma-plugins/stryker-reporter.ts:169-176`]

## 3. Per-test coverage

- `currentTestId` is set in the page from inside the test framework, at test start: a Jasmine reporter's `specStarted` sets `__stryker__.currentTestId = spec.id`; for Mocha a root `beforeEach` sets it to `this.currentTest.fullTitle()`. Other frameworks make `perTest` throw. [checked `KR:src/karma-plugins/test-hooks-middleware.ts:99-126`]
- This works because tests run one after the other inside the same page as the code under test. [inferred]
- Coverage reaches Node once per run: the adapter wraps `window.__karma__.complete` and adds `mutantCoverage` (only when coverage is on) and `hitCount` to the completion payload. Karma sends that to the server and the reporter receives it in `onBrowserComplete`. [checked `KR:src/karma-plugins/stryker-mutant-coverage-adapter.ts:4-22`; `KR:src/karma-plugins/stryker-reporter.ts:140-149`]
- `coverageAnalysis: 'all'` sets a flag so only static/total coverage is reported; `'off'` sends none. Mutant runs always turn coverage off and send only `hitCount`. [checked `KR:src/karma-plugins/test-hooks-middleware.ts:52-74`]
- The very large `browserNoActivityTimeout` exists because large coverage payloads were slow to send. [checked `KR:src/karma-plugins/stryker-karma.conf.ts:75`]

## 4. Test identity, selection, bail

- The test id is Jasmine's `spec.id` (positional, `spec0`, `spec1`, ...), or the full name for Mocha. [checked `KR:src/karma-plugins/stryker-reporter.ts:89-97`; `KR:src/karma-plugins/test-hooks-middleware.ts:108,115`]
- Positional ids are why random order is forced off: "spec id's tend to move around". [checked `KR:src/karma-plugins/stryker-karma.conf.ts:96-100`]
- Filtering happens in the page: `jasmine.getEnv().configure({ specFilter })` with the id list, or `mocha.grep(/(id1)|(id2)/)` with escaped titles. A Mocha grep is a substring regex, so it can select more tests than asked (a title that contains another title). [checked `KR:src/karma-plugins/test-hooks-middleware.ts:75-91`; over-selection inferred from the unanchored regex]
- Bail: Jasmine `failFast`/`oneFailurePerSpec`/`stopOnSpecFailure`/`stopSpecOnExpectationFailure` and Mocha `bail` follow `!disableBail`. [checked `KR:src/karma-plugins/stryker-karma.conf.ts:98-114`; #3074 in `KR:CHANGELOG.md:349`]
- `--testFiles` is rejected in `init()`. [checked `KR:src/karma-test-runner.ts:81-85`]

## 5. Timeouts, disconnects, crashes

- The runner sets no run timer of its own. Core's `TimeoutDecorator` races each run against Stryker's timeout and, when it expires, kills and restarts the whole test-runner process (`recover()`), which for Karma means a new server, a new browser, and with Angular a new build. [checked `CORE:src/test-runner/timeout-decorator.ts:59-84`; `KR:src/karma-test-runner.ts:130-134`]
- Cheaper path, from #3020: an infinite loop in the page blocks the browser, Karma's socket heartbeat marks it `DISCONNECTED`, and `onBrowserError` calls `karmaServer.get('launcher').restart(browser.id)` and sets `browserIsRestarting`. The run is reported as `Timeout` ("Browser disconnected during test execution"). Only the browser restarts; the server stays up. [checked `KR:src/karma-plugins/stryker-reporter.ts:151-167,177-181`; #3020]
- The run's promise is resolved from `onBrowsersReady` after the restart, not from `onRunComplete`, so the next run never starts against a browser that is still restarting. [checked `KR:src/karma-plugins/stryker-reporter.ts:65-68,130-138`]
- `karmaRunResult.error` (for example a script error while loading) becomes `DryRunStatus.Error`, which a mutant run maps to `RuntimeError`. [checked `KR:src/karma-plugins/stryker-reporter.ts:182-186`; `KR:src/karma-test-runner.ts:126-127`]
- A browser error during `init()` rejects init. If Karma exits early, init throws with a hint to use `--logLevel trace`. [checked `KR:src/karma-test-runner.ts:95-104`; `KR:src/karma-plugins/stryker-reporter.ts:152-153`]
- The integration test for disconnect recovery is skipped on Windows and macOS ("flaky on windows & does not work on macos") and retried 3 times on Linux. [checked `KR:test/integration/timeout-on-infinite-loop.it.spec.ts:42-48`]
- Known issues: `ng test` hangs at init with no output, even at trace level (#4459, #5099, both closed as stale). Scores change between runs of the same Angular project with no resolution (#4878, open). A run is about 10x slower than `ng test` (#5462, open). Angular CLI 20.3 injected a reporter that broke Karma's `run` API (#5516; fixed upstream in `@angular/cli@20.3.8` by a Stryker maintainer's PR). [checked]

## 6. Angular CLI integration

- `projectType: 'angular-cli'` makes the runner call `@angular/cli`'s programmatic entry with `['test', '--progress=false', '--karma-config=<stryker-karma.conf.cjs>', ...testArguments]`, resolved from the project's own `node_modules`. [checked `KR:src/starters/angular-starter.ts:37-69`]
- Taking over the config: the Stryker karma config loads the user's `karma.configFile` (it must export a function), applies `karma.config`, then forces the lifecycle, client and plugin settings above and adds its middleware, adapter and reporter. [checked `KR:src/karma-plugins/stryker-karma.conf.ts:215-229`]
- Values pass from the runner to this config file through module-level globals (`configureKarma.setGlobals`), because Karma and Angular load the config file themselves. [checked `KR:src/karma-plugins/stryker-karma.conf.ts:231-241`]
- `testArguments` keys are decamelized into flags; `progress` and `karma-config` cannot be overridden. [checked `KR:src/starters/angular-starter.ts:52-63`]
- The design depends on Angular's builder keeping Karma's `run` API working, which #5516 shows can break with an Angular minor release. [checked #5516]
- `docs/karma-runner.md:100` says the `coverage` plugin is removed, but no code in `src` removes it. [checked: no match for coverage-plugin removal in `KR:src`]
- Analogue for Nx/Angular Playwright: no CLI takeover is needed. The Playwright config file is the integration point, and `@nx/playwright`'s preset starts the app through `webServer.command: 'npx nx run <app>:dev'`, as the demo does (`apps/demo-app-e2e/playwright.config.mts`). The prototype loads that config in-process (`PW:playwright-test-runner.js:39-49`), which matches `karma.configFile`. What karma-runner also does, and the prototype does not yet, is force the settings that must hold under Stryker (section "Lessons", L6). [checked config; analogue inferred]

## 7. Concurrency and ports

- One Karma server and one browser per Stryker test-runner child process. `StrykerReporter` and `TestHooksMiddleware` are process-wide singletons, so two runners in one process would collide. [checked `KR:src/karma-plugins/stryker-reporter.ts:60-63`; `KR:src/karma-plugins/test-hooks-middleware.ts:37-46`]
- Ports: Karma's `bindAvailablePort` tries the configured port and moves to the next one while it is busy, then writes the bound port back into `config.port`. The reporter factory captures that config, and `init()` builds `runConfig` from it. [checked `https://unpkg.com/karma@6.4.4/lib/server.js` lines 146-154, `lib/utils/net-utils.js` lines 6-22; `KR:src/karma-plugins/stryker-reporter.ts:27-35`; `KR:src/karma-test-runner.ts:108-112`] Before #1239 ("Support automatic port selection"), Stryker reported the port change as an error (#740). [checked]
- The Angular guide recommends `concurrency` at about half the cores. [checked `docs/guides/angular.md:44-45`]

## 8. What transfers to Playwright Test

Karma runs the tests inside the page under test; Playwright Test runs tests in Node workers that drive separate browser contexts.

Transfers:

- Long-lived infrastructure with cheap per-run reset (server and browser outlive runs). [inferred]
- Inject per-run settings into the page before any app script. The prototype's `addInitScript` is the Playwright form of the hooks script. [inferred]
- Report coverage and `hitCount` at the end, and only `hitCount` during mutant runs. [inferred]
- Turn a hang into `Timeout` inside the runner, then restart the smallest part (karma: the browser; prototype: workers) and wait until it is ready before returning. [inferred]
- Find the server's real address instead of assuming the configured port. [inferred]
- Force lifecycle settings the user cannot override. [inferred]

Does not transfer:

- Framework-specific hooks inside the page (Jasmine reporter, Mocha `beforeEach`, `specFilter`, `mocha.grep`). Playwright selects tests in Node by stable id (`testIds`) and knows the current test in the worker (`test.info()`), which is simpler and avoids the positional-id and regex over-selection problems. [inferred]
- One page for all tests. Playwright tests open many contexts, pages and navigations, so coverage must be read per context and carried across navigations, which Karma never needed. [inferred]
- The bundle is no longer controlled by the runner: Karma serves the files itself, while Playwright e2e goes through a user-owned `webServer`, which may be the wrong server (L7). [inferred]

## Lessons for the Playwright runner

L1. Keep the browser alive across runs.
- Prototype today: every `runTests` forks new workers and each launches a new browser; measured fixed cost about 2.7 s per run (config load 1.4 s, worker start 1.3 s). [checked `PW:playwright-test-runner.js:19-23,88-96`; numbers from the caller's brief]
- Karma: server and browser live for the whole Stryker worker; a run is a context reload. [checked section 1]
- Recommendation: **adapt**. Launch one browser server in `init()` (`browserType.launchServer()`), point workers at it with `use.connectOptions.wsEndpoint`, and close it in `dispose()`. Playwright still makes a new context per test, so isolation holds. Measure first: it only pays off if browser launch is a large part of the 1.3 s worker start. Config load (1.4 s) is the larger cost and is outside this change; see whether the `TestRunner` can reuse the loaded config between `runTests` calls. [inferred]

L2. After `stopTests()`, wait for the run to finish before returning `Timeout`.
- Prototype today: on its own timer it calls `stopTests()` and returns at once, without awaiting the `runTests` promise. [checked `PW:playwright-test-runner.js:104-111`]
- Karma: after a disconnect, the run is reported from `onBrowsersReady`, once the restarted browser is ready. [checked section 5]
- Recommendation: **adopt**. Await `run` with a short bound (for example the 500 ms margin) after `stopTests()`; if that bound expires, throw so core recovers the process. Otherwise the next mutant run can start while the previous run's workers are still shutting down and still appending to NDJSON files. [inferred]

L3. Turn a hang into `Timeout` before Stryker kills the process.
- Prototype today: its own timer at `timeout - 500` ms, then `stopTests()`, so `webServer` survives. [checked `PW:playwright-test-runner.js:97-111`]
- Karma: no own timer; relies on Karma's disconnect detection plus `launcher.restart`, otherwise core restarts the whole process. [checked section 5]
- Recommendation: **keep the prototype's approach**; it is stronger than karma's. Add an integration test that an infinite loop in the page ends as `Timeout` and the next run passes, the same two-step shape as `KR:test/integration/timeout-on-infinite-loop.it.spec.ts:42-66`. [inferred]

L4. Send only `hitCount` during mutant runs and honor `coverageAnalysis`.
- Prototype today: every run reads `mutantCoverage` and `hitCount` from every frame and writes both; `dryRun` ignores `coverageAnalysis`. [checked `PW:worker-hook.cjs:29-40,52-63`; `PW:playwright-test-runner.js:63-78`]
- Karma: coverage off in mutant runs; `'all'` and `'off'` handled. [checked section 3]
- Recommendation: **adopt**. Pass a "collect coverage" flag via env; in mutant runs read only `hitCount`; for `'off'` skip coverage. This makes context close cheaper on every mutant run. [inferred]

L5. Set `currentTestId` when a test starts, not when a context is created.
- Prototype today: the test id is baked into the init script when the context is created. A context created in `beforeAll` or a worker-scoped fixture, then used by several tests, attributes all coverage to its first test, or to no test. [checked `PW:worker-hook.cjs:24-28`; misattribution inferred]
- Karma: id set at `specStarted`/`beforeEach`, inside the running page. [checked section 3]
- Recommendation: **adapt**. Also update `__stryker__.currentTestId` in existing pages at each test start (an auto fixture or a `test.beforeEach` from the hook that evaluates in every open page), and read and split coverage at test end for shared contexts. Lower priority if the target suites use the default per-test `page`. [inferred]

L6. Force the settings that must hold under Stryker.
- Prototype today: forces `workers` (default 1), `maxFailures`, `disableConfigReporters`; `runTests` already forces `retries: 0` and `repeatEach: 1`. [checked `PW:playwright-test-runner.js:89-96`; `docs/research/playwright-internals.md:57`]
- Karma: forces and documents "non overridable" lifecycle settings and a deterministic test order. [checked sections 1 and 4]
- Recommendation: **adopt the documentation part**. List the forced settings in the README. Note that `flaky` is mapped to `Success` (`PW:playwright-test-runner.js:17`); with retries forced to 0 it should not occur, so treat it as `Failed` or log it. [inferred]

L7. Verify that the server under test serves the instrumented sandbox.
- Prototype today: the demo `webServer` uses a fixed port with `reuseExistingServer: true`. If a developer's `nx dev` from the original workspace already runs on 4200, Playwright reuses it, pages run uninstrumented code, and every mutant survives with no error. [checked `apps/demo-app-e2e/playwright.config.mts`; failure mode inferred]
- Karma: serves the files itself on a port it binds, so this cannot happen. [checked section 7]
- Recommendation: **adopt as a fail-loud check**. After the dry run, if no frame in any test had `globalThis.__stryker__` (no coverage at all), fail with a message naming `webServer`/`reuseExistingServer`. [inferred]

L8. Concurrency and ports.
- Prototype today: every Stryker worker runs `runGlobalSetup`, so with `concurrency > 1` all workers start the same `webServer` on the same port. With `reuseExistingServer: true` they share the first worker's server, which dies if core restarts that worker. Without it, they fail on the busy port. The demo uses `concurrency: 1`. [checked `PW:playwright-test-runner.js:51-56`; `stryker.e2e.config.mjs`; failure modes inferred]
- Karma: one server per worker, free port found by Karma and read back. [checked section 7]
- Recommendation: **adapt**. Because mutant activation happens per page, one shared server is correct for every worker. Either document "start the server outside Stryker and set `reuseExistingServer`", or give each worker its own port (for example base port + `STRYKER_MUTATOR_WORKER`, exposed as an env var the user's config reads). Pick one before supporting `concurrency > 1`. [inferred]

L9. Ignore `reloadEnvironment`, as karma does.
- Prototype today: claims `reloadEnvironment: true` and does not read the option; each run gets new workers, a new browser and new page loads, so static mutants see `activeMutant` from the init script before app code. [checked `PW:playwright-test-runner.js:34-36`; `PW:worker-hook.cjs:67-74`]
- Karma: same claim, same reason (context reload per run). [checked section 1]
- Recommendation: **keep**. If L1 adds browser reuse, this still holds because every test opens a new context. Code that runs in the `webServer` process (SSR, API) never sees `activeMutant`; keep it out of `mutate`, as karma only ever mutates browser code. [inferred]

L10. Test selection and ids.
- Prototype today: Playwright's hash ids and `testIds`. [checked `PW:playwright-test-runner.js:89-92,139`]
- Karma: positional Jasmine ids, forced order, an unanchored Mocha regex. [checked section 4]
- Recommendation: **ignore** karma's approach; the prototype's is better. [inferred]

L11. Riding on a host tool's internals breaks with its minor releases.
- Prototype today: depends on undocumented `playwright/lib/runner` and `playwright-core`'s `_instrumentation`. [checked `PW:playwright-test-runner.js:19-23,41-42`; `PW:worker-hook.cjs:16`]
- Karma: depends on Angular's builder keeping Karma's `run` API working; Angular 20.3 broke it (#5516). [checked]
- Recommendation: **adopt** a version guard like `MIN_KARMA_VERSION` (`KR:src/karma-test-runner.ts:46,86-91`): check the Playwright version in `init()` and fail with a clear message outside the tested range. Run the integration suite against each new Playwright minor. [inferred]
