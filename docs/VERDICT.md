# Verdict: a StrykerJS test runner for Playwright Test

Status: prototype, 2026-10-25. Throwaway code. The decisions transfer, and the code does not have to.

## The question

Can one StrykerJS test-runner plugin run Playwright e2e tests and Playwright component tests with
per-test coverage, and without rebuilding or restarting the app for every mutant?

The only routes before this prototype were Stryker's `command` runner plus a per-project trick to get
the active mutant into the browser: a Vite `define` and a dev-server restart per mutant
(`Huluvu424242/stryker-playwright-hello-world`), or a rebuilt component bundle per mutant
(`RedHatInsights/nxtcm-components`). Neither has coverage analysis, so every mutant runs every test.

## The answer

Yes, with one plugin (`testRunner: 'playwright'`) for both kinds of test. Playwright 1.63 removed the
`@playwright/experimental-ct-*` packages. Component tests are now plain `@playwright/test` tests that
call the built-in `mount()` fixture against your own dev server. The same runner code runs both, with no
component-specific branch.

It also ran, with no runner change, on copies of four open-source repos: the hello-world repo (7
mutants), the Angular/Nx RealWorld app (48), ngx-yeti (2, with 234 e2e tests), and Analog (8). Treat
that as a smoke test, not a broad validation. The runner's author chose each file to mutate, every copy
needed changes before its suite passed (an upstream test bug, a build switch, an ignore entry), and the
Analog file has no server-only code, so it does not exercise server-side rendering. The Evidence section
lists the changes, and Limits lists the general ones.

## How it works

- Stryker compiles every mutant into one instrumented build (mutant schemata). The instrumented code
  reads `globalThis.__stryker__.activeMutant` on every call, so the build never changes between mutants.
- The runner hosts Playwright's `TestRunner` from `playwright/lib/runner` inside the Stryker worker
  process. `runGlobalSetup` starts `webServer` and global setup once. Each dry run or mutant run calls
  `runTests({ testIds })`, so test selection uses Playwright's own stable test ids.
- `worker-hook.ts` is preloaded into Playwright's worker processes through `NODE_OPTIONS=--import`. It
  registers a listener on `playwright-core`'s client instrumentation. On every new browser context it
  calls `context.addInitScript` to set `activeMutant`, `currentTestId`, and the hit limit before any page
  script runs. Before the context closes it reads `__stryker__.mutantCoverage` and the hit count from
  every frame.
- Coverage survives same-origin navigations through `sessionStorage`. A context that outlives its test
  (created in `beforeAll` or a worker fixture) reports its coverage as static, so Stryker runs every test
  for those mutants instead of crediting the wrong one. `page.close()` and `browser.close()` skip the
  before-close hook for what they close, so the hook reads those pages first. The dry run warns about
  frames that did not answer in time and logs how much coverage came from shared contexts.
- Each mutant run passes Stryker's timeout, less 5 s, to Playwright as the per-test timeout. A test that
  hits that timeout makes the mutant a Timeout. If the looping test starts within about the first 3 s of
  the run and does not raise its own timeout, an infinite loop with no hit limit ends inside Playwright,
  and the worker and `webServer` stay up. The 5 s is a 3 s budget for the run to start plus 2 s for
  reading coverage from the hung page, so a test that starts later runs past Stryker's timer (inferred
  from the constants in `playwright-test-runner.ts`). Mutant runs turn off the page snapshot that
  Playwright takes of a failed test for its error prompt (`PLAYWRIGHT_NO_COPY_PROMPT`). On a page stuck
  in a loop, that snapshot waits out a 5 s timeout. With the snapshot on, a timed-out run took 12.5 s on
  an 8 s budget, past Stryker's timer. With it off, the same run took about 7 s. Stryker's own timer
  stays as the backstop. When it fires, the runner stops the
  Playwright run, Stryker kills the worker's process tree, and a fresh worker starts.
- Before each run, and again after a run with a failing test, the runner checks every `webServer` the way
  Playwright does at startup (an HTTP request for a `url`, a TCP connection for a `port`). When a server is
  down, the runner reruns global setup and, after a failing run, reruns the mutant once. A server that dies does
  not turn mutants into kills. The restart counts against the mutant's timeout, so a restart that takes
  long (a server that builds first) turns that mutant into a Timeout instead.
- Per-run settings, the active mutant, and the `NODE_OPTIONS` preload of the hook reach Playwright's
  workers through environment variables (`src/protocol.ts`). The runner sets these variables only while
  a run lasts, because Playwright forks fresh workers for every run and they inherit `process.env`. The
  `webServer` and global setup never see them.
- The runner fails loudly instead of reporting survivors when the internals it calls are missing, when
  tests ran but the hook never installed, when a mutant run produced no test results, or when the
  Playwright run was interrupted. A dry run without tests comes back empty, so Stryker's own
  `allowEmpty` decides.
- In a mutant run, a test that fails and then passes on a retry counts as failed: retries set with
  `describe.configure({ retries })` outrank the runner's `retries: 0`. A test attempt that fails on its
  own kills the mutant even when another attempt or another test timed out. A `test.fail()` test that
  fails as expected is no kill. In the dry run, a timed-out test is reported as a failed test.
- A mutant run that selects one test of a `describe.serial` group runs the whole group, because a later
  test of the chain fails on its own and would count as a kill. The dry run finds the groups through
  Playwright's internal suite flag (`_parallelMode`).
- The per-test timeout the runner sets never exceeds the largest test timeout in the Playwright config,
  so a slow mutant cannot pass a test that the user's own timeout would fail.

## Evidence

All numbers are from one Windows 11 arm64 machine shared with other sessions, so treat timings as
indicative. Each row is a single run unless it says otherwise. Commands to rerun them are at the end.

The Code column names the runner commit a row ran on. The last runner change is 53a5aa6, which moves
Playwright's output and run directories into one private temp folder. Before it, fca053d rewrote how a
run's test results become a mutant result. A row marked "before fca053d" ran on earlier code, and its
log times do not pin it to one commit. The RealWorld, ngx-yeti, and Analog logs all fall between the
two commits. A `command` runner row does not use this runner, so it has no commit.

Wall time is Stryker's own "Done in" from the run's log. The define row has no kept log, so its time is
the shell's elapsed time for the whole command.

| Case | Runner | Code | Score | Wall time |
|---|---|---|---|---|
| Demo e2e, 32 mutants in `cart.ts` | this runner, `timeoutMS` 10000 | before fca053d | 27 killed, 5 survived | 4m02s |
| Same | this runner before the per-test timeout fix, `timeoutMS` 10000 | before fca053d | 26 killed, 1 timeout, 5 survived | 4m35s |
| Same | this runner before the per-test timeout fix, `timeoutMS` 5000 | before fca053d | 26 killed, 1 timeout, 5 survived | 5m51s |
| Same | `command` runner + Vite `define`, server restart per mutant | - | 27 killed, 5 survived | 12m38s (shell) |
| Same | `command` runner, no activation (negative control) | - | 0 killed, 32 survived | 14m59s |
| Same | this runner, `--concurrency 2` (one dev server per Stryker worker) | before fca053d | 27 killed, 5 survived | 2m21s |
| Same, lines 11 to 17 (7 mutants), `timeoutMS` 1 and `timeoutFactor` 0 so Stryker's own timer fires first | this runner | 53a5aa6 | 7 timeouts | 1m28s |
| Demo CT, 27 mutants in `price-tag.tsx` via `mount()` | this runner, `timeoutMS` 10000 | before fca053d | 21 killed, 6 survived | 2m30s |
| Same | this runner, `--concurrency 2` | before fca053d | 21 killed, 6 survived | 1m26s |
| `stryker-playwright-hello-world`, 7 mutants | this runner (repo's `define` removed) | before fca053d | 6 killed, 1 survived | median 44s (43 to 46s), 5 runs |
| Same | the repo's own `command` runner setup | - | 6 killed, 1 survived | median 64s (57 to 66s), 5 runs |
| Same, `timeoutMS` 1 and `timeoutFactor` 0 so Stryker's own timer fires first | this runner | before fca053d | 7 timeouts | 36s and 32s, 2 runs |
| `angular-ngrx-nx-realworld-example-app` (Angular 21.2, Nx 22.7), 48 mutants in `auth.store.ts`, against the local API double | this runner, `timeoutMS` 10000 | fca053d | 11 killed, 15 timeouts, 10 survived, 12 no coverage | 7m41s |
| Same, with `use.actionTimeout: 5000` added to the copy's Playwright config | this runner, `timeoutMS` 10000 | fca053d | 26 killed, 10 survived, 12 no coverage | 6m00s |
| ngx-yeti (Angular, Nx, Playwright 1.63.0, static Storybook), 2 mutants in `cluster.ts`, 234 e2e tests | this runner, `playwright.workers` 2, `dryRunTimeoutMinutes` 20 | fca053d | 2 killed | 3m51s (dry run 2m57s) |
| Analog 2.8.0 `beta` (Angular 22.2, Nx 23.2, SSR), 8 mutants in `(home).page.ts`, 11 e2e tests against the built SSR server | this runner, `disableTypeChecking: true` in the copy's Vite config | fca053d | 4 killed, 4 survived | 1m45s |

`packages/stryker-playwright-runner/test/runner.test.ts` checks the runner against a fixture
instrumented by Stryker's own instrumenter. It checks that per-test coverage separates a test that
reaches a function from one that does not, coverage across a navigation to a page without the app,
static coverage for a shared `beforeAll` page and for a page the worker closes, per-test coverage for a
page the test closes, per-test coverage under `reuseContext`, a runtime kill, a static (module-level)
kill, a survivor followed by a clean kill, an Error when the selected tests no longer exist, an infinite
loop that times out inside its budget through the per-test timeout, the hit limit on an infinite loop,
that no run settings stay in the environment, a `webServer` restarted after it dies between runs, no
`test-results` folder next to the fixture's Playwright config, and that `dispose` removes the temp
directory the runner kept its output and runs in. Commit b4fedce added four of these
checks: the page the test closes, the missing tests, the per-test timeout, and the clean environment.
When they were added, each one failed with its fix removed, and with activation disabled in the hook
6 of the 16 checks then in the file failed. Those two results are from the decision log of 2026-10-25 and were not rerun
since. `runner.test.ts` does not cover Stryker's own timeout restart,
`coverageAnalysis` `'all'` or `'off'`, `workers` above 1 (the ngx-yeti run below is the only evidence
for that), or the dry-run guard.
`test/run-result.test.ts` checks without a browser how a finished run maps to a Stryker result:
retried tests, a kill next to a timeout, a timed-out test in the dry run, runs with no results,
skipped tests without the hook, and selecting whole `describe.serial` groups (that check fails with the
group selection removed). The serial-group selection has no browser check: the fixture has no serial
group.

The hello-world runs alternated the two runners (A, B, A, B) five times. The `command` runner starts
a Vite dev server for every mutant, which is the likeliest source of its extra 20 s. That cause is
inferred, not profiled.

In the forced-timeout run on the demo app (53a5aa6), Stryker killed and restarted the worker for every
mutant. Afterwards no `stryker-pw` temp folder of the runner was left in the system temp folder, no
extra Node process was running, and no port was left open. That check was made by hand after the run.
Before a fix in `dispose` (fca053d), each kill left Playwright's output directory behind.

The RealWorld run needed no change to the runner. Its disposable copy needed four, all made by
`oss/realworld/prepare.ts`. The app talks to the local API double instead of the public API. The app
gets its own port, because upstream starts a project that does not exist and reuses any server on 4200.
Two upstream tests that fail without Stryker are fixed or skipped (`docs/filings.md`). And
`.stryker-tmp` goes into `.gitignore`. Every timeout came from a mutant that breaks app startup (the
store's `providedIn`, its factory, or the `getUser` call every page makes). The tests then wait for an
element that never appears, until the test timeout ends them. Both RealWorld runs left the same 10
survivors in their JSON reports:

- 4 mutants in the `getUser` error handler. Two tests reach it, but it only repeats the
  `loggedIn: false` that the loading step already set (inferred from the source).
- `loggedIn: true` instead of `false` in the `getUser` loading step. The response sets the final value
  right after it (inferred from the source).
- The `exhaustMap` callbacks of register and update, which no UI test calls.
- Login's `navigateByUrl('/')` and logout's `navigateByUrl('login')`, each changed to
  `navigateByUrl('')`.
- Logout's error handler, which no test triggers.

`logout.spec.ts` runs logout and covers both logout survivors, so those survive a test that runs them.
It does not detect the navigation to the empty URL. The 12 uncovered mutants are the inner callbacks of
register and update, which the suite only calls through the API.

The ngx-yeti run is the only one with `playwright.workers` above 1, which `runner.test.ts` does not
cover. Coverage still came back per test. Each mutant was covered by 20 of the 234 tests, and Stryker
stopped at the first kill, after 7 tests for one mutant and after 1 for the other. On one worker the dry
run ran longer than Stryker's default 5-minute `dryRunTimeoutMinutes`. With 2 workers it took 2m57s.
The clone needed one step before Stryker could start its Storybook: building the workspace package
`yeti-css` in the clone itself, outside Stryker's sandbox (`nx run yeti-css:yeti-build`), for the
reason in the npm-workspaces entry under Limits.

Analog serves its pages from a production SSR build that the `webServer` starts once, and the page
component also runs in the browser after hydration. The four kills are the `share()` and `onNotify()`
click handlers, which run only in the browser. Two survivors empty the route's page title, which no test
checks. The other two change `requireSync: true` on `toSignal`, which looks equivalent because the
loaded data arrives synchronously either way. Nothing in this file runs only on the server, so the run
does not exercise the SSR entry under Limits. Analog's production build type-checks by default, and it
rejected Stryker's instrumented file until type checking was turned off for the run (see Limits).

## What a mutant costs, and why

A mutant run costs about 2.7 s of fixed Playwright overhead (config load 1.4 s, worker start to first
test 1.3 s, measured with `tools/bench-playwright-runs.ts`) plus the selected tests. Sharing one
browser across runs through `connectWsEndpoint` saved nothing measurable, so browser launch is not the
cost.

A killed mutant usually costs more than a surviving one: the failing test waits out its auto-waiting
assertion (`expect.timeout`, 5 s by default) before it fails. Stryker sizes its timeout from passing
tests, so with the default `timeoutMS` kills turned into timeouts. In the first CT run, 8 of 11
mutants timed out. That count is from the decision log, and the run's own log was not kept. Set
`timeoutMS` to at least twice the expect timeout. The runner warns at startup when it is lower.

## Limits

- Requires Playwright 1.63 or later. `playwright/lib/runner` is exported but undocumented, so a
  Playwright release can break the runner. The runner refuses older versions with a clear error.
- Only code that runs in the page is activated. Server-side code (SSR, API routes) runs in the
  `webServer` process, which starts once without an active mutant and reports no coverage, so those
  mutants show as NoCoverage. Code that runs on both sides (SSR plus hydration) is activated only in the
  page. A mutated client against an unmutated server render can fail hydration, which counts as a kill.
- Dependency projects (a `setup` project that logs in) run unfiltered, with the mutant active, on every
  mutant run, because Playwright adds them whenever a dependent test is selected. They add their time
  to every mutant, and a mutant that breaks the setup flow is killed by the setup test. Login in
  `globalSetup` runs once instead.
- Web workers and service workers are not covered by `addInitScript`.
- Coverage across a cross-origin navigation, from a page that closes itself (`window.close()`), or from
  a test that ends on `about:blank` is lost. A popup opened with `window.open`
  copies `sessionStorage`, so its coverage counts twice (harmless for test selection). An iframe that
  navigates within its origin drops the earlier document's coverage without counting it as lost, so
  mutants only that document reached show as NoCoverage.
- A runner that Stryker kills while its teardown hangs (a page stuck in a loop can keep `stopTests()`
  past Stryker's 2 s of grace) leaves its temp directory behind, one per such kill. Playwright's
  output directory sits inside a private temp directory, so that on a shared `/tmp` no other user can
  claim its name while Playwright deletes and recreates it, and that directory is removed last.
- Node refuses to strip types under `node_modules`, so a published package needs a JavaScript build of
  the hook and the runner. The prototype is used through a symlink, which Node resolves outside
  `node_modules`.
- `disableBail` cannot lift a `maxFailures` set in the user's Playwright config.
- The runner runs Playwright with `playwright.workers` from the Stryker config (default 1), not the
  `workers` value in the Playwright config. A suite that passes only when its tests spread over several
  workers fails the dry run. RealWorld's `auth.spec.ts` makes its user id once per worker and registers
  that user before every test, so it failed the same way under plain `npx playwright test --workers=1`.
- Playwright actions such as `click()` have no timeout of their own unless `use.actionTimeout` is set,
  so a mutant that removes or never renders an element ends its test by the test timeout. The runner
  reports that as a Timeout, not a kill. The mutation score is the same, because Stryker counts both as
  detected, and Stryker does not restart the worker for a timeout the runner reports. In the RealWorld
  run, 15 of the 26 detected mutants were timeouts. With `use.actionTimeout: 5000` in the Playwright
  config all 15 were kills, and the survivors and uncovered mutants did not change. Set
  `actionTimeout` below the per-test timeout for kills that say what broke. The wall time dropped from
  7m41s to 6m00s. That is one run each, not interleaved, and indicative only.
- Stryker links the sandbox's `node_modules` to the original project's, and npm links each workspace
  package in `node_modules` to its folder in the original. So a workspace package's build output must
  already exist in the original. A build that runs in the sandbox writes its output in the sandbox,
  while the app and its tools read the original through `node_modules`. The same holds for mutants: a
  mutated file in a workspace package that the app imports through `node_modules` is never served, so
  its mutants survive or show as NoCoverage. ngx-yeti hit the first part (its Storybook reads
  `node_modules/yeti-css/dist`).
  The cause is Stryker's sandbox, not this runner.
- A build that type-checks Angular templates rejects Stryker's instrumented code when a mutant switch
  widens a type a template uses: `// @ts-nocheck`, which Stryker adds to every instrumented file, does
  not reach Angular's template type-check. Analog's `{ requireSync: true }` on `toSignal` became
  "possibly undefined" in `data().products`. Turn off the build's type checking for the mutation run
  (Analog: `disableTypeChecking: true`). Type checking only reports diagnostics, so turning it off
  should not change the built code. That is inferred from the plugin source, not measured.
- An Nx task that the `webServer` starts in Stryker's sandbox starts an Nx daemon rooted in the sandbox.
  The daemon outlives the run, holds the sandbox open, and Stryker fails to delete it ("Failed to delete
  stryker temp directory"). The Analog run hit this. `nx daemon --stop` from the sandbox ended the
  daemon. `NX_DAEMON=false` in the `webServer` environment should prevent it. That fix is not measured.
- In an Nx workspace, `.stryker-tmp` must be in `.gitignore` (which `stryker init` adds) or `.nxignore`.
  A Stryker run that fails keeps its sandbox there, a full copy of the workspace, and Nx then finds every
  project twice and refuses to run any task, outside Stryker too.
- One server serves every mutant run, so state the app writes to its server or backend during one run is
  still there in the next. A suite that passes when run twice in a row against one dev server is fine.
  A suite that depends on a fresh backend can produce false kills or false survivors.
- With Stryker's `ignoreStatic`, mutants covered only by a shared `beforeAll` page count as static and
  are ignored.
- App code that the Node test workers import (not the page) gets the active mutant but no coverage, so
  its mutants show as NoCoverage.
- A timeout that reaches Stryker's own timer costs a full init: config load, global setup, and a
  `webServer` start, including any build that start runs. That happens when the looping test starts
  late in the run, or raises its own timeout with `test.slow()`, `test.setTimeout()`, or
  `describe.configure({ timeout })`, which outrank the per-test timeout the runner sets. A run-level
  timer that calls `stopTests()` could close this gap. Whether `stopTests()` ends a hung test promptly
  is not measured.
- A project that already bakes the active mutant into its build (a Vite `define` of
  `globalThis.__stryker__.activeMutant`) overwrites the runner's value: remove that workaround first.
  The hello-world repo scored 0 of 7 until it was removed.
- `concurrency` above 1 starts one `webServer` per Stryker worker, so each worker needs its own port. The
  demo configs derive it from `STRYKER_MUTATOR_WORKER` and turn off `reuseExistingServer` under
  Stryker, so a server already on the default port is never reused. Under Stryker the e2e config also
  starts the dev server in CI, because a `preview` server builds first and every worker would rebuild
  the sandbox's one `dist` folder.

## Rerun

```sh
npm install
npx playwright install chromium
npx tsc -p packages/stryker-playwright-runner/tsconfig.json
node --test packages/stryker-playwright-runner/test/runner.test.ts packages/stryker-playwright-runner/test/run-result.test.ts
npx stryker run stryker.e2e.config.ts
npx stryker run stryker.ct.config.ts
npx stryker run stryker.e2e.config.ts --concurrency 2
npx stryker run stryker.ct.config.ts --concurrency 2
STRYKER_BASELINE=define npx stryker run stryker.e2e.command.config.ts
STRYKER_BASELINE=off npx stryker run stryker.e2e.command.config.ts
npx stryker run stryker.e2e.config.ts --mutate apps/demo-app/src/app/cart.ts:11-17 --timeoutMS 1 --timeoutFactor 0
node tools/bench-playwright-runs.ts apps/demo-app-e2e/playwright.config.mts 3
node tools/bench-hello-world.ts <stryker-playwright-hello-world checkout> 5
node oss/realworld/prepare.ts <disposable copy of angular-ngrx-nx-realworld-example-app>
npx stryker run stryker.playwright.config.ts   # in that copy, after npm install and linking this runner
```

The demo forced-timeout run used a config file with the same settings as that command line. The
command line itself was not run.

For the RealWorld row with `use.actionTimeout: 5000`, add `actionTimeout: 5000` to the top-level `use` block of
the copy's `apps/conduit-e2e/playwright.config.ts` after `prepare.ts` has run. `prepare.ts` does not
add it. `oss/README.md` gives the steps for the hello-world forced-timeout row, ngx-yeti, and Analog.

Versions: StrykerJS 10.1.1, Playwright 1.64.1, Nx 24.0.1, Vite 8.3.5, Node 24.22.0.

## Research behind the design

- `docs/research/playwright-internals.md`: the Playwright APIs the runner depends on.
- `docs/research/prior-art-mutation-e2e.md`: mutation testing with e2e runners across tools and papers.
- `docs/research/vitest-browser-mode-prior-art.md` and `docs/research/karma-runner-prior-art.md`:
  lessons from Stryker's two first-party browser runners.
