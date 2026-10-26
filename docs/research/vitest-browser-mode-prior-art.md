# Vitest Browser Mode in StrykerJS: prior art for the Playwright runner

Note, 2026-10-25: The "prototype" statements and the `PROTO` and `HOOK` citations describe an earlier prototype, not the current runner. Commit 67df91a replaced those JavaScript files with TypeScript. `docs/VERDICT.md` describes the current runner. The `RESEARCH.md` this file builds on is `D:/projects/github/LayZeeDK/ngx-yeti/tmp/afk-m003/stryker-spike/RESEARCH.md`, which is outside this repo.

Scope: what `@stryker-mutator/vitest-runner` (StrykerJS v10.1.1) does in Vitest Browser Mode, and which of its choices carry over to the prototype `stryker-playwright-runner`. Builds on `ngx-yeti/tmp/afk-m003/stryker-spike/RESEARCH.md` section 1 and does not repeat it.

Labels: [checked] = read in source, git history, or an issue/PR, with a citation. [inferred] = reasoning from checked facts.

Citation shorthands:

- `VTR` = `packages/vitest-runner/src/vitest-test-runner.ts` at `v10.1.1` (StrykerJS clone, `git show v10.1.1:<path>`)
- `SETUP` = `packages/vitest-runner/src/stryker-setup.ts` at `v10.1.1`
- `HELP` = `packages/vitest-runner/src/vitest-helpers.ts` at `v10.1.1`
- `BMIT` = `packages/vitest-runner/test/integration/browser-mode.it.spec.ts` at `v10.1.1`
- `VPOOL` = `vitest@5.0.5` tarball, `dist/chunks/index.1TqnEahn.js` (browser pool)
- `VORCH` = `@vitest/browser@5.0.5` tarball, `dist/client/__vitest_browser__/orchestrator-C2U7TVD1.js`
- `VPW` = `@vitest/browser-playwright@5.0.5` tarball, `dist/index.js`
- `PW` = installed `node_modules/playwright/lib/...` (1.64.1) in this workspace
- `PROTO` = `packages/stryker-playwright-runner/src/playwright-test-runner.js`, `HOOK` = `.../src/worker-hook.cjs`

## 1. Lifetime and reset between runs

What stays alive for the whole life of a Stryker worker process:

- **One `Vitest` instance, created once in `init()`**: `createVitest('test', {...})` with `watch: false`, `maxConcurrency: 1`, `maxWorkers: 1`, `bail: disableBail ? 0 : 1`, coverage off. [checked `VTR:203-218`, pool `VTR:179-182`] The config is resolved once; per-run changes are made by mutating `ctx.config` / `project.config` in place (`related`, `testNamePattern`). [checked `VTR:292-314`]
- **One Vite dev server per Vitest project** (the browser project serves modules from it). [inferred from Vitest architecture; the server-side transform cache is reused across runs: `VPOOL:4726` warms `project.vite.transformRequest(fileUrl)` per file, which only helps because the server persists]
- **One browser process and one page ("orchestrator") per browser project.** The browser pool is created lazily once per Vitest instance (`browserPool ??= createBrowserPool(ctx)`, `VPOOL:6175`). At the start of each run the worker re-uses its idle pages from `readySessions` (`VPOOL:4581-4591`) and only opens new pages when none are ready. The Playwright provider keeps `browser` and `contexts` until `close()`. [checked `VPW:1280`, `VPW:1339-1346`, `VPW:1395-1431`]
- **Exception, multiple browser projects**: with `maxWorkers: 1` (which Stryker forces) and more than one headless browser project, the pool evicts the idle browser of one project to run the next (`countEvictableWorkers() + required > maxWorkers` -> `evictIdleWorker` -> `stop({ keepWarm: true })`). [checked `VPOOL:4322-4349`, `VPOOL:4369`] `keepWarm` hands the browser process to the next project when launch options match (`VPW:1405-1416`), so the page/context is recreated but the process may survive. [checked] Per-run cost then grows with the number of browser projects. [inferred]

What is reset per run:

- **Run state**: `ctx.state.filesMap.clear()` before every run, described in the source as "kind of a hack" (link to vitest discussion 3017). [checked `VTR:370-374`, called at `VTR:291`] The pool also calls `vitest.state.clearFiles(project, files)`. [checked `VPOOL:4411`]
- **The JS realm**: with `isolate: true` (default) the orchestrator removes all tester iframes and creates **one fresh iframe per test file** for every run. [checked `VORCH:68-80`, `VORCH:125-127`] With `isolate: false` it reuses one iframe within a run but marks it for recreation after `cleanupTesters`, so the next run gets a fresh one too. [checked `VORCH:63-66`, `VORCH:83-104`] So every run re-evaluates every module in the browser, from Vite's warm server-side transform cache. [inferred from the two checked facts]
- **Provided context**: `project.getProvidedContext()` is stringified at the start of each run and posted into each tester iframe. [checked `VPOOL:4580`, `VORCH:116-123`] This is how a new `activeMutant` reaches the browser without restarting anything.
- **Stryker namespace**: not reset explicitly; it does not need to be, because each iframe has a fresh `globalThis`. [inferred]

Cost per mutant (vitest-runner): `provide()` x4, a state clear, and `ctx.start(files)` which, per selected test file, creates an iframe, evaluates the modules and runs the filtered tests. No process start, no config load, no browser launch, no page open (single browser project). [checked code path `VTR:272-284`, `VTR:286-316`; timing not measured here]

Cost per mutant (prototype): the prototype's own measurement is config load 1.4 s + worker start to first test 1.3 s, so about 2.7 s fixed per run, plus about 0.55 s per test; a shared browser server via `connectWsEndpoint` gave no measurable gain. [checked `decisions.tsv` rows `perf` 2026-10-24T20:34:21Z and 20:34:22Z] Playwright reloads the config on every `runTests` and builds new worker dispatchers per run, and neither can be turned off through `TestRunner`. [checked `docs/research/playwright-internals.md` section 2, "Lifetime across runTests calls"] So the prototype pays roughly 2.7 s per mutant that vitest-runner does not, and that gap cannot be closed by copying vitest-runner's design: the parts vitest keeps alive (config, module host, page) are the parts Playwright's `runTests` rebuilds. [inferred]

## 2. Mutant activation

- **Transport**: `vitest.provide(key, value)` on the Node side, `inject(key)` in a setup file that Stryker prepends to every project's `setupFiles`. [checked `VTR:219-232`, `VTR:273-276`, `SETUP:16-24`] Keys: `globalNamespace`, `mode` (`dry-run` / `mutant`), `activeMutant`, `mutantActivation`, `hitLimit`, `isGreaterThanVitest4Point1`, `testNameSeparator`. [checked `SETUP:101-110`]
- **The setup file is copied into the sandbox** as `stryker-setup-<STRYKER_MUTATOR_WORKER>.js` (cwd of the child process), with its trailing `sourceMappingURL` stripped, and must not import anything local. [checked `VTR:82-84`, `VTR:193-201`, `SETUP:13-14`] Reason: in browser mode the file is served by Vite, and a file inside `node_modules/@stryker-mutator/vitest-runner` with a local import did not load (#5305 "No tests were executed", fixed by #5306 "That seems to be the only way to support browser mode"). [checked `gh issue view 5305`, `gh pr view 5306`, commit `309eb5bb3`]
- **`static` vs `runtime`**:
  - `static`: `ns.activeMutant = inject('activeMutant')` at the setup file's top level, so it is set **before** the test file and the code under test are imported in that iframe. [checked `SETUP:31-32`]
  - `runtime`: set in a `beforeAll`, i.e. after imports, before the tests. [checked `SETUP:33-36`]
  - dry run: `ns.activeMutant = undefined`. [checked `SETUP:52`]
- **`reloadEnvironment`**: the runner reports `capabilities() { reloadEnvironment: true }` and then **never reads** `options.reloadEnvironment` in `mutantRun`. [checked `VTR:100-102`, `VTR:272-284`] It relies on the fresh-iframe-per-file behaviour in section 1 to re-import modules on every run. [inferred] Core sets `mutantActivation: testFilter ? 'runtime' : 'static'` and `reloadEnvironment: !canHotSwap` where hot swap needs a test filter and a non-static mutant. [checked `packages/core/src/mutants/mutant-test-planner.ts:189-217` at v10.1.1] Because the runner claims the capability, core's `ReloadEnvironmentDecorator` never restarts the process for a static mutant. [checked `packages/core/src/test-runner/reload-environment-decorator.ts:37-57`]
- **Which modules get re-imported for static mutants**: all of them, every run: the test file, its imports and the code under test, in a new iframe per selected file. Vite's server-side transform is cached, so this is re-evaluation, not re-transformation. [inferred from section 1]
- **Hit limit**: `ns.hitLimit` is set at the setup file top level, but `ns.hitCount = 0` only in `beforeAll` (mutant mode). [checked `SETUP:21`, `SETUP:27-29`] The instrumenter only counts when `ns.hitCount !== void 0` (see the generated helper in `testResources/browser-project/src/math.component.ts`). [checked] So an infinite loop that a static mutant causes during **module evaluation** is not caught by the hit limit; it falls through to Stryker's timeout and a process restart. [inferred]

## 3. Coverage

- **Browser -> Node via Task Metadata**: the setup file's `afterAll` writes `suite.meta.mutantCoverage = ns.mutantCoverage` (dry run) or `suite.meta.hitCount = ns.hitCount` (mutant run); the hook signature changed in Vitest 4.1 and both forms are kept. [checked `SETUP:39-50`, `SETUP:62-73`] Node reads `file.meta` for every file after `start()` returns. [checked `VTR:376-382`, `VTR:384-398`] Because the setup file's top-level `afterAll` attaches to the file suite and each file has its own realm, coverage arrives **per test file**. [inferred]
- **`currentTestId` per test**: `beforeEach(({ task }) => ns.currentTestId = toRawTestId(task, sep))` and `afterEach(() => ns.currentTestId = undefined)`. [checked `SETUP:54-60`] The raw id is `<abs file>#<suite chain joined by separator> <name>`; Node normalises the file part to a cwd-relative posix path. [checked `SETUP:76-98`, `HELP:94-97`, `HELP:99-109`]
- **Static coverage**: anything that runs while `currentTestId` is undefined lands in `mutantCoverage.static`: module evaluation, `beforeAll`/`afterAll`, and code between `afterEach` and the next `beforeEach`. [checked instrumenter `cover()` in `testResources/browser-project/src/math.component.ts`; `SETUP:54-60`] `BMIT` asserts `static` ids 6-15 and 53, the module-level constants and `customElements.define`. [checked `BMIT:124-136`]
- **Merging across projects**: files are de-duplicated by `${projectName}-${file.name}`, then `perTest` and `static` counts are summed. [checked `VTR:384-428`] The test id has no project part, so the same test in two projects shares one id and its coverage is summed into it. [checked `HELP:33-48`, `SETUP:96-98`; consequence inferred]
- **Hit count**: summed over files. [checked `VTR:376-382`] `determineHitLimitReached` turns it into a Timeout. [checked `VTR:281-283`]

## 4. Test selection and bail

- **Id format**: `<cwd-relative file>#<suite chain + name>`; separator is `' > '` for Vitest >= 5 and `' '` before. [checked `HELP:89-97`, `src/test-helpers.ts`, `VTR:94-98`]
- **Selection for a mutant run**: test ids are split into file + name; the file list goes to `ctx.start(files)` and every project gets `testNamePattern = new RegExp('(?:' + names.join('|') + ')\\s*$')`. [checked `VTR:297-316`] The end anchor was added in #6246 because "calc add" also selected "calc add negative"; the start cannot be anchored because Vitest prefixes the name. [checked `VTR:299-305`, commit `6ad4adbe2`] A dry run with no filter clears `testNamePattern`. [checked `VTR:310-314`]
- **`related`**: when `vitest.related` is on, `ctx.config.related = [mutated sandbox file]` narrows to test files whose module graph imports it. [checked `VTR:292-295`, `VTR:277-280`] The dry run warns when `related` found no tests. [checked `VTR:251-260`]
- **No tests found** is swallowed (`VITEST_FILES_NOT_FOUND`), other errors propagate. [checked `VTR:315-325`, `HELP:133-136`]
- **Bail**: fixed at `createVitest` time from the global `disableBail` option, not per run. [checked `VTR:216`] Tests without a `result` (skipped because of bail) are dropped, not reported as Skipped. [checked `VTR:327-329`] Upstream vitest#11502 (bail only stopping the failing file on repeated `start()`) is fixed in Vitest 5.0.4; see the earlier RESEARCH.md section 1, not repeated here.
- **Collection failures (#6269, merged 2026-10-23, in v10.1.1)**: a file whose `result.state === 'fail'` (import error, mock error, a static mutant throwing at module load) produced no failed test and therefore a false **Survived**. Now, if no test failed and any file failed or `errorsSet` is non-empty, the run is `DryRunStatus.Error` with the file paths and messages, which Stryker records as RuntimeError. [checked `VTR:338-358`, `gh pr view 6269`] Separately, a test skipped because an enclosing suite failed is reported as **Failed** with the suite error. [checked `HELP:56-64`, `HELP:73-87`]

## 5. Failure modes in history, and their Playwright analogues

| Vitest-runner issue                                        | What happened [checked]                                                                                                                                                                                                                                      | Analogue in the prototype                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #5305 / #5306 "No tests were executed" (9.0.0)             | The setup file lived in `node_modules` and imported a local module; browser mode did not load it, so the Stryker hooks never ran. Fixed by copying a self-contained setup file into the sandbox.                                                             | The hook is loaded by Node (`--require`), not served, so the serving problem does not apply. The **class** does: if the hook silently fails to install (worker entry regex `HOOK:10` misses on another Playwright version, `NODE_OPTIONS` stripped by a wrapper, a `webServer` serving an un-instrumented build), the dry run completes with no coverage and every mutant becomes NoCoverage or Survived. Nothing in `PROTO` detects this today. [inferred]                                                               |
| #5242 screenshots on failure                               | Default browser config screenshotted every failure; killed mutants are expected failures. Fixed by forcing `browser.screenshotFailures = false` globally and per project. [`VTR:225-232`]                                                                    | Playwright `use.screenshot`, `use.video`, `use.trace` (`'on-first-retry'` in the demo config; retries are forced to 0 by `runTests`, so that one is inert) and the `outputDir` (`test-results`). `PROTO:48` passes `{}` as overrides, so a user config with `screenshot: 'only-on-failure'` or `trace: 'retain-on-failure'` pays the artifact cost on every killed mutant. `TestRunner` overrides accept `use` and `outputDir` (`PW/common/index.js:582-589`). [checked overrides; cost inferred]                         |
| #6243 / #6244 `fs.allow` + symlinked `node_modules` (open) | Each project's Vite server refused files resolving outside its sandboxed root; surfaced as "Cannot find module".                                                                                                                                             | The prototype's version is **which code the server serves**. The demo config has `reuseExistingServer: true` and `cwd: workspaceRoot` (`apps/demo-app-e2e/playwright.config.mts`). A dev server already running from the real repo on port 4200 would be reused, serving un-instrumented code. [checked config; consequence inferred]                                                                                                                                                                                     |
| #6233 `[object Object]` (open)                             | `errorToString` falls back to `String(error)` for non-`Error` values in `errorsSet`; the RuntimeError reason is lost.                                                                                                                                        | `PROTO:155` uses `error.message ?? String(error)` and `PROTO:148` `result.error?.message`. Playwright `TestError` carries `message`, `stack`, `value` (thrown non-Errors). A thrown object gives `[object Object]` or `'Test failed'`. [checked shape in `playwright-internals.md` section 8; consequence inferred]                                                                                                                                                                                                       |
| #6269 collection failures -> false Survived (fixed)        | See section 4.                                                                                                                                                                                                                                               | Already handled: `PROTO:113-117` returns `Error` when the reporter got errors and no test failed; Playwright reports test-file load errors through `onError`. [checked code; Playwright behaviour inferred]                                                                                                                                                                                                                                                                                                               |
| Timeouts / restarts                                        | vitest-runner has no timeout handling of its own: core kills the process on timeout and the restart rebuilds Vite and the browser. Hit limit covers runtime infinite loops (`timeout-on-infinite-loop.it.spec.ts`), not module-evaluation loops (section 2). | `PROTO:97-111` stops its own run 500 ms before Stryker's timeout so the webServer survives, which vitest-runner does not try. Risk: `stopTests()` fixture teardown can outlast the 500 ms margin (teardown has its own heartbeat timeout, `playwright-internals.md` section 7) and core then restarts the process anyway. [inferred] The init script sets `hitCount = 0` before any page script (`HOOK:76-79`), so module-evaluation loops in the page **are** caught, which is better than vitest-runner. [checked code] |

## 6. Concurrency

- One Vitest instance per Stryker worker process, so one Vite server per project and one browser per browser project per worker. [checked `VTR:207`; per-process from `packages/core/src/child-proxy/child-process-proxy.ts:83`, which sets `STRYKER_MUTATOR_WORKER` per child]
- Inside a worker, `maxWorkers: 1` and `maxConcurrency: 1` keep one page and serial tests. [checked `VTR:179-182`, `VTR:213`]
- **No port handling** in vitest-runner. [checked: no port code in `VTR`] Vitest's browser server defaults to port 63315 and Vite moves to the next free port unless `strictPort`. [checked `vitest@5.0.5 dist/chunks/constants.-juJ8b_4.js:3`, CLI help text `dist/chunks/cac.CLrZKo1g.js:687`] Concurrency works because every worker owns its own server on an automatic port. [inferred]
- Per-worker files are named with `STRYKER_MUTATOR_WORKER` (the setup file). [checked `VTR:82-84`]
- The prototype's `webServer` has a fixed URL. With `concurrency > 1`, the second worker's `runGlobalSetup` would find the port taken and, with `reuseExistingServer: true`, reuse worker 1's server. Every worker shares one sandbox and activation happens in the page, so serving all workers from one server is correct. The lifetime is not: the server belongs to worker 1, and it dies when worker 1 restarts or is disposed. [inferred]

## 7. Integration test design (`BMIT`)

What it asserts, and why each assertion matters:

1. **Exact test list** from the dry run: id, file name, display name, status. [checked `BMIT:51-74`]
2. **Exact per-test and static coverage** (`deep.eq` on the full `mutantCoverage`, including hit counts like `'33': 4`). The fixture source is **pre-instrumented and checked in** (`// This file is generated with tasks/instrument-test-resources.js`), so mutant ids are stable and the test needs no Stryker core. [checked `BMIT:76-138`, `testResources/browser-project/src/math.component.ts:1`]
3. **Kill with selection precision**: `killedBy == [test3]`, `nrOfTests == 1`, and `failureMessage` contains `'42 - 2 = 44'`. The message check proves the _intended_ mutant was active, not that something else broke. [checked `BMIT:142-155`]
4. **State does not leak between runs** on one long-lived runner: kill then survive, survive then kill. [checked `BMIT:157-209`]
5. **Static mutant** kill, with a message that only the static mutant can produce (`'42 - 2 = undefined'`). [checked `BMIT:211-226`]
6. **No artifacts**: no `.png` anywhere under cwd after a killed mutant. [checked `BMIT:228-248`]
7. Separate spec: **hit limit** gives Timeout with "Hit limit reached", and the hit counter resets between runs. [checked `test/integration/timeout-on-infinite-loop.it.spec.ts`]
8. Uses namespace `__stryker2__` via `createVitestTestRunnerFactory('__stryker2__')`, so StrykerJS can mutation-test the runner itself without the fixture's namespace colliding with its own. [checked `BMIT:34-36`, `VTR:438-455`]

The prototype has no `test/` directory. [checked `ls packages/stryker-playwright-runner`] Its checks so far are whole `stryker run`s on the demo and a benchmark script (`tools/bench-playwright-runs.mjs`). [checked `decisions.tsv`, `todo.md`]

## Lessons for the Playwright runner

Ordered by how much each changes the result's correctness, then speed.

### L1. Set `currentTestId` per test, not per browser context

- **Prototype today**: `HOOK:24-28` tags each context with `test.info().testId` once, at context creation, and the init script freezes that id into `__stryker__.currentTestId` (`HOOK:81-83`). Playwright sets the current TestInfo to the **first test's** before running `beforeAll` hooks (`PW/worker/workerProcessEntry.js:1596-1597` then `:1642`). [checked] A context created in `beforeAll` or a lazily created worker-scoped fixture (the serial-mode "shared page" pattern) is therefore tagged with the first test's id, and all later tests' coverage is credited to it. [inferred] Core would then run only that first test for mutants that only later tests reach, and report false Survived. [inferred]
- **vitest-runner**: updates `currentTestId` in `beforeEach` and clears it in `afterEach`, so hook and module code goes to `static`. [checked `SETUP:54-60`]
- **Recommendation: adapt.** The safe minimum: when the context outlives one test, attribute its coverage to every test that ran while it was open, or to `static`. That over-approximates (slower, never a false Survived). The precise version: push the new id into the open pages when the test changes, e.g. from a `playwright-core` instrumentation callback (`onApiCallBegin` exists in the client, `PW-core lib`), comparing `test.info().testId` with the last pushed id. Add a fixture with a `beforeAll`-shared page to the demo to prove whichever is chosen.

### L2. Fail the dry run loudly when no coverage came back

- **Prototype today**: `PROTO:63-71` accepts a complete dry run with zero snapshots; `mergeCoverage` returns empty maps. [checked]
- **vitest-runner**: has no such guard, but #5305 shows the failure class (hooks not running -> nothing measured), and it only warns for the `related` case (`VTR:251-260`). [checked]
- **Recommendation: adopt, stricter than upstream.** If tests ran and no frame reported a `__stryker__` namespace, return `DryRunStatus.Error` with a message naming the likely causes: hook not installed, server serving an un-instrumented build, `reuseExistingServer` picked up an outside server. This is also the "prove the check can fail" item in `todo.md`.

### L3. Do not reuse an outside web server

- **Prototype today**: runs the user's `webServer` config as is; the demo has `reuseExistingServer: true`. [checked]
- **vitest-runner**: the analogous problem (#6243) is the server reading files from outside the sandbox. [checked]
- **Recommendation: adapt.** Override `webServer.reuseExistingServer = false` for the Stryker run, or at least log a warning when it is true. L2 catches the case after the fact; this prevents it.

### L4. Turn off failure artifacts

- **Prototype today**: no override (`PROTO:48` passes `{}`). Workers write into Playwright's default `outputDir`. [checked]
- **vitest-runner**: forces `screenshotFailures = false` globally and per project and has a test for it (#5242). [checked `VTR:225-232`, `BMIT:228-248`]
- **Recommendation: adopt.** Pass `{ use: { screenshot: 'off', video: 'off', trace: 'off' }, outputDir: <per-worker temp dir> }` as `TestRunner` overrides (`PW/common/index.js:582-589` merges `configCLIOverrides.use` last and takes `outputDir` first). [checked merge; per-run effect inferred] Copy the "no `.png`/`.zip`/`.webm` under cwd after a killed mutant" assertion.

### L5. Keep relying on a fresh realm per run, and write the assumption down

- **Prototype today**: claims `reloadEnvironment: true` and ignores `mutantActivation` and `reloadEnvironment`; the init script sets `activeMutant` before any page script (`HOOK:72-74`), which is "static" activation every time. [checked]
- **vitest-runner**: the same shape: it claims the capability, ignores the option, and depends on Vitest creating a fresh iframe per file per run. [checked section 2]
- **Recommendation: adopt as is.** Fresh workers plus a fresh context per test give a fresh realm, so static and runtime mutants both work. One difference to state in docs: in e2e the app loads inside each test, so module-level code is covered **per test**, not `static` as in vitest. Core can therefore filter tests for most "static" mutants. [inferred] The limit is code the browser never runs, such as Node-side server code; that code is out of reach of this design.

### L6. Make error text diagnosable

- **Prototype today**: `PROTO:148` `result.error?.message ?? 'Test failed'`; `PROTO:155` `error.message ?? String(error)`. [checked]
- **vitest-runner**: open bug #6233 is exactly this: `[object Object]` reasons. [checked]
- **Recommendation: adopt the fix upstream lacks.** Format a `TestError` as `message ?? value`, add the first `stack` lines and `location`, and test it with a fixture that throws a non-Error.

### L7. Report bail-interrupted tests the way vitest-runner does

- **Prototype today**: maps `outcome()` and reports `skipped` as `TestStatus.Skipped`. [checked `PROTO:17`, `PROTO:136`] After `maxFailures` hits, running tests get status `interrupted` and `computeTestCaseOutcome` returns `'skipped'` for them. [checked `PW/common/index.js:2507-2531`; `playwright-internals.md` section 7]
- **vitest-runner**: drops tests that never got a result because of bail. [checked `VTR:327-329`]
- **Recommendation: adapt.** Skip `onTestEnd` entries whose last result is `interrupted`, or a `skipped` result with `expectedStatus !== 'skipped'`. Then `nrOfTests` counts tests that actually ran. This is a reporting fix only; the kill verdict does not change.

### L8. Per-worker server for `concurrency > 1`

- **Prototype today**: fixed URL, `concurrency: 1` in `stryker.e2e.config.mjs`. [checked]
- **vitest-runner**: one server per worker on an automatic port; no runner code. [checked section 6]
- **Recommendation: adapt when concurrency is needed, ignore until then.** Playwright's `webServer.port`/`url` is fixed per config. Either let the config read a port from an env var the runner sets (`base + STRYKER_MUTATOR_WORKER`, the same variable vitest-runner uses for its setup file), or start one server outside the workers and tear it down from the main process. The second option uses less memory and matches the shared sandbox.

### L9. Do not try to copy vitest-runner's long-lived host

- **Prototype today**: about 2.7 s fixed per run, from config reload and worker start. [checked `decisions.tsv`]
- **vitest-runner**: keeps config, Vite and the page alive and only swaps iframes. [checked section 1]
- **Recommendation: ignore.** `TestRunner.runTests` reloads config and forks workers by design, and a shared browser was measured as no gain. Matching vitest-runner would mean writing a worker host of our own instead of using Playwright's. Record 2.7 s per mutant as the cost floor of this design.

### L10. Copy the integration test shape

- **Prototype today**: no runner-level tests. [checked]
- **vitest-runner**: `BMIT` plus the timeout spec (section 7). [checked]
- **Recommendation: adopt**, against a tiny checked-in **pre-instrumented** page so mutant ids are fixed: exact dry-run coverage `deep.eq`; kill with `killedBy`, `nrOfTests == 1` and a mutant-specific failure message; kill->survive and survive->kill on one runner instance (catches leftover `process.env` from `setEnv`); a static (module-level) mutant; hit limit -> Timeout plus reset between runs; no artifacts on disk; a `beforeAll`-shared-page test for L1; a zero-coverage dry run that must error, for L2. Run it under a non-default namespace (`__stryker2__`) as vitest-runner does, so the prototype can be mutation-tested later.
