# Verdict: a StrykerJS test runner for Playwright Test

Status: prototype, 2026-10-24. Throwaway code; the decisions transfer, the code does not have to.

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
  for those mutants instead of crediting the wrong one. `browser.close()` skips the before-close hook,
  so the hook also reads a browser's contexts just before the browser closes.
- The runner sets no timer of its own. On a timeout Stryker kills the worker's process tree, Playwright
  workers and `webServer` included, and starts a fresh worker, so a cancelled run never leaks into the
  next mutant. Before each run the runner checks that every `webServer` URL still answers and restarts
  global setup when one does not, so a server that dies mid-run cannot turn every later mutant into a
  kill.
- Per-run settings reach the hook as environment variables (`src/protocol.ts`), because Playwright forks
  fresh workers for every run and they inherit `process.env`.

## Evidence

All numbers are from one Windows 11 arm64 machine shared with other sessions; treat timings as
indicative. Commands to rerun them are at the end.

| Case | Runner | Score | Wall time |
|---|---|---|---|
| Demo e2e, 32 mutants in `cart.ts` | this runner, `timeoutMS` 5000 | 26 killed, 1 timeout, 5 survived | 5m51s |
| Same | this runner, `timeoutMS` 10000 | 26 killed, 1 timeout, 5 survived | 4m39s |
| Same | `command` runner + Vite `define`, server restart per mutant | 27 killed, 5 survived | 12m35s |
| Same | `command` runner, no activation (negative control) | 0 killed, 32 survived | 14m59s |
| Demo CT, 27 mutants in `price-tag.tsx` via `mount()` | this runner | 21 killed, 6 survived | 3m14s |
| `stryker-playwright-hello-world`, 7 mutants | this runner (repo's `define` removed) | 6 killed, 1 survived | 52s |
| Same | the repo's own `command` runner setup | 6 killed, 1 survived | 1m31s |

`packages/stryker-playwright-runner/test/runner.test.ts` checks the runner against a fixture
instrumented by Stryker's own instrumenter. It checks that per-test coverage separates a test that
reaches a function from one that does not, coverage across a navigation to a page without the app,
static coverage for a shared `beforeAll` page and for a page the worker closes, per-test coverage under
`reuseContext`, a runtime kill, a static (module-level) kill, a survivor followed by a clean kill, the hit
limit on an infinite loop, a `webServer` restarted after it dies between runs, and no artifacts on disk.
With activation disabled in the hook, the kill and hit-limit checks fail. It does not cover Stryker's own
timeout restart, `coverageAnalysis` `'all'` or `'off'`, `workers` above 1, or the dry-run guard.

## What a mutant costs, and why

A mutant run costs about 2.7 s of fixed Playwright overhead (config load 1.4 s, worker start to first
test 1.3 s; `tools/bench-playwright-runs.ts`) plus the selected tests. Sharing one browser across runs
through `connectWsEndpoint` saved nothing measurable, so browser launch is not the cost.

A killed mutant usually costs more than a surviving one: the failing test waits out its auto-waiting
assertion (`expect.timeout`, 5 s by default) before it fails. Stryker sizes its timeout from passing
tests, so with the default `timeoutMS` kills turned into timeouts (8 of 11 in the first CT run). Set
`timeoutMS` to at least twice the expect timeout; the runner warns at startup when it is lower.

## Limits

- Requires Playwright 1.63 or later. `playwright/lib/runner` is exported but undocumented, so a
  Playwright release can break the runner; the runner refuses older versions with a clear error.
- Only code that runs in the page is activated. Server-side code (SSR, API routes) runs in the
  `webServer` process, which starts once without an active mutant. Those mutants survive unless the
  server is restarted per mutant, which this design avoids on purpose.
- Web workers and service workers are not covered by `addInitScript`.
- Coverage from a page the test closes before the context closes is lost, and so is coverage across a
  cross-origin navigation or from a test that ends on `about:blank`. A popup opened with `window.open`
  copies `sessionStorage`, so its coverage counts twice (harmless for test selection).
- `NODE_OPTIONS` carries the `.ts` worker hook into every Node process Playwright starts, including the
  `webServer`; it does nothing outside Playwright workers. Node refuses to strip types under
  `node_modules`, so a published package needs a JavaScript build of the hook. The prototype is used
  through a symlink, which Node resolves outside `node_modules`.
- `disableBail` cannot lift a `maxFailures` set in the user's Playwright config.
- A timeout restarts the worker and its `webServer`, so each timeout costs one server start.
- A project that already bakes the active mutant into its build (a Vite `define` of
  `globalThis.__stryker__.activeMutant`) overwrites the runner's value: remove that workaround first.
  The hello-world repo scored 0 of 7 until it was removed.
- `concurrency` above 1 starts one `webServer` per Stryker worker, so each worker needs its own port. The
  demo configs derive it from `STRYKER_MUTATOR_WORKER`.

## Rerun

```sh
npm install
npx playwright install chromium
npx tsc -p packages/stryker-playwright-runner/tsconfig.json
node --test packages/stryker-playwright-runner/test/runner.test.ts
npx stryker run stryker.e2e.config.ts
npx stryker run stryker.ct.config.ts
STRYKER_BASELINE=define npx stryker run stryker.e2e.command.config.ts
STRYKER_BASELINE=off npx stryker run stryker.e2e.command.config.ts
node tools/bench-playwright-runs.ts apps/demo-app-e2e/playwright.config.mts 3
```

Versions: StrykerJS 10.1.1, Playwright 1.64.1, Nx 24.0.1, Vite 8.3.5, Node 24.22.0.

## Research behind the design

- `docs/research/playwright-internals.md`: the Playwright APIs the runner depends on.
- `docs/research/prior-art-mutation-e2e.md`: mutation testing with e2e runners across tools and papers.
- `docs/research/vitest-browser-mode-prior-art.md` and `docs/research/karma-runner-prior-art.md`:
  lessons from Stryker's two first-party browser runners.
