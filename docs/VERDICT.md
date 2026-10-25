# Verdict: a StrykerJS test runner for Playwright Test

Status: prototype, 2026-10-24. Throwaway code. The decisions transfer, and the code does not have to.

## The question

Can one StrykerJS test-runner plugin run Playwright e2e tests and Playwright component tests with
per-test coverage, and without rebuilding or restarting the app for every mutant?

The only routes before this prototype were Stryker's `command` runner plus a per-project trick to get
the active mutant into the browser: a Vite `define` and a dev-server restart per mutant
(`Huluvu424242/stryker-playwright-hello-world`), or a rebuilt component bundle per mutant
(`RedHatInsights/nxtcm-components`). Neither has coverage analysis, so every mutant runs every test.

## The answer

Yes, with one plugin (`testRunner: 'playwright'`) for both kinds of test. Playwright 1.63 removed the
`@playwright/experimental-ct-*` packages; component tests are now plain `@playwright/test` tests that
call the built-in `mount()` fixture against your own dev server. The same runner code runs both, with no
component-specific branch.

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
- Each mutant run passes Stryker's timeout, less 5 s, to Playwright as the per-test timeout, and a test
  that hits it makes the mutant a Timeout. An infinite loop with no hit limit therefore ends inside
  Playwright, and the worker and `webServer` stay up, as long as the looping test starts within about
  the first 5 s of the run and does not raise its own timeout. Mutant runs turn off the page snapshot Playwright
  takes of a failed test for its error prompt (`PLAYWRIGHT_NO_COPY_PROMPT`): on a page stuck in a loop
  it waits out a 5 s timeout, which pushed a timed-out run from about 7 s to 10 s and past Stryker's
  timer. Stryker's own timer stays as the backstop: when it
  fires, the runner stops the Playwright run, Stryker kills the worker's process tree, and a fresh worker
  starts.
- Before each run, and again after a run with a failing test, the runner checks every `webServer` the way
  Playwright does at startup (an HTTP request for a `url`, a TCP connection for a `port`). When one is
  down it reruns global setup and, after a failing run, reruns the mutant once. A server that dies does
  not turn mutants into kills. The restart counts against the mutant's timeout, so a restart that takes
  long (a server that builds first) turns that mutant into a Timeout instead.
- Per-run settings, the active mutant, and the `NODE_OPTIONS` preload of the hook reach Playwright's
  workers through environment variables (`src/protocol.ts`) that are set only while a run lasts, because
  Playwright forks fresh workers for every run and they inherit `process.env`. The `webServer` and global
  setup never see them.
- The runner fails loudly instead of reporting survivors when the internals it calls are missing, when
  tests ran but the hook never installed, when a mutant run produced no test results, or when the
  Playwright run was interrupted. A dry run without tests comes back empty, so Stryker's own
  `allowEmpty` decides.
- In a mutant run, a test that fails and then passes on a retry counts as failed: retries set with
  `describe.configure({ retries })` outrank the runner's `retries: 0`. A test attempt that fails on its
  own kills the mutant even when another attempt or another test timed out; a `test.fail()` test that
  fails as expected is no kill. In the dry run, a timed-out test is reported as a failed test.

## Evidence

All numbers are from one Windows 11 arm64 machine shared with other sessions, so treat timings as
indicative. Each row is a single run unless it says otherwise. Commands to rerun them are at the end.

| Case | Runner | Score | Wall time |
|---|---|---|---|
| Demo e2e, 32 mutants in `cart.ts` | this runner, `timeoutMS` 10000 | 27 killed, 5 survived | 4m05s |
| Same | this runner before the per-test timeout fix, `timeoutMS` 10000 | 26 killed, 1 timeout, 5 survived | 4m39s |
| Same | this runner before the per-test timeout fix, `timeoutMS` 5000 | 26 killed, 1 timeout, 5 survived | 5m51s |
| Same | `command` runner + Vite `define`, server restart per mutant | 27 killed, 5 survived | 12m35s |
| Same | `command` runner, no activation (negative control) | 0 killed, 32 survived | 14m59s |
| Same | this runner, `--concurrency 2` (one dev server per Stryker worker) | 27 killed, 5 survived | 2m24s |
| Demo CT, 27 mutants in `price-tag.tsx` via `mount()` | this runner, `timeoutMS` 10000 | 21 killed, 6 survived | 2m29s |
| Same | this runner, `--concurrency 2` | 21 killed, 6 survived | 1m29s |
| `stryker-playwright-hello-world`, 7 mutants | this runner (repo's `define` removed) | 6 killed, 1 survived | median 46s (45 to 48s), 5 runs |
| Same | the repo's own `command` runner setup | 6 killed, 1 survived | median 66s (58 to 69s), 5 runs |
| Same, `timeoutMS` 1 and `timeoutFactor` 0 so Stryker's own timer fires first | this runner | 7 timeouts | 38s |
| `angular-ngrx-nx-realworld-example-app` (Angular 21.2, Nx 22.7), 48 mutants in `auth.store.ts`, against the local API double | this runner, `timeoutMS` 10000 | 11 killed, 15 timeouts, 10 survived, 12 no coverage | 7m41s |

`packages/stryker-playwright-runner/test/runner.test.ts` checks the runner against a fixture
instrumented by Stryker's own instrumenter. It checks that per-test coverage separates a test that
reaches a function from one that does not, coverage across a navigation to a page without the app,
static coverage for a shared `beforeAll` page and for a page the worker closes, per-test coverage for a
page the test closes, per-test coverage under `reuseContext`, a runtime kill, a static (module-level)
kill, a survivor followed by a clean kill, an Error when the selected tests no longer exist, an infinite
loop that times out inside its budget through the per-test timeout, the hit limit on an infinite loop,
that no run settings stay in the environment, a `webServer` restarted after it dies between runs, and no
artifacts on disk. Each of the three newest checks fails with its fix removed, and with activation
disabled in the hook 6 of the 16 checks fail. It does not cover Stryker's own timeout restart,
`coverageAnalysis` `'all'` or `'off'`, `workers` above 1, or the dry-run guard.
`test/run-result.test.ts` checks without a browser how a finished run maps to a Stryker result:
retried tests, a kill next to a timeout, a timed-out test in the dry run, runs with no results, and
skipped tests without the hook.

The hello-world runs alternated the two runners (A, B, A, B) five times. The `command` runner starts
a Vite dev server for every mutant, which is the likeliest source of its extra 20 s; that is inferred,
not profiled. In the forced-timeout run Stryker killed and restarted the worker for every mutant, and
afterwards no browser, Vite, or extra Node process was left running, and no temp directory of the
runner was left in the system temp folder (before a fix in `dispose`, each kill left Playwright's
output directory behind).

The RealWorld run needed no change to the runner. Its disposable copy needed four, all made by
`oss/realworld/prepare.ts`. The app talks to the local API double instead of the public API. The app
gets its own port, because upstream starts a project that does not exist and reuses any server on 4200.
Two upstream tests that fail without Stryker are fixed or skipped (`docs/filings.md`). And
`.stryker-tmp` goes into `.gitignore`. Every timeout came from a mutant that breaks app startup (the
store's `providedIn`, its factory, or the `getUser` call every page makes): the tests then wait for an
element that never appears, until the test timeout ends them. The survivors are the `getUser` error
path that no signed-out test reaches, `navigateByUrl('')` where the original says `'/'`, and register,
update, and logout branches no UI test drives. The 12 uncovered mutants are register and update, which
the suite only calls through the API.

## What a mutant costs, and why

A mutant run costs about 2.7 s of fixed Playwright overhead (config load 1.4 s, worker start to first
test 1.3 s, measured with `tools/bench-playwright-runs.ts`) plus the selected tests. Sharing one browser across runs
through `connectWsEndpoint` saved nothing measurable, so browser launch is not the cost.

A killed mutant usually costs more than a surviving one: the failing test waits out its auto-waiting
assertion (`expect.timeout`, 5 s by default) before it fails. Stryker sizes its timeout from passing
tests, so with the default `timeoutMS` kills turned into timeouts (8 of 11 in the first CT run). Set
`timeoutMS` to at least twice the expect timeout; the runner warns at startup when it is lower.

## Limits

- Requires Playwright 1.63 or later. `playwright/lib/runner` is exported but undocumented, so a
  Playwright release can break the runner. The runner refuses older versions with a clear error.
- Only code that runs in the page is activated. Server-side code (SSR, API routes) runs in the
  `webServer` process, which starts once without an active mutant and reports no coverage, so those
  mutants show as NoCoverage. Code that runs on both sides (SSR plus hydration) is activated only in the
  page, and a mutated client against an unmutated server render can fail hydration, which counts as a
  kill.
- Dependency projects (a `setup` project that logs in) run unfiltered, with the mutant active, on every
  mutant run, because Playwright adds them whenever a dependent test is selected. They add their time
  to every mutant, and a mutant that breaks the setup flow is killed by the setup test. Login in
  `globalSetup` runs once instead.
- Web workers and service workers are not covered by `addInitScript`.
- Coverage across a cross-origin navigation, from a page that closes itself (`window.close()`), or from
  a test that ends on `about:blank` is lost. A popup opened with `window.open`
  copies `sessionStorage`, so its coverage counts twice (harmless for test selection).
- Node refuses to strip types under `node_modules`, so a published package needs a JavaScript build of
  the hook and the runner. The prototype is used
  through a symlink, which Node resolves outside `node_modules`.
- `disableBail` cannot lift a `maxFailures` set in the user's Playwright config.
- The runner runs Playwright with `playwright.workers` from the Stryker config (default 1), not the
  `workers` value in the Playwright config. A suite that passes only when its tests spread over several
  workers fails the dry run; RealWorld's `auth.spec.ts` registered one user per worker before every
  test and failed the same way under plain `npx playwright test --workers=1`.
- Playwright actions such as `click()` have no timeout of their own unless `use.actionTimeout` is set,
  so a mutant that removes or never renders an element ends its test by the test timeout. The runner
  reports that as a Timeout, not a kill. The mutation score is the same, because Stryker counts both as
  detected, and Stryker does not restart the worker for a timeout the runner reports. In the RealWorld
  run, 15 of the 26 detected mutants were timeouts.
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
  timer that calls `stopTests()` could close this gap; whether `stopTests()` ends a hung test promptly
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
node tools/bench-playwright-runs.ts apps/demo-app-e2e/playwright.config.mts 3
node tools/bench-hello-world.ts <stryker-playwright-hello-world checkout> 5
node oss/realworld/prepare.ts <disposable copy of angular-ngrx-nx-realworld-example-app>
npx stryker run stryker.playwright.config.ts   # in that copy, after npm install and linking this runner
```

Versions: StrykerJS 10.1.1, Playwright 1.64.1, Nx 24.0.1, Vite 8.3.5, Node 24.22.0.

## Research behind the design

- `docs/research/playwright-internals.md`: the Playwright APIs the runner depends on.
- `docs/research/prior-art-mutation-e2e.md`: mutation testing with e2e runners across tools and papers.
- `docs/research/vitest-browser-mode-prior-art.md` and `docs/research/karma-runner-prior-art.md`:
  lessons from Stryker's two first-party browser runners.
