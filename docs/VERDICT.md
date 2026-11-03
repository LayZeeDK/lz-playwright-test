# Verdict: a StrykerJS test runner for Playwright Test

Status: written for the prototype on 2026-10-25 and kept current since. The runner and the UI mutators now
ship from `packages/` as built JavaScript.

## The question

Can one StrykerJS test-runner plugin run Playwright e2e tests and Playwright component tests with
per-test coverage, and without rebuilding or restarting the app for every mutant?

The only routes before this prototype were Stryker's `command` runner plus a per-project trick to get
the active mutant into the browser: a Vite `define` and a dev-server restart per mutant
(`Huluvu424242/stryker-playwright-hello-world`), or a rebuilt component bundle per mutant
(`RedHatInsights/nxtcm-components`). Neither has coverage analysis, so every mutant runs every test.

## The answer

Yes, with one plugin (`testRunner: 'lz-playwright'`) for both kinds of test. Playwright 1.63 removed the
`@playwright/experimental-ct-*` packages. Component tests are now plain `@playwright/test` tests that
call the built-in `mount()` fixture against your own dev server. The same runner code runs both, with no
component-specific branch. The price is a dependency on undocumented Playwright internals, which any
Playwright release can change. Limits lists the seven internals and the one undocumented environment
variable that the runner uses.

It also ran, with no runner change, on copies of four open-source repos: the hello-world repo (7
mutants), the Angular/Nx RealWorld app (48), ngx-yeti (2, with 234 e2e tests), and Analog (8). Treat
that as a smoke test, not a broad validation. The runner's author chose each file to mutate, every copy
needed changes before its suite passed (an upstream test bug, a build switch, an ignore entry), and the
Analog file has no server-only code, so it does not exercise server-side rendering. The Evidence section
lists the changes, and Limits lists the general ones.

A second plugin, `@layzee/stryker-jsx-mutators`, adds ten mutators for the JSX that Playwright
tests look at, such as text, labels, links, and disabled or hidden state. StrykerJS 10.1.1 leaves those
parts of a component unmutated (`docs/design/playwright-mutators.md`). On the demo app's e2e suite they
add 17 mutants to 48 built-in ones: 11 killed, 4 survived because of gaps in the tests, and 2 in a
component no e2e page renders. On a copy of epic-stack, a server-rendered React Router app, they add 45
mutants to 199 built-in ones in four route files: 22 killed, 16 survived, 7 uncovered, no compile
errors under Stryker's TypeScript checker, and 1 equivalent mutant. But 8 of those 22 kills are side
effects of server rendering, and server rendering hides attribute mutants (Limits), so on such an app
the kill count overstates what the tests check. Seven of the ten mutators had sites in the two apps;
tests cover all ten. The plugin patches StrykerJS internals, so it supports StrykerJS 10.1 only.

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
  (created in `beforeAll` or a worker fixture), or that a `beforeAll` or `afterAll` hook opens and closes,
  reports its coverage as static, so Stryker runs every test for those mutants instead of crediting the
  wrong one. `browser.close()`, and `page.close()` on a page
  whose context stays open, skip the before-close hook for what they close, so the hook reads those
  pages first. The dry run warns about frames that did not answer in time and logs how much coverage
  came from shared contexts.
- Each mutant run passes Stryker's timeout, less 5.6 s but at least 2 s, to Playwright as the per-test
  timeout. A test that hits that timeout makes the mutant a Timeout. The 5.6 s is a 3 s budget for the
  run to start plus 2.6 s to stop: the hook's 2 s read of the hung page, the context close and the
  worker exit.
- The runner also stops a mutant run itself (`stopTests()`) 2.6 s before Stryker's timeout, and reports
  a Timeout unless a test already killed the mutant. That covers a looping test that starts late or
  raises its own timeout with `test.slow()`, `test.setTimeout()` or `describe.configure({ timeout })`.
  In both cases the infinite loop ends inside Playwright, and the worker and `webServer` stay up. The
  browser test for it stopped an 8 s run in 8.1 s or less: the stop after the deadline took 2078 to
  2096 ms in 8 of 9 runs and 6519 ms once, so the stop takes about 2.1 s but can take longer. A run
  that outlasts the stop still meets Stryker's own timer: Stryker kills the worker's process tree, and
  a fresh worker starts.
- Every run turns off the page snapshot that Playwright takes of a failed test for its error prompt
  (`PLAYWRIGHT_NO_COPY_PROMPT`). On a page stuck in a loop, that snapshot waits out a 5 s timeout. With
  the snapshot on, a timed-out run took 12.5 s on an 8 s budget, past Stryker's timer. With it off, the
  same run took about 7 s. Both times are from the decision log and were not rerun.
- Before each run, and again after a run with a failing test, the runner checks every `webServer` that
  has a `url` or a `port` the way Playwright does at startup (an HTTP request for a `url`, a TCP
  connection for a `port`, and a TCP connection to the url's port for a `url` with any `port` set
  next to it). It does not check a `webServer` that has neither. When a server is
  down, the runner reruns global setup and, after a failing run, reruns the mutant once. A server that dies does
  not turn mutants into kills. The restart counts against the mutant's timeout, so a restart that takes
  long (a server that builds first) turns that mutant into a Timeout instead.
- Per-run settings, the active mutant, and the `NODE_OPTIONS` preload of the hook reach Playwright's
  workers through environment variables (`src/protocol.ts`). The runner sets these variables only while
  a run lasts, because Playwright forks fresh workers for every run and they inherit `process.env`. The
  `webServer` and global setup never see them.
- The runner fails loudly instead of reporting survivors when the internals it calls are missing, when
  tests ran but the hook never installed, when a mutant run produced no test results, when Playwright
  failed without running a test, or when the Playwright run was interrupted. The dry run also fails
  when tests ran, none failed, and no instrumented code reported coverage, in a page or in a Playwright
  worker, whatever the `coverageAnalysis` setting. That error asks whether the `webServer` serves the
  Stryker sandbox, with two exceptions. When no
  instrumented code ran at all, neither in a page nor in a Playwright worker, it says so. When every
  frame failed to answer in time, it says that instead. A dry run that
  finds no tests and does not fail comes back empty, so Stryker's own `allowEmpty` decides.
- In a mutant run, a test that fails and then passes on a retry counts as failed: retries set with
  `describe.configure({ retries })` outrank the `retries: 0` that Playwright's `TestRunner.runTests`
  sets. A test attempt that fails on its own kills the mutant even when another attempt or another test
  timed out. A `test.fail()` test that fails as expected does not kill the mutant. In the dry run, a
  timed-out test is reported as a failed test.
- App code that a Playwright test worker imports, outside any page, reports coverage and hits too. The
  hook sets up the worker's own Stryker namespace before any test file loads, and writes its coverage
  and hit count when the worker exits. In the perTest dry run, coverage made while a test runs counts
  for that test, and coverage made at import time counts as static. Node code gets the hit limit, so a
  loop there reports a Timeout ("Hit limit reached"), as one in a page does.
- A failing test kills the mutant even when the hit count is 0. A setup test runs with the mutant
  active, and a worker that Playwright force-kills never writes its count, so a test can fail because
  of the mutant while the count stays 0. If the runner required a hit before it counted a failing
  test, those mutants would wrongly survive.
- A Playwright worker that crashes during a test fails that test, so the mutant counts as Killed, as in
  StrykerJS pull request 6020. A spec file whose imports throw with the mutant active fails earlier, in
  Playwright's loader process, and the run reports an Error, as Stryker's jest and vitest runners do.
- A mutant run that selects one test of a `describe.serial` group runs the whole group, because a later
  test of the chain fails on its own and would count as a kill. Every runner process lists the tests
  of the projects it runs when it starts, after global setup, and finds the groups through Playwright's
  internal suite flag (`_parallelMode`), so a process that never ran the dry run widens the selection
  too. A test file that fails to load fails the runner's start instead of dropping its groups.
- The per-test timeout the runner sets is the smaller of Stryker's budget and the largest test timeout
  over every project in the Playwright config, setup projects included. When all projects share one
  timeout, a slow mutant cannot pass a test that the user's own timeout would fail. Otherwise a test
  in a project with a smaller timeout can run up to the largest one.

## Evidence

All numbers are from one Windows 11 arm64 machine shared with other sessions, so treat timings as
indicative. The rows marked Linux ran on the same machine in a Docker container of the
`mcr.microsoft.com/playwright:v1.64.1-noble` image (Ubuntu 24.04, Linux arm64, Node 24.22.1), from a
`git archive` of the commit in the Code column. Each row is a single run unless it says otherwise. The run logs and the decision log that
this section cites are local working records in gitignored folders, not part of the repo. To check a
row, rerun it with the commands in Rerun.

The Code column names the runner commit a row ran on.
`git log -- packages/lz-stryker-playwright-runner packages/stryker-playwright-runner` lists every runner
change after it, and a row is not rerun when the runner changes. fca053d rewrote how
a run's test results become a mutant result. A row marked "before fca053d" ran on earlier code, and its
log times do not pin it to one commit. A `command` runner row does not use this runner, so it has no
commit. The open-source rows marked ff95b44 were rerun on that commit with the `oss/` files of that
commit, after both the runner and `oss/` had changed. Each rerun gave the same status counts as its
earlier run, which the rows replace; the wall times differ by up to 1m14s, which one run per row on a
shared machine cannot explain. One `oss/README.md` step needed a fix for the ngx-yeti rerun (3ff6277).

Wall time is Stryker's own "Done in" from the run's log. The define row has no kept log, so its time is
the shell's elapsed time for the whole command. A "(step)" time is the elapsed time of the whole Nx target,
the build it depends on included, because those logs were not kept.

The Linux rows ran at 74df74e, with an earlier, uncommitted version of `tools/linux-run.sh` that named the
projects by their old names, and gave the Windows counts. That run also found a bug that shows only on Linux.
The runner checked whether a port answered on `localhost` only, which resolves to `127.0.0.1` for
`net.connect` in Docker's default network, while a server that listens on `localhost` gets `::1`. The bug
failed the runner's unit suite, in a test whose server listened on `localhost`, and its browser suite, whose
fixture servers did. The demo rows still count: their `webServer` has a `url`, which Playwright checks with its
own code, and the bug did not touch that check. 2a53a36 makes the runner check both loopback addresses, as
Playwright's port check does. At 9a27326 the container passed `npm ci`, lint, typecheck, build, the
runner's 210 unit tests, the mutators' 216, and the 49 browser tests. Its demo Stryker runs were stopped
after 25 of the first run's 32 mutants (5 survived and none timed out by then), because Docker's virtual
machine left less than 4 GB of the host's memory free for other work.

The packages and their public names changed to `lz-` names at 7b9a022. The rows at 9a27326 ran after it;
every other row ran before it and used the old names (`@layzee/stryker-playwright-runner`, `@layzee/stryker-ui-mutators`, `testRunner:
'playwright'`, the `playwright` options key, and mutator names without the `Lz` prefix).
After every row, the package names changed again, to `@layzee/stryker-playwright-runner` and
`@layzee/stryker-playwright-mutators`, because `stryker init` lists a package named `@layzee/lz-*` as `@layzee/lz`.
The plugin name `lz-stryker-playwright`, the `lzStrykerPlaywright` options key and the `Lz` mutator names stayed.
Later still, those became `lz-playwright`, `lzPlaywright` and `LzJsx` mutator names, and the mutators package
became `@layzee/stryker-jsx-mutators`; this page uses the current names throughout.

| Case                                                                                                                                                                  | Runner                                                                                       | Code                             | Score                                                                                                            | Wall time                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Demo e2e, 32 mutants in `cart.ts`                                                                                                                                     | this runner, `timeoutMS` 10000                                                               | 905b030                          | 27 killed, 5 survived                                                                                            | 4m03s                          |
| Same, after the rename to `lz-` names                                                                                                                                 | this runner, `timeoutMS` 10000                                                               | 9a27326                          | 27 killed, 5 survived                                                                                            | 4m18s                          |
| Same, Linux                                                                                                                                                           | this runner, `timeoutMS` 10000                                                               | 74df74e                          | 27 killed, 5 survived                                                                                            | 3m17s (step)                   |
| Same                                                                                                                                                                  | this runner, `timeoutMS` 10000                                                               | before fca053d                   | 27 killed, 5 survived                                                                                            | 4m02s                          |
| Same                                                                                                                                                                  | this runner before the per-test timeout fix, `timeoutMS` 10000                               | before fca053d                   | 26 killed, 1 timeout, 5 survived                                                                                 | 4m35s                          |
| Same                                                                                                                                                                  | this runner before the per-test timeout fix, `timeoutMS` 5000                                | before fca053d                   | 26 killed, 1 timeout, 5 survived                                                                                 | 5m51s                          |
| Same                                                                                                                                                                  | `command` runner + Vite `define`, server restart per mutant                                  | -                                | 27 killed, 5 survived                                                                                            | 12m38s (shell)                 |
| Same                                                                                                                                                                  | `command` runner, no activation (negative control)                                           | -                                | 0 killed, 32 survived                                                                                            | 14m59s                         |
| Same                                                                                                                                                                  | this runner, `--concurrency 2` (one dev server per Stryker worker)                           | before fca053d                   | 27 killed, 5 survived                                                                                            | 2m21s                          |
| Same, lines 11 to 17 (7 mutants), `timeoutMS` 1 and `timeoutFactor` 0 so Stryker's own timer fires first                                                              | this runner                                                                                  | 905b030                          | 7 timeouts                                                                                                       | 1m18s                          |
| Same, lines 11 to 17                                                                                                                                                  | this runner                                                                                  | 53a5aa6                          | 7 timeouts                                                                                                       | 1m28s                          |
| Demo CT, 27 mutants in `price-tag.tsx` via `mount()`                                                                                                                  | this runner, `timeoutMS` 10000                                                               | before fca053d                   | 21 killed, 6 survived                                                                                            | 2m30s                          |
| Same, after the rename to `lz-` names                                                                                                                                 | this runner, `timeoutMS` 10000                                                               | 9a27326                          | 21 killed, 6 survived                                                                                            | 2m45s                          |
| Same, Linux                                                                                                                                                           | this runner, `timeoutMS` 10000                                                               | 74df74e                          | 21 killed, 6 survived                                                                                            | 2m16s (step)                   |
| Same                                                                                                                                                                  | this runner, `--concurrency 2`                                                               | before fca053d                   | 21 killed, 6 survived                                                                                            | 1m26s                          |
| Demo e2e with the UI mutators (`stryker.e2e.ui.config.ts`), 65 mutants in `app.tsx` and `price-tag.tsx`, 17 of them from UI mutators                                  | this runner and `@layzee/stryker-ui-mutators`, `timeoutMS` 10000                             | 107505c                          | UI: 8 killed, 3 timeouts, 4 survived, 2 no coverage. Built-in: 12 killed, 8 timeouts, 1 survived, 27 no coverage | 5m15s                          |
| Same, after the rename to `lz-` names                                                                                                                                 | this runner and `@layzee/lz-stryker-ui-mutators`, `timeoutMS` 10000                          | 9a27326                          | UI: 8 killed, 3 timeouts, 4 survived, 2 no coverage. Built-in: 12 killed, 8 timeouts, 1 survived, 27 no coverage | 6m14s                          |
| Same, with both packages installed from their packed tarballs into a project outside the workspace (`tools/packed-demo/`)                                             | same                                                                                         | 9a27326                          | The same status for each of the 65 mutants as the row above                                                      | 4m55s                          |
| Same as the 107505c row, Linux                                                                                                                                        | this runner and `@layzee/stryker-ui-mutators`, `timeoutMS` 10000                             | 74df74e                          | UI: 8 killed, 3 timeouts, 4 survived, 2 no coverage. Built-in: 12 killed, 8 timeouts, 1 survived, 27 no coverage | 4m07s (step)                   |
| Same, with `use.actionTimeout: 5000` added to the demo's Playwright config                                                                                            | same                                                                                         | 107505c                          | UI: 11 killed, 4 survived, 2 no coverage. Built-in: 20 killed, 1 survived, 27 no coverage                        | 4m26s                          |
| `stryker-playwright-hello-world`, 7 mutants                                                                                                                           | this runner (repo's `define` removed)                                                        | before fca053d                   | 6 killed, 1 survived                                                                                             | median 44s (43 to 46s), 5 runs |
| Same                                                                                                                                                                  | the repo's own `command` runner setup                                                        | -                                | 6 killed, 1 survived                                                                                             | median 64s (57 to 66s), 5 runs |
| Same, `timeoutMS` 1 and `timeoutFactor` 0 so Stryker's own timer fires first                                                                                          | this runner                                                                                  | before fca053d                   | 7 timeouts                                                                                                       | 36s, 36s, and 32s, 3 runs      |
| Same as the first hello-world row, rerun with `oss/hello-world/stryker.playwright.config.ts`                                                                          | this runner (repo's `define` removed)                                                        | ff95b44                          | 6 killed, 1 survived                                                                                             | 44s                            |
| `angular-ngrx-nx-realworld-example-app` (Angular 21.2, Nx 22.7), 48 mutants in `auth.store.ts`, against the local API double                                          | this runner, `timeoutMS` 10000                                                               | ff95b44                          | 11 killed, 15 timeouts, 10 survived, 12 no coverage                                                              | 8m48s and 7m18s, 2 runs        |
| Same, with `use.actionTimeout: 5000` added to the copy's Playwright config                                                                                            | this runner, `timeoutMS` 10000                                                               | ff95b44                          | 26 killed, 10 survived, 12 no coverage                                                                           | 4m46s                          |
| ngx-yeti (Angular, Nx, Playwright 1.63.0, static Storybook), 2 mutants in `cluster.ts`, 234 e2e tests                                                                 | this runner, `playwright.workers` 2, `dryRunTimeoutMinutes` 20                               | ff95b44                          | 2 killed                                                                                                         | 3m03s (dry run 2m20s)          |
| Analog 2.8.0 `beta` (Angular 22.2, Nx 23.2, SSR), 8 mutants in `(home).page.ts`, 11 e2e tests against the built SSR server                                            | this runner, `disableTypeChecking: true` in the copy's Vite config                           | ff95b44                          | 4 killed, 4 survived                                                                                             | 2m01s                          |
| epic-stack at 893610d (React 19, React Router 7, SSR), 244 mutants in four files under `app/routes/users/` and `app/components/`, 26 e2e tests against the dev server | this runner and `@layzee/stryker-ui-mutators`, TypeScript checker, `use.actionTimeout: 5000` | cda2f95 (packages as at ff95b44) | UI: 22 killed, 16 survived, 7 no coverage. Built-in: 17 killed, 53 survived, 49 no coverage, 80 compile errors   | 27m59s                         |

The UI mutator rows match the statuses Claude wrote down before the first run, except that the
three UI timeouts were predicted as kills. Each is a test that clicks or fills an element the mutant
emptied the text or label of, and waits for it until the test timeout (see Limits). With
`actionTimeout` set, those three and the eight built-in timeouts end as kills by the named tests. The
four survivors are gaps in the demo's tests, not equivalent mutants: the tests read the three totals
by test id, not by their labels, and read each line's name from its input's `aria-label`, not from the
label text. `spikes/live-mutant/` shows two of the four on a live page, with Stryker's own instrumented
build and mutant ids. Mutant 23 removes the "Subtotal" label and mutant 16 removes both line names, while
the totals the tests read stay the same. The two uncovered mutants are in `price-tag.tsx`, which no e2e page renders. No UI mutant
was equivalent, and none was a compile or runtime error. The demo app has sites for only three of the
ten mutators (`LzJsxTextLiteral`, `LzJsxChildExpression`, `LzJsxUrlAttribute`). The other seven have evidence from
tests only, below.

On epic-stack, the worker that ran it predicted each of the 45 UI mutants before the run; 36 matched.
Of the 22 kills, 14 come from a test step that reads or follows the mutated element, and 8 from a later,
unrelated step on a server-rendered page whose hydration the mutant broke (Limits). Of the 16
survivors, 14 are gaps in the tests, 1 is equivalent (`LzJsxConditionalElement` forcing a span that renders
empty), and 1 is a `LzJsxUrlAttribute` mutant of a form `action` that server rendering kept out of the DOM.
Two `LzJsxLabelAttribute` survivors on the search input, its `htmlFor` and its `placeholder`, leave the
input named by the other one for role queries; `getByLabel` and `getByPlaceholder` would kill them,
so they count as gaps. The one `LzJsxElementRole` tag swap, `<a href>` to `<span>` without the `href`,
compiled. The 80 built-in compile errors are real type errors, mostly emptied object and string
literals. epic-stack needed a Prisma engine that runs on Windows arm64, a fixed port, a longer test
timeout, and one upstream test marked `fixme`; `oss/README.md` lists each change.

The UI mutators have three more layers of evidence, all at or after 107505c.
`packages/stryker-jsx-mutators/test/` runs without a browser: 107 synthetic cases from the open-source
repos and the design, each with the exact UI mutants it must give (0 todo); install checks for the
name refusal, a second install, the self-check, and core resolution; an in-process check that the
JSX placement leaves the built-in mutants of five files unchanged, with a negative control; and a
render check that every mutant of the design spike's sample renders like the same edit made by hand.
`packages/stryker-playwright-runner/test/browser/ui-mutators.test.ts` runs the runner on a page
instrumented with the UI mutators: for each of the ten mutators a Playwright test kills one of its
mutants, and a test that does not observe that mutant lets it survive. `spikes/fail-loud/` runs
`stryker run` with the plugin listed in `plugins` and with the plugin imported from the config. Both report UI mutants,
and with one mutator's sample broken on purpose both exit 1 and name that mutator.

`packages/stryker-playwright-runner/test/browser/runner.test.ts` checks the runner against a fixture
instrumented by Stryker's own instrumenter. It checks that per-test coverage separates a test that
reaches a function from one that does not, coverage across a navigation to a page without the app,
static coverage for a shared `beforeAll` page and for a page the worker closes, per-test coverage for a
page the test closes, per-test coverage under `reuseContext`, a runtime kill, a static (module-level)
kill, a survivor followed by a clean kill, an Error when the selected tests no longer exist, an infinite
loop that times out inside its budget through the per-test timeout, the hit limit on an infinite loop
with the hit limit as the Timeout's reason, that a worker thread a test starts does not install the
hook, that no run settings stay in the environment, a `webServer` restarted after it dies between runs,
no `test-results` folder next to the fixture's Playwright config, and that `dispose` removes the temp
directory the runner kept its output and runs in. Commit b4fedce added four of these
checks: the page the test closes, the missing tests, the per-test timeout, and the clean environment.
When they were added, each one failed with its fix removed, and with activation disabled in the hook
6 of the 16 checks then in the file failed. Those two results are from the decision log of 2026-10-25
and have not been rerun since. `runner.test.ts` does not cover Stryker's own timeout restart,
`coverageAnalysis` `'all'` or `'off'`, `workers` above 1 (the ngx-yeti run below is the only evidence
for that), or the dry-run guard. `run-result.test.ts` checks that guard with a stubbed run.
`test/run-result.test.ts` checks without a browser how a finished run maps to a Stryker result:
retried tests, a kill next to a timeout, a timed-out test in the dry run, runs with no results, a run
that Playwright failed without running a test, skipped tests without the hook, and selecting whole
`describe.serial` groups (that check fails with the group selection removed). It also checks that `init`
refuses `--testFiles`, that grouping fails when suites lose `_parallelMode`, and that the dry run fails
under `coverageAnalysis: 'off'` when no page loaded instrumented code. Two more checks cover the text
of that error when every frame was lost and when no test opened a page. Three check the coverage merge:
a `__proto__` test id, counts that are not hit counts, and a context that outlived its test. In the
browser suite, `runner.test.ts` checks that `init` finds the members of the fixture's first
`describe.serial` group from Playwright's own test list. No browser check runs a widened mutant: each
fixture group opens its page in `beforeAll`, that coverage counts as static, so their mutants already
run every test.

The hello-world runs alternated the two runners (A, B, A, B) five times. The `command` runner starts
a Vite dev server for every mutant, which is the likeliest source of its extra 20 s. That cause is
inferred, not profiled. The `command` side kept the repo's own Stryker settings: `timeoutMS` 60000,
`coverageAnalysis` `'off'`, and the HTML reporter. No mutant timed out on either side, so the longer
timeout does not change the numbers.

The hello-world rows ran on an earlier shell script with `.mjs` versions of the Stryker configs.
`tools/bench-hello-world.ts` and the `.ts` configs in `oss/hello-world/` replaced them later. The
rerun row used the `.ts` config once, not the benchmark script; the two benchmark rows and the
forced-timeout row were not rerun. The table shows each log's "Done in". `tools/bench-hello-world.ts` prints
the shell's elapsed time for the whole command instead, which ran 1 to 3 s above "Done in" in the kept
logs.

In both forced-timeout runs on the demo app (53a5aa6 and 905b030), Stryker killed and restarted the
worker for every mutant. Afterwards no `stryker-pw` temp folder (the runner's prefix then) was left in the system
temp folder, no extra Node process was running, and no port was left open. Those checks were made by
hand after each run.
Before a fix in `dispose` (fca053d), each kill left Playwright's output directory behind.

The RealWorld run needed no change to the runner. Its disposable copy needed four, all made by
`oss/realworld/prepare.ts`. The app talks to the local API double instead of the public API. The app
gets its own port, because upstream starts a project that does not exist and reuses any server on 4200.
Two upstream tests that fail without Stryker are fixed or skipped (`docs/filings.md`). And
`.stryker-tmp` goes into `.gitignore`. Every timeout came from a mutant that breaks app startup (the
store's `providedIn`, its factory, or the `getUser` call every page makes). The tests then wait for an
element that never appears, until the test timeout ends them. Both RealWorld runs left the same 10
survivors in their JSON reports:

- 4 mutants in the `getUser` error handler, which sets `loggedIn: false` and `setLoaded('getUser')`.
  Five tests create the handler and two run it, but `loggedIn: false` repeats what the loading step
  already set, and no test checks the call state (inferred from the source).
- `loggedIn: true` instead of `false` in the `getUser` loading step. The response sets the final value
  right after it (inferred from the source).
- The `exhaustMap` callbacks of register and update, which no UI test calls.
- Login's `navigateByUrl('/')` and logout's `navigateByUrl('login')`, each changed to
  `navigateByUrl('')`.
- Logout's error handler, which no test triggers.

`logout.spec.ts` runs logout but does not detect the navigation to the empty URL. Logout's error-handler
mutant counts as covered because logout creates the handler, but no test makes logout fail, so the
handler never runs. The 12 uncovered mutants are the inner callbacks of register and update, which the
suite only calls through the API.

The ngx-yeti run is the only one with `lzPlaywright.workers` above 1, which `runner.test.ts` does not
cover. Coverage still came back per test. Each mutant was covered by 20 of the 234 tests, and Stryker
stopped at the first kill, after 7 tests for one mutant and after 1 for the other. On one worker the dry
run ran longer than Stryker's default 5-minute `dryRunTimeoutMinutes` (decision log, not rerun). With 2
workers it took 2m57s in the first run, whose log reports 344 s of net test time, which agrees with
that, and 2m20s in the rerun at ff95b44. The rerun stopped after 7 tests and after 1 as well.
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

A mutant run costs about 1.4 s of fixed Playwright overhead plus the selected tests. That figure is from
`tools/bench-playwright-runs.ts` on the demo e2e config, 3 runs, 2026-10-27. Config load and test
collection took 724 to 790 ms, and the first test began at 1417 to 1458 ms. Playwright's debug trace
splits one run as follows:

- 401 ms to fork the test-loader process;
- 292 ms for it to import the config and the first spec;
- 399 ms to fork the worker;
- 299 ms for the worker to reach its first test.

In a fresh Node process, `@nx/playwright/preset` with `@nx/devkit` took 189 to 206 ms to import, and
`@playwright/test` 264 to 282 ms. That was 5 interleaved rounds, each import in its own cold process, on
2026-10-27. These figures do not add up to the 292 ms above. The likely reason, inferred and not measured, is
that the test loader already holds `@playwright/test` when it imports the config, so the cold figures overlap
what it has loaded. Playwright 1.64.1's source shows that the loader and the worker each load the config once
per run. That count is read from the source, not measured.

Earlier runs measured more: 1.8 s to the first test on 2026-10-26 and 2.7 s on 2026-10-24. What causes the
spread was not measured. Sharing one browser across runs through `connectWsEndpoint` saved nothing
measurable, so browser launch is not the cost. That shared-browser result is from the decision log and was
not rerun. The runner's own code is not the cost either. In a CPU profile of a demo e2e run, its worker hook
took 0.09% of the Playwright workers' busy time.

A killed mutant usually costs more than a surviving one: the failing test waits out its auto-waiting
assertion (`expect.timeout`, 5 s by default) before it fails. Stryker sizes its timeout from passing
tests, so with the default `timeoutMS`, killed mutants turned into timeouts. In the first CT run, 8 of
11 mutants timed out. That count is from the decision log, and the run's own log was not kept. Set
`timeoutMS` to at least the expect timeout plus 5.6 s, the runner's time to start and stop a mutant run.
Stryker's measured overhead covers the start on one Playwright worker, less of it or none with more, and never
the stop.
The runner warns at startup when it is lower.

That wait is most of a run. At concurrency 1, one run each, 2026-10-27:

| Run      | Killed mutants: count, median time each, share of the run | Survivors: count, median time each |
| -------- | --------------------------------------------------------- | ---------------------------------- |
| demo e2e | 27, 8.4 s, 90%                                            | 5, 5.2 s                           |
| demo CT  | 21, 6.6 s, 92%                                            | 6, 2.0 s                           |

Lowering `expect.timeout` to 1000 ms under Stryker (the runner README, "Faster killed mutants") halved both
runs. That is 5 runs per side, interleaved A and B, at concurrency 3:

| Run      | Default (5 s): median (range) | 1000 ms: median (range) |
| -------- | ----------------------------- | ----------------------- |
| demo CT  | 58 s (58 to 59)               | 29 s (28 to 30)         |
| demo e2e | 111 s (89 to 150)             | 56 s (54 to 92)         |

- Each 1000 ms run was faster than its paired default run.
- The e2e gain, 55 s, is smaller than the default side's own range. The slowest runs on both sides were in
  the first two pairs. Light checks from other sessions ran during the slot, but they were not isolated as
  the cause.
- No mutant moved between Killed and Survived in any of the 20 runs.
- One e2e run on each side had one mutant report Timeout instead of Killed. Both count as detected.
- The demo configs keep the default, so the counts above still come from it.

Concurrency 2 ran 1.9 times and concurrency 4 ran 3.2 times as fast as concurrency 1 on this machine (12
cores). Two rounds, interleaved, default configs, 2026-10-27:

| Run      | Concurrency 1 | Concurrency 2 | Concurrency 4 |
| -------- | ------------- | ------------- | ------------- |
| demo e2e | 262 s, 233 s  | 134 s, 132 s  | 82 s, 73 s    |
| demo CT  | 155 s, 158 s  | 80 s, 80 s    | 52 s, 47 s    |

All 12 reports give every mutant the same status as the first concurrency 1 run.

## Limits

- Requires Playwright 1.63 or a later 1.x release. The runner refuses older versions and Playwright 2
  with a clear error, and its peer range is `>=1.63.0 <2`.
- The runner is tested only with Chromium. Firefox and WebKit are untested.
- The runner depends on seven Playwright internals, any of which a Playwright release can change:
  `TestRunner` from `playwright/lib/runner`, `configLoader` from `playwright/lib/common`, `isURLAvailable`
  from `playwright-core/lib/coreBundle`, the path of Playwright's worker entry file
  (`playwright/lib/worker/workerProcessEntry.js`), `_instrumentation` from `playwright-core`, the
  `_parallelMode` field of Playwright's suites, and `TestInfo._timeoutManager`, which says whether a hook
  or fixture is running. The `lib/` modules are in the package exports but
  undocumented. The runner checks the first three at startup and fails with an error that lists them.
  A moved worker entry leaves the hook uninstalled, and a missing `_instrumentation` makes the hook throw
  in the worker. Either one fails the dry run. A missing `_parallelMode` stops the runner with an error
  that names it. A missing `_timeoutManager`, or one running a type of hook the runner does not know,
  makes the hook throw an error that names it and the Playwright version when instrumented code or a new
  browser context asks for the current test. That happens only in a `perTest` dry run, and fails it
  unless the test itself catches that error.
- The runner also sets `PLAYWRIGHT_NO_COPY_PROMPT`, an environment variable that Playwright reads but
  does not document, to turn off the page snapshot for its error prompt. If a release renames or drops
  that variable, nothing fails. A timed-out mutant run then takes about 12.5 s on an 8 s budget again,
  reaches Stryker's own timer, and costs a full init per such mutant.
- The runner refuses Stryker's `--testFiles` option and fails at startup with "The Playwright test runner
  does not support the --testFiles option."
- Only code that runs in the page or in a Playwright test worker is activated. Server-side code (SSR, API routes) runs in the
  `webServer` process, which starts once without an active mutant and reports no coverage. With
  coverage analysis on, those mutants show as NoCoverage. With `coverageAnalysis: 'off'`, every test
  runs against them and they survive, because the server never sees the active mutant. Code that runs
  on both sides (SSR plus hydration) is activated only in the page. On epic-stack this did two things
  (measured, and reproduced without Stryker by making two sites render differently on the server and
  in the browser). A mutant that changes text or an element on a server-rendered page breaks
  hydration, and a later, unrelated step of the test fails, so the mutant counts as Killed whether or
  not any test checks the element: 8 of 22 UI kills there. A mutant that changes an attribute never
  reaches the DOM, because hydration keeps the server's attribute value, so it survives even when a
  test uses the attribute: a form `action` the search test submits. On a server-rendered app, read the
  kill count with both effects in mind.
- Dependency projects (a `setup` project that logs in) run unfiltered, with the mutant active, on every
  mutant run, because Playwright adds them whenever a dependent test is selected. They add their time
  to every mutant, and a mutant that breaks the setup flow is killed by the setup test. Login in
  `globalSetup` runs once instead.
- Web workers and service workers are not covered by `addInitScript`.
- Coverage across a cross-origin navigation, from a page that closes itself (`window.close()`), or from
  a test that ends on `about:blank` is lost. A popup opened with `window.open`
  copies `sessionStorage`, so its coverage counts twice (harmless for test selection). An iframe that
  navigates within its origin drops the earlier document's coverage without counting it as lost, so
  mutants only that document reached show as NoCoverage (inferred from the hook's code, not run).
- Runners before this change named their private temp directories `stryker-pw-<worker>-*`, and a
  runner that Stryker killed while its teardown hung left one behind. The runner now names them
  `lz-playwright-<pid>-*` and removes, at `init`, those of runners of the same user that no longer
  run. It never removes `stryker-pw-*` directories, because their number is no pid and a live one of an
  older runner would look dead; remove those from the system temp folder once by hand.
- A pid names a process only in the PID namespace and on the host that gave it out. Each temp
  directory therefore holds an `owner` file with a token for the host, and on Linux for the PID
  namespace (the inode of `/proc/self/ns/pid`), and a runner removes only directories whose token is
  its own. Runners in containers that share `/tmp`, or on hosts that share an NFS temp directory, keep
  one another's directories, provided those hosts have different host names: every Linux host's first
  PID namespace has the same inode. On Linux without `/proc` the token is unique to the runner, so no
  later runner removes its directory. A directory without a readable `owner` file is kept; remove those
  by hand. The runner looks only at `lz-playwright-<pid>-*`, so it never removes the
  `stryker-playwright-<pid>-*` directories of runners from before the rename at 7b9a022 either. The root is removed again at once if its `owner` file cannot be written.
- In a Stryker run started inside a Playwright worker, the worker hook of the inner runner installs
  and an outer copy of the same hook stays out; a copy from before that rule installs too and counts
  coverage twice.
- Stryker gives a runner's `dispose` 2 s and then kills its process tree. The runner's `dispose` stops
  the tests and then runs global teardown, so a `globalTeardown` that needs more than what is left of
  the 2 s is cut off (inferred from the code, not run).
- A mutant run that widens its selection to a whole `describe.serial` group keeps the timeout Stryker
  set for the tests that cover the mutant. When the covering tests have passed and an added test then
  runs out of time, the mutant counts as Survived; when a covering test has not passed by then, as a
  Timeout, which Stryker counts as detected (unit-tested; the browser tests for both cases are written,
  not yet run).
- Node refuses to strip types under `node_modules`, so a published package needs a JavaScript build of
  the hook and the runner. Both packages therefore ship built JavaScript in `dist`.
- `disableBail` cannot lift a `maxFailures` set in the user's Playwright config.
- The runner runs Playwright with `lzPlaywright.workers` from the Stryker config (default 1), not the
  `workers` value in the Playwright config. A suite that passes only when its tests spread over several
  workers fails the dry run. RealWorld's `auth.spec.ts` makes its user id once per worker and registers
  that user before every test, so it failed the same way under plain `npx playwright test --workers=1`.
- Playwright actions such as `click()` have no timeout of their own unless `use.actionTimeout` is set,
  so a mutant that removes or never renders an element ends its test by the test timeout. The runner
  reports that mutant as a Timeout, not as Killed. The mutation score is the same, because Stryker
  counts both as detected, and Stryker does not restart the worker for a timeout the runner reports.
  In the RealWorld run, 15 of the 26 detected mutants were timeouts. With `use.actionTimeout: 5000` in
  the Playwright config all 15 were Killed, and the survivors and uncovered mutants did not change. Set
  `actionTimeout` below the per-test timeout, so that the failing test of a killed mutant says what
  broke. The wall time dropped from 7m41s to 6m00s in the first runs, and from 8m48s and 7m18s to
  4m46s in the reruns at ff95b44; on the demo app with the UI mutators it dropped from 5m15s to 4m26s.
  Those are one or two runs per side, not interleaved, and indicative only.
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
  A suite that depends on a fresh backend can report a mutant as Killed or Survived when it is not.
- With Stryker's `ignoreStatic`, mutants covered only by static coverage are ignored: those a shared
  `beforeAll` page reaches, and those Node code reaches only from fixtures (test-scoped ones included)
  or from `beforeAll` and `afterAll` hooks (see the next item). A mutant that both static coverage and
  a test reach is not ignored. Stryker runs only the tests whose per-test coverage reached it, so it
  can survive when only a test that uses the shared page or the fixture would have killed it
  (inferred from Stryker's test planner, not run). Shared pages and fixtures make such mutants common
  with this runner.
- Node coverage in a test worker counts for a test only while Playwright runs that test's body or its
  `beforeEach` and `afterEach` hooks. Coverage from `beforeAll` and `afterAll` hooks and from fixture
  setup and teardown, test-scoped fixtures included, counts as static, so Stryker runs every test for
  those mutants. The runner reads that from Playwright's internal `TestInfo._timeoutManager` and fails
  the dry run if a Playwright release drops it. Node coverage from a worker that Playwright force-kills
  (no heartbeat for 5 min) is lost, and code in Playwright's loader process or the `webServer` gets
  none.
- An infinite loop in a test worker's own Node code, outside a page, blocks that worker. Neither the
  per-test timeout nor the runner's stop ends it; `stopTests()` waits until Playwright force-kills the
  worker after 5 minutes without a heartbeat (measured once, before the worker counted hits: 357 s
  for a run with a 60 s budget). The hit limit ends such a loop, and without one Stryker's own timer
  does.
- A timeout that reaches Stryker's own timer costs a full init: config load, global setup, and a
  `webServer` start, including any build that start runs. With the runner's own stop that happens only
  when the stop takes longer than 2.6 s (once in 9 measured runs), in a dry run, or when a loop runs at
  module load in Playwright's loader process, which `stopTests()` waits for (inferred, not run).
- A project that already bakes the active mutant into its build (a Vite `define` of
  `globalThis.__stryker__.activeMutant`) overwrites the runner's value: remove that workaround first.
  The hello-world repo scored 0 of 7 until it was removed.
- `concurrency` above 1 starts one `webServer` per Stryker worker, so each worker needs its own port. The
  demo configs derive it from `STRYKER_MUTATOR_WORKER` and turn off `reuseExistingServer` under
  Stryker, so a server already on the default port is never reused. Under Stryker the e2e config also
  starts the dev server in CI, because a `preview` server builds first and every worker would rebuild
  the sandbox's one `dist` folder. A Stryker checker counts here too: when checking ends, Stryker starts
  one more test runner, even at `concurrency` 1. On epic-stack, with a fixed port and
  `reuseExistingServer: false`, that runner's `webServer` found the port taken and the run failed at
  mutant 140 of 244. With `reuseExistingServer: true` both runners shared the sandbox's dev server.

## Rerun

```sh
npm install
npx playwright install chromium
npx nx run-many -t typecheck build
npx nx run @layzee/stryker-playwright-runner:test
npx nx run @layzee/stryker-playwright-runner:test-browser
npx nx run @layzee/stryker-jsx-mutators:test
npx nx run @layzee/demo-app-e2e:mutate-e2e
npx nx run @layzee/demo-app-e2e:mutate-e2e-ui
npx nx run @layzee/demo-app:mutate-ct
# The command runner baselines load neither package.
STRYKER_BASELINE=define npx stryker run stryker.e2e.command.config.ts
STRYKER_BASELINE=off npx stryker run stryker.e2e.command.config.ts
# The lines below load the packages' dist folders too, so they need the build above.
npx stryker run stryker.e2e.config.ts --concurrency 2
npx stryker run stryker.ct.config.ts --concurrency 2
npx stryker run stryker.e2e.config.ts --mutate apps/demo-app/src/app/cart.ts:11-17 --timeoutMS 1 --timeoutFactor 0
node tools/bench-playwright-runs.ts apps/demo-app-e2e/playwright.config.mts 3
BENCH_SHARED_BROWSER=1 node tools/bench-playwright-runs.ts apps/demo-app-e2e/playwright.config.mts 3
node tools/bench-hello-world.ts <stryker-playwright-hello-world checkout> 5
node oss/realworld/prepare.ts <disposable copy of angular-ngrx-nx-realworld-example-app>
npx stryker run stryker.playwright.config.ts   # in that copy, after npm install and linking this runner
```

The demo forced-timeout run used a config file in the gitignored `.audit/` folder with the same
`mutate`, `timeoutMS`, and `timeoutFactor` as that command line. Its reporters and temp folder name
differ. The command line itself was not run.

For the second UI mutator row, add `actionTimeout: 5000` to the top-level `use` block of
`apps/demo-app-e2e/playwright.config.mts` for that run only. `spikes/fail-loud/README.md` gives the
fail-loud commands, and `tools/packed-demo/README.md` the packed-tarball row. For the RealWorld row with `use.actionTimeout: 5000`, add `actionTimeout: 5000` to the top-level `use` block of
the copy's `apps/conduit-e2e/playwright.config.ts` after `prepare.ts` has run. `prepare.ts` does not
add it. `oss/README.md` gives the steps for the hello-world forced-timeout row, ngx-yeti, Analog, and epic-stack.

Versions: StrykerJS 10.1.1, Playwright 1.64.1, Nx 24.0.1, Vite 8.3.5, Node 24.22.0 (24.22.1 in the Linux
container). The runner's and the mutators' test suites also pass on Node 22.23.1, on Windows.

`tools/linux-run.sh` runs these steps in the container at the commit you archive: `npm ci`, lint,
typecheck, build, the three test targets, and the three demo targets. It writes each step's log and exit code
to the mounted folder and exits with the number of failed steps, or stops after a failed `npm ci`. It
reruns the checks at HEAD, not the Linux rows at 74df74e, which ran the earlier version of the script. From
an empty folder `<out>`:

```sh
git archive HEAD -o <out>/head.tar
cp tools/linux-run.sh <out>/
docker run --rm --init --ipc=host --memory 6g -v "<out>:/out" mcr.microsoft.com/playwright:v1.64.1-noble bash /out/linux-run.sh
```

On the 32 GB host, Docker's WSL virtual machine grew to about 11 GB during the run, with or without
`--memory 6g`, which bounds the container (it used 1.4 GB) but not the virtual machine. Leave other heavy work
off the machine while it runs.

## Research behind the design

- `docs/research/playwright-internals.md`: the Playwright APIs the runner depends on.
- `docs/research/prior-art-mutation-e2e.md`: mutation testing with e2e runners across tools and papers.
- `docs/research/vitest-browser-mode-prior-art.md` and `docs/research/karma-runner-prior-art.md`:
  lessons from Stryker's two first-party browser runners.
