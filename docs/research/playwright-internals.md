# Playwright internals for a StrykerJS TestRunner

Researched 2026-10-24. Every claim is tagged [checked] (source read, `path:line` given; paths at v1.64.1 unless a tag is named) or [inferred].

Source: local clone `D:/projects/github/microsoft/playwright`, tags v1.64.1 / v1.62.1 (read via `git show <tag>:<path>`). Paths are relative to the repo root unless stated.

## 1. Test selection (`--test-list`, testId)

### `--test-list <file>` format and matching (v1.64.1)

- Parser: `loadTestList` [checked `packages/playwright/src/runner/loadUtils.ts:356-389`].
  - Lines are trimmed; empty lines and lines starting with `#` are dropped.
  - Delimiter: `›` if the line contains `›` anywhere, else `>`. A title that itself contains the active delimiter breaks the parse (no escaping exists). [checked, same lines]
  - Optional first token `[project]` restricts to that project name; without it the line matches every project. [checked]
  - Second token is the file, passed through `parseLocationArg(...).file`, so a `:line:col` suffix is accepted but **discarded** - matching never uses line/column. The file is compared, POSIX-normalised, against `path.relative(config.rootDir, test.location.file)`. [checked]
  - Remaining tokens are a title-path **prefix**: a test matches when the line's titles equal the first N entries of the test's titles (describe titles + test title). So `file › suite` selects the whole suite, and `file › foo` would also select tests inside a `describe('foo')`. Exact match, no regex. [checked `loadUtils.ts:371-380`]
  - The `fileFilter` lets the loader skip files not named in the list (fast). `--test-list-invert` uses only the test filter. [checked `runner/tasks.ts:299-312`]
- Documented format with examples [checked `docs/src/test-cli-js.md:122-150`]: `[chromium] › path/to/example.spec.ts:3:9 › suite › nested suite › example test`; separators `›` or `>`; comments allowed. Same shape as `--list` output.
- Applied as a `preOnlyTestFilter`, i.e. before `.only` handling and before sharding. [checked `tasks.ts:300-301`]
- With `--test-list`, "No tests found" is not an error. [checked `tasks.ts:338-342`]
- Version: `--test-list` first appears in `program.ts` at **v1.56.0** (absent in v1.55.0). [checked: `git grep "'--test-list <file>'"` per tag, v1.50-v1.62]
- Duplicate titles: two tests with the same full title in one file are a load error (`duplicate test title "..."`), so a project + file + title path is unique per project. [checked `loadUtils.ts:305`]
- Parameterized tests: Playwright has no `test.each`; parameterized tests are loops generating distinct titles (each must be unique, see above), or parameters via projects (distinguished by `[project]`). `repeatEach` copies share the title, so a test-list line selects all repeats. [inferred from the matcher, which ignores `repeatEachIndex`]

### Selecting by `testId`

- CLI: no `--test-id` flag. [checked: `program.ts` option list, `git grep testIds v1.64.1 -- packages/playwright/src`]
- Indirect CLI route: `--last-failed` reads `failedTests: string[]` (test ids) from the last-run JSON and adds a filter `failedTestIds.has(test.id)`. [checked `runner/lastRun.ts:24-27,55-64`, `runner/testRunner.ts:432-437`, `tasks.ts:323-326`]. The file location is overridable with `--last-failed-file <file>` or env `PLAYWRIGHT_LAST_RUN_OUTPUT_FILE` [checked `program.ts:222`, `lastRun.ts:45-47`]; the flag exists from **v1.61.0** [checked per-tag grep]. So writing `{"status":"failed","failedTests":[...ids]}` to a file and running `--last-failed --last-failed-file <file>` selects by id. Caveats: the filter is a `postShardTestFilter` (applied after sharding) and the LastRunReporter overwrites that file at the end of the run. [checked `lastRun.ts:76-84`] This is an unintended use. [inferred]
- Programmatic: `TestRunner.runTests({ testIds })` / test-server `runTests({ testIds })` filter `testIdSet.has(test.id)`. [checked `runner/testRunner.ts:328-331`] See section 2.

### Stability of `testInfo.testId` / `TestCase.id`

- `id = sha1(posix(relative(project.testDir, file))).slice(0,20) + '-' + sha1('[project=' + project.id + ']' + posixFileTitle + '\x1e' + titles.join('\x1e')).slice(0,20)`; with `repeatEach > 0` the expression gets ` (repeat:N)`. [checked `common/suiteUtils.ts:36-51,85-92`]
- `project.id` is the project name, de-duplicated with a numeric suffix (`name`, `name1`, ...) in config order. [checked `common/config.ts:142-155`]
- So the id is stable across runs and machines as long as testDir-relative file path, project name (and position among same-named projects), describe titles and test title do not change. Line numbers and test order do not affect it. [checked from the formula]

## 2. Long-lived runs (test server)

### Surface

- `playwright test-server -c <config> [--host] [--port]` is a **hidden** CLI command; it prints `Listening on ws://.../<guid>`. [checked `program.ts:90-98`, `runner/testServer.ts:315-320`]
- Protocol: JSON-RPC-like over WebSocket, `{id, method, params}` -> `{id, result|error}`, events `{method, params}` without id. [checked `isomorphic/testServerConnection.ts:96-110`]
- Methods (`TestServerInterface`): `initialize`, `ping`, `watch`, `open`, `resizeTerminal`, `checkBrowsers`, `installBrowsers`, `runGlobalSetup`, `runGlobalTeardown`, `clearCache`, `listFiles`, `listTests`, `runTests`, `findRelatedTestFiles`, `stopTests`, `closeGracefully`. Events: `report` (teleReporter JSON events), `stdio`, `testFilesChanged`, `loadTraceRequested`, `testPaused`. [checked `isomorphic/testServerInterface.ts:25-131`]
- `runTests` params: `locations, grep, grepInvert, testIds, headed, workers, maxFailures, updateSnapshots, updateSourceMethod, reporters, trace, video, projects, reuseContext, connectWsEndpoint, timeout, pauseOnError, pauseAtEnd`. [checked `testServerInterface.ts:80-100`]

### Client options from Node

- `require('playwright/lib/runner')` is in the package `exports` map (both 1.62.1 and 1.64.1) and re-exports `testRunner` (`TestRunner`), `testServer` (`TestServerDispatcher`, `runTestServer`), `TestServerConnection`, `webServer`, reporters. The source comment calls it "Public re-export of TestServerConnection used by external test fixtures". [checked `packages/playwright/src/runner/index.ts` at both tags; `packages/playwright/package.json:24`; installed `node_modules/playwright/lib/runner/index.js`]. Not documented on playwright.dev; treat as semi-public/internal. [inferred]
- Three ways to drive it:
  1. Spawn `playwright test-server`, parse the ws URL, connect `new TestServerConnection(new WebSocketTestServerTransport(url))` (the transport class is in the same isomorphic file but is not re-exported; it is a 30-line wrapper over global `WebSocket`, Node >= 22 has it). [checked `testServerConnection.ts:37-66`]
  2. In-process, as `watchMode.ts` does: `new TestServerDispatcher(configLocation, {})` + an in-memory transport + `TestServerConnection`. [checked `runner/watchMode.ts:40-98,135-139`]
  3. In-process, lowest level: `new TestRunner(configLocation, overrides)`; `initialize({})`; `runGlobalSetup([reporter])`; then repeated `runTests(reporterObject, { locations: [], testIds, workers, ... })`; finally `runGlobalTeardown()`. The reporter here is a plain Reporter object (no serialisation). [checked `runner/testRunner.ts:118-122,157-188,275-336`]. `configLocation` comes from `configLoader.resolveConfigLocation(file)` (`playwright/lib/common`). [checked `testServer.ts:315`] [inferred: option 3 is the simplest for Stryker]

### Lifetime across `runTests` calls

- Config is **reloaded on every** `runTests` / `listTests` (`configLoader.loadConfig`). [checked `testRunner.ts:300-302,382-384`]
- `runTests` forces `retries: 0` and `repeatEach: 1`, and adds config reporters unless `disableConfigReporters` (in-process `TestRunner` only; the dispatcher does not pass it). [checked `testRunner.ts:286-291,324`]
- globalSetup / globalTeardown and plugin setup (which includes **`webServer`**) run only in `runGlobalSetup`; `runTests` tasks are `applyRebaselines + load + phases + reportBegin + runTests` and do not include them. Plugin instances are cached in `_plugins` and reused across config reloads. So `webServer` and globalSetup stay up from `runGlobalSetup` until `runGlobalTeardown` / `stop()`. If `runGlobalSetup` is never called, neither runs. [checked `testRunner.ts:157-188,341-345,384-392`; `tasks.ts:155-170`]
- `runGlobalSetup` returns env changes made by globalSetup; it does not re-apply them per run. [checked `testRunner.ts:166-171`]
- Workers are **not** reused across runs: each run builds new `Dispatcher`s per phase and stops them when the phase ends. Browsers are worker-scoped fixtures, so they die with the workers. [checked `tasks.ts:407,459,477-480`; worker-scoped `browser` fixture `packages/playwright/src/index.ts`, see section 3] Browser reuse across runs is possible only via `connectWsEndpoint` (`_optionConnectOptions`) to an externally launched browser server. [checked `testRunner.ts:299`]
- Version difference: at v1.62.1 `createRunTestsTasks` also runs each plugin's `begin`/`end` per run (used by experimental-ct, see section 6); `webServer` uses `setup`/`teardown`, so it is unaffected. [checked `runner/tasks.ts:164-171` at v1.62.1; `plugins/webServerPlugin.ts` not re-read - inferred from it being set up by `createPluginSetupTasks`]
- Runs are serialised through `_queue`; a new `runTests` first calls `stopTests()` on any running one. [checked `testRunner.ts:275-285,355-358`]
- Test files are loaded in a separate loader process (`createLoadTask('out-of-process', ...)`). [checked `testRunner.ts:333`] [inferred: so a test-file change is picked up each run without require-cache issues in the host]

## 3. Client instrumentation

### Presence and API

- `ClientInstrumentation` with `addListener` / `removeListener` / `removeAllListeners` and listener hooks `runBeforeCreateBrowserContext`, `runAfterCreateBrowserContext`, `runBeforeCloseBrowserContext` (+ request-context variants, `onApiCallBegin/End`, `onPage`, `onWillPause`). Implemented as a Proxy: every `run*` hook awaits each listener in registration order. [checked `packages/playwright-core/src/client/clientInstrumentation.ts:32-96` at v1.64.1]
- Same hook names present at v1.62.1 (and at v1.45.0, v1.50.0, v1.55.0). In v1.44.0 the hooks were named `onDidCreateBrowserContext` / `onWillCloseBrowserContext`, so the current names date from **v1.45.0**. [checked: `git show <tag>:.../clientInstrumentation.ts` for v1.30-v1.64]
- Reachable at runtime: `require('playwright-core')._instrumentation` is an object with `addListener`; `chromium._instrumentation` is the same object; `require('@playwright/test').chromium === require('playwright-core').chromium`. [checked: node one-liner against the installed 1.64.1]
- The test runner itself adds its own listener per test inside the `_setupArtifacts` auto fixture and removes it after the test. [checked `packages/playwright/src/index.ts:84-188`] A listener added earlier (for example at worker start) stays registered for the whole worker and runs before the runner's per-test listener. [inferred from push-order in the Proxy]
- Private API (underscore, no docs, no types export). [inferred]

### When the hooks fire (v1.64.1; identical call sites at v1.62.1)

| Path                                                                                                                                | `runAfterCreateBrowserContext`                                                                                            | `runBeforeCloseBrowserContext`                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `browser.newContext()` - used by the default `context` fixture via `_contextFactory`, and by user code                              | yes, awaited before `newContext` returns [checked `client/browser.ts:63-65,82-95`; fixture `index.ts:400-424`]            | yes, from `context.close()`, before the close RPC [checked `client/browserContext.ts:516-528`]    |
| Reused context (`_newContextForReuse`, `reuseContext: true` / `_optionContextReuseMode: 'when-possible'` / `PW_TEST_REUSE_CONTEXT`) | yes, every test (the fixture calls `_newContextForReuse` per test) [checked `browser.ts:67-69,82-95`; `index.ts:474-492`] | yes, from `_disconnectFromReusedContext` at test end [checked `browser.ts:71-80`; `index.ts:491`] |
| `browserType.launchPersistentContext()`                                                                                             | yes [checked `client/browserType.ts:92-118`]                                                                              | yes, through `context.close()` [checked]                                                          |
| `connect`/`connectOverCDP` default context                                                                                          | yes [checked `browserType.ts:177-183`]                                                                                    | when closed via `close()` [inferred]                                                              |
| Contexts announced by the server (`'context'` event, `_didCreateContext`)                                                           | no [checked `browser.ts:54,108-116`]                                                                                      | -                                                                                                 |

- Reuse is effective only when video is `off`. [checked `index.ts:466-472`]
- 1.62.1 call sites: `browser.ts:75,93`, `browserType.ts:118,180`, `browserContext.ts:523`. [checked]

### Init scripts under context reuse

- On `_disconnectFromReusedContext` the server disposes the context's dispatcher: `disposeAll(this._disposables)`, and every `addInitScript` result is pushed into `_disposables`. So init scripts (and routes, exposed bindings) added through the client are **removed** between tests. [checked `server/dispatchers/browserDispatcher.ts:87-94`; `server/dispatchers/browserContextDispatcher.ts:308-312,448-470`]
- `resetForReuse` closes extra pages, navigates the remaining page to `about:blank`, resets clock, UA, media, viewport, storage state. [checked `server/browserContext.ts:221-254`; `server/browser.ts:130-140`]
- Because `runAfterCreateBrowserContext` fires again for each reused test, a listener that calls `context.addInitScript` re-adds it per test with no extra code. The page survives, so the script applies from the test's first navigation onwards, not to the already-loaded `about:blank`. [inferred from the above]

## 4. Getting code into workers

- Workers: `child_process.fork(require.resolve('../worker/workerProcessEntry.js'), { detached: false, env: { ...process.env, ...extraEnv }, stdio: ['ignore', pipe|inherit, pipe|inherit, 'ipc'] })`. No `execArgv` option is passed, so Node's default applies: the child inherits the runner's `process.execArgv`. [checked `runner/processHost.ts:54-70`, `runner/workerHost.ts:47-53`; Node default is documented fork behaviour - inferred, not read here]
- `extraEnv` = project-dependency produced env + `FORCE_COLOR=1`, `DEBUG_COLORS`. [checked `workerHost.ts:49-53`; `runner/tasks.ts:436-447`]
- Playwright never reads or rewrites `NODE_OPTIONS` or `execArgv` in `packages/playwright/src`. [checked: `git grep "NODE_OPTIONS\|execArgv" v1.64.1 -- packages/playwright/src` returns nothing] So `NODE_OPTIONS=--require <file>` set in the runner's environment reaches every worker (and the out-of-process loader), and so does `--require` on the runner's own command line. [inferred from env spread + default execArgv]
- `process.env` is copied at fork time, so env vars set by globalSetup (runner process) before workers fork are visible in workers. [inferred from `env: {...process.env}`]
- The config file is **re-required in every worker**: `_loadIfNeeded` -> `configLoader.deserializeConfig` -> `loadConfig` -> `requireOrImport(resolvedConfigFile)`. Top-level side effects of a wrapper config therefore run once per worker process (and once per `runTests` in the host, since the host reloads too). The worker looks the project up by id and fails if project names change between runner and worker. [checked `worker/workerMain.ts:200-212`; `common/configLoader.ts:89-108`]
- Official per-worker hook: worker-scoped auto fixtures (`{ scope: 'worker', auto: true }`), but they need `test.extend` in the import chain of the test files - config cannot add fixtures. Config `use` only sets option values. There is no `workerSetup` config key. [inferred from fixture model; checked that `globalSetup` runs only in the runner via `createGlobalSetupTasks`, `tasks.ts:155-162`]

## 5. Built-in `mount` fixture (1.64) and experimental-ct status

- The built-in `mount` fixture was introduced in **1.62**, not 1.64 (release notes "Version 1.62 / New component testing model"). [checked `docs/src/release-notes-js.md:312-330` at v1.64.1; fixture present at v1.62.1 `packages/playwright/src/index.ts:498-512`]. The public `reuseContext` option also first appears in 1.62 (absent in v1.61.0). [checked per-tag grep]
- Implementation (v1.64.1) [checked `packages/playwright/src/index.ts:507-534`]:
  - `mount(storyId, props?)` throws if `baseURL` is unset, then **always `await page.goto(baseURL)`**, then `page.evaluate(p => window.mount(p), { story, props }, { exposeFunctions: true })` (callbacks in props become browser-callable functions), and returns `page.locator('#root')` with `update(newProps)` (calls `window.mount` again, no navigation) and `unmount()` (`window.unmount?.()`).
  - So every `mount()` is a fresh document load of the gallery page; init scripts registered on the context run on each mount. [checked + inferred]
  - Uses the ordinary `page` fixture; with `reuseContext` the page is the reused one (`context.pages()[0]`), and `goto(baseURL)` still loads a fresh document. [checked `index.ts:494-505`]
- Docs: the gallery is a page served by the user's own dev server exposing `window.mount({story, props})` / `window.unmount()` rendering into `#root`; "Playwright does not compile or serve anything". The recommended config sets `baseURL` to the gallery, `serviceWorkers: 'block'`, **`reuseContext: true`** ("a large speedup for component suites, and the same optimization the experimental packages applied implicitly"), and a `webServer` running `npm run dev` with `reuseExistingServer: !process.env.CI`. "Each `mount()` navigates fresh, so tests are fully isolated". [checked `docs/src/test-components-js.md:37-47,78-104,252`]
- Implication for Stryker: the component bundle is served by the user's dev server (typically Vite dev, unbundled ESM), so Stryker's instrumented sources are served as-is and one long-lived `webServer` can serve all mutants; the active mutant is switched by the injected `__stryker__` global, not by rebuilding. [inferred]
- Status of `@playwright/experimental-ct-*`:
  - 1.63 release notes: "The experimental `@playwright/experimental-ct-react`, `@playwright/experimental-ct-react17` and `@playwright/experimental-ct-vue` packages will no longer be updated. Follow the migration guide ... to move to the stories model introduced in 1.62." [checked `release-notes-js.md:297`]
  - 1.64 docs: "...have been removed and are no longer published. If you are still on them, stay on Playwright 1.62..." [checked `test-components-js.md:22-24`]
  - Repo: `packages/playwright-ct-core`, `-ct-react`, `-ct-react17`, `-ct-vue` exist at v1.62.1 and are gone at v1.63.0 and v1.64.1. [checked `git ls-tree v1.62.1|v1.63.0|v1.64.1 packages/`]
  - npm: `@playwright/experimental-ct-react` dist-tags `latest: 1.62.1`, `next: 1.63.0-alpha-...`; no 1.63/1.64 release; latest version not marked `deprecated`. [checked registry.npmjs.org, 2026-10-24]. Earlier: `-ct-svelte` removed, `-ct-vue2` and `-ct-solid` frozen in older releases. [checked `release-notes-js.md:888,1455-1456`]
  - So: frozen at 1.62.1, which requires `@playwright/test` 1.62.x. [inferred from the "stay on Playwright 1.62" wording]

## 6. experimental-ct-core at v1.62.1

- It is a `TestRunnerPlugin` (`playwright-vite-plugin`). `begin()` calls `buildBundle()` then starts **`vite preview`** (static server over the built output) and sets `process.env.PLAYWRIGHT_TEST_BASE_URL` in the runner process; `end()` closes the preview server. [checked `packages/playwright-ct-core/src/vitePlugin.ts:44-80`] Workers fork after `begin`, so they inherit that env var. [inferred from section 4]
- Build = **`vite build`** (not dev server): `root: <ctTemplateDir|'playwright'>`, input `index.html`, `outDir: ctCacheDir ?? <templateDir>/.cache`, `target: esnext`, `minify: false`, `treeshake: false`, `sourcemap: true`, user `ctViteConfig` merged on top. Port: `ctPort || baseURL port || 3100`, host from `baseURL`. [checked `viteUtils.ts:45-70,72-149`]
- Cache (`<outDir>/metainfo.json`) is rebuilt when any of these changes: Playwright version, Vite version, hash of the injected register source + framework register file, a component imported by tests not in the stored registry, or the **mtime** of any source file Vite transformed during the last build (missing file also counts). Otherwise the build is skipped and only the preview server starts. [checked `vitePlugin.ts:103-181,183-197,199-223`] `clearCache` deletes `outDir`. [checked `vitePlugin.ts:82-86`]
- Lifetime per run: in 1.62.1 `createRunTestsTasks` contains a `plugin begin` task per plugin, so `begin`/`end` (cache check + preview server start/stop) run on **every** run, including each test-server `runTests`. [checked `packages/playwright/src/runner/tasks.ts:164-171,211-221` at v1.62.1]. That task no longer exists at v1.64.1. [checked `tasks.ts:164-170` at v1.64.1]
- For Stryker with mutant schemata: instrumented files are written once, so mtimes stay constant and the bundle is built once; mutant switching through `__stryker__.activeMutant` needs no rebuild. [inferred]
- Context reuse: the CT fixtures set `_optionContextReuseMode: 'when-possible'` and `serviceWorkers: 'block'`. [checked `packages/playwright-ct-core/src/mount.ts:41-45`]
- Page reload: the CT `page` fixture does `page.goto(PLAYWRIGHT_TEST_BASE_URL)` once **per test** (wrapped as internal). `mount()` itself does not navigate; it calls `window.playwrightMount` via `innerMount`. So: one fresh document per test, several mounts in a test share it. [checked `mount.ts:47-78,102-130`]

## 7. Bail (`--max-failures`)

- `-x` = `--max-failures=1`. [checked `docs/src/test-cli-js.md:97`]
- When a test end report pushes `failedTestCount` to the limit (counted only after the last retry), the `JobDispatcher` calls its `onMaxFailuresReached` callback = `Dispatcher.stop()`, and reports "Testing stopped early after N maximum allowed failures." [checked `runner/dispatcher.ts:686-697,119`]
- `Dispatcher.stop()` calls `worker.stop()` on **all** worker slots at once. `ProcessHost.stop()` sends `__stop__`; the worker runs `gracefullyClose()` -> `_stop()` -> `this._currentTest?._interrupt()`, which interrupts the test's timeout manager and marks it `interrupted`; then it tears down test- and worker-scoped fixtures (closing browsers). [checked `dispatcher.ts:300-306`; `processHost.ts:164-193`; `common/process.ts:80-86`; `worker/workerMain.ts:102-125`; `worker/testInfo.ts:411-418`]
- Tests that end after the limit is reached are reported with status `interrupted` and empty errors; queued tests are not scheduled. [checked `dispatcher.ts:352-358,333-335,98-100`]
- So the stop is prompt across workers: running tests are interrupted, not awaited. Remaining cost is fixture teardown time (bounded by a heartbeat-based timeout, default 5 min, then force-kill). Teardown-phase projects ignore maxFailures. [checked `processHost.ts:172-189`; `tasks.ts:379,407`]
- Available as `maxFailures` on test-server / `TestRunner.runTests`. [checked `testRunner.ts:308`]

## 8. Reporter data

- Reporter hooks: `onBegin(config, suite)`, `onTestBegin(test, result)`, `onTestEnd(test, result)`, `onStepBegin/End`, `onStdOut/Err`, `onError(error)`, `onEnd(result)`, `onExit()`. [checked `packages/playwright/types/testReporter.d.ts:147-228`]
- `TestCase` [checked `testReporter.d.ts:460-581`]: `id` (section 1), `title`, `titlePath()`, `location {file, line, column}`, `parent: Suite`, `results: TestResult[]`, `outcome()` (`skipped|expected|unexpected|flaky`), `ok()`, `expectedStatus`, `annotations`, `tags`, `retries`, `repeatEachIndex`, `type: 'test'`.
  - No `projectName` field: use `test.parent.project()?.name` (`Suite.project()`, `testReporter.d.ts:405`) or `titlePath()[1]`; full `titlePath()` is `['', projectName, fileRelativePath, ...describes, title]`. [checked `Suite.project` in d.ts; titlePath shape inferred from `loadUtils.ts:373` which destructures `[projectName, , ...titles]` before the root suite exists]
- `TestResult` [checked `testReporter.d.ts:624-760`]: `status` (`passed|failed|timedOut|skipped|interrupted`), `duration`, `error`, `errors: TestError[]`, `retry`, `workerIndex`, `parallelIndex`, `startTime`, `attachments`, `stdout`, `stderr`, `steps`, `annotations`.
- `TestError`: `message`, `stack`, `location`, `snippet`, `value`, `cause`. [checked `testReporter.d.ts:587-620`]
- Adding a reporter without dropping the user's:
  - `--reporter` **replaces** config reporters: `reporter = [...takeFirst(cliOverrides.reporter, userConfig.reporter, [[default]]), ...additionalReporters]`. [checked `common/config.ts:104`; `cli/testActions.ts:123`]
  - `--add-reporter <reporter>` appends to the configured reporters; exists from **v1.63.0** (absent in v1.62.1). [checked `program.ts:209` at v1.63.0/v1.64.1; `testActions.ts:124`; docs `test-cli-js.md:82`]
  - Env `PW_TEST_REPORTER=<name|path>` appends one reporter on top of whatever is configured; present in **both** 1.62.1 and 1.64.1. [checked `runner/reporters.ts:66-74` at v1.64.1, `:67-68` at v1.62.1] Undocumented. [inferred]
  - In-process `TestRunner.runTests(userReporter, ...)` gets config reporters **plus** the passed reporter object (or only it with `disableConfigReporters: true`). [checked `testRunner.ts:324-325`]
