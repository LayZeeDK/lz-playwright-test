# @layzee/stryker-playwright-runner

A StrykerJS test runner for Playwright Test. It runs Playwright e2e tests and Playwright component
tests (`mount()`) as Stryker tests, reports per-test coverage, and starts the Playwright `webServer`
once per Stryker test runner process instead of once per mutant. With
[server-side mutants](#server-side-code) on, it also restarts the `webServer` around the runs that need
it.

## Requirements

- `@playwright/test` 1.63 or a later 1.x release, tested on 1.63.0 and 1.64.1. The runner calls
  Playwright internals that a release can change, and stops with an error that names them when they
  have changed.
- `@stryker-mutator/core` 10, tested on 10.1.1.
- Node.js 22 or later, tested on 22.23.1 and 24.22.0 on Windows 11 arm64, and on 24.22.1 on Linux arm64.
- Chromium. Firefox and WebKit are untested.

## Configure Stryker

Install the runner next to StrykerJS and Playwright:

```sh
npm install -D @layzee/stryker-playwright-runner @stryker-mutator/core @playwright/test
```

Then select it in a Stryker config file, here `stryker.config.ts`:

```ts
import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

export default {
  appendPlugins: ['@layzee/stryker-playwright-runner'],
  testRunner: 'lz-playwright',
  coverageAnalysis: 'perTest',
  concurrency: 1,
  timeoutMS: 11_000,
  mutate: ['src/**/*.tsx', '!src/**/*.spec.tsx', '!src/**/*.test.tsx'],
} satisfies PartialStrykerOptions;
```

Stryker finds a config file by itself only when it is JSON or JavaScript, so name a TypeScript config on
the command line:

```sh
npx stryker run stryker.config.ts
```

Without the file name, Stryker runs with its defaults, which test every mutant with `npm test` instead of
this runner. A `.ts` config needs Node.js 22.18 or later, which strips the types when Stryker imports it.
On any supported Node.js, save the same object without `import type` and `satisfies` as
`stryker.config.mjs`, which `npx stryker run` finds by itself.

`appendPlugins` adds the runner to the plugins Stryker loads by default. Setting `plugins` instead
replaces that list, so a checker such as `@stryker-mutator/typescript-checker` no longer loads unless the
list names it too. Stryker finds its default plugins next to its own install, which under pnpm or Yarn
Plug'n'Play holds only Stryker's own dependencies. So with either, also name the checker in
`appendPlugins`. With Yarn Plug'n'Play, run `yarn stryker run` instead of `npx stryker run`.

Each Stryker test runner process starts the Playwright `webServer` itself. Without `concurrency`, Stryker
starts one process per CPU core, less one on a machine with more than 4 cores, and with a fixed port in
the Playwright config every process after the first fails at startup because the port is taken. A Stryker
checker hands its processes to new test runners when it finishes, so even at `concurrency` 1 a second
test runner starts. Stryker also replaces a test runner process when its own timer ends a mutant run,
and after every `maxTestRunnerReuse` runs. The new process starts the `webServer` and global setup again.

There are two ways to keep the processes from fighting over one port:

- Give each process its own port from `STRYKER_MUTATOR_WORKER`, which Stryker sets in each test runner
  process, in the Playwright config:

  ```ts
  const port = 4200 + Number(process.env['STRYKER_MUTATOR_WORKER'] ?? 0);

  export default defineConfig({
    use: { baseURL: `http://localhost:${port}` },
    webServer: { command: `npm run dev -- --port ${port}`, port },
  });
  ```

  Every process, a replacement included, gets the next number, so ports from
  `base + STRYKER_MUTATOR_WORKER` climb past `base + concurrency - 1` after the first replacement. Keep
  the ports above that range free, and allow them in a backend that checks the origin.

- Set the `webServer`'s `reuseExistingServer` to `true`, so that the processes share one server and its
  state in memory. Stop any dev server of your own first: a server that was already running serves the
  original sources, not Stryker's instrumented copy.

With `lzPlaywright.webServer.mutate` on, the runner moves each process's `webServer` to a port of its
own instead, so the processes never share one. See
[More than one Stryker process](#more-than-one-stryker-process).

Either way, every process runs in the same Stryker sandbox, so what one server writes there, such as a
SQLite file or a JSON store, the others read, and a test can fail because of another process's data,
without a mutant at fault. Give each process its own store, from the same `STRYKER_MUTATOR_WORKER`. A
`webServer` that builds the app before it serves it rebuilds the sandbox's one output folder in every
process, while the others serve it. Under Stryker, serve the sandbox from a dev server instead, or build
once with Stryker's `buildCommand` and only serve in the `webServer`.

Stryker's default `timeoutMS` is 5000 ms, the same as Playwright's default `expect.timeout`. Keep
`timeoutMS` at least the expect timeout plus 5.6 s, so 10.6 s with Playwright's default, or a killed
mutant's failing assertion runs out the runner's per-test timeout and the mutant counts as a Timeout.
The runner takes about 3 s to start a mutant run and keeps 2.6 s to stop one. Stryker adds an overhead
to its timeout: the dry run's time less the tests' own time. On one Playwright worker that covers the
start; with `workers` above 1 the tests overlap, so it covers less of it, often none. It never covers the
stop, so `timeoutMS` must. The runner warns at startup when `timeoutMS` is lower.

`coverageAnalysis` can be `off`, `all`, or `perTest`. With `perTest`, Stryker runs only the tests that
reached a mutant, except for a mutant reached outside any test, which Stryker runs against every test.
Coverage from the browser pages counts for the test that opened the page. Coverage of code that the
Playwright worker itself imports counts for the test whose body or `beforeEach` and `afterEach` hooks ran
it. Code that a `beforeAll` or `afterAll` hook, a fixture, or the import itself ran is reached outside
any test.

The runner runs more than the tests Stryker selects: the whole `describe.serial` group that a selected
test belongs to, and the dependency projects, such as a `setup` project, of the selected tests'
projects. Stryker's timeout for a mutant counts only the time of the tests it selected. When every
selected test has passed and an added test then hits its per-test timeout or the runner's deadline, the
mutant counts as Survived. When a selected test has not passed by then, the run ends as a Timeout, which
Stryker counts as detected. Dependency projects and the serial tests before a selected test run before
it, so add their time to the `timeoutMS` above. A test that fails kills the mutant, selected or added.

## Break threshold

Stryker's `thresholds.break` defaults to none, so a run passes at any score. Set it a mutant or two below
the first measured score: a browser test that waits on timing can flip one mutant between Killed and
Survived from one run to the next.

## Options

Set these under `lzPlaywright` in the Stryker config. Stryker checks them against the schema the package
exports as `strykerValidationSchema`.

- `configFile`: the Playwright config file, relative to the folder you run Stryker from, not to an Nx
  project's folder. Without it, Playwright looks for `playwright.config.*` in that folder.
- `projects`: the Playwright projects to run. Without it, the runner runs the projects that Playwright
  runs without `--project`, so not those with `default: false`.
- `workers`: the Playwright workers per Stryker test runner process. The default is 1. The `workers`
  value in the Playwright config has no effect. The dry run runs the whole suite on these workers, and
  Stryker fails the run when the dry run takes longer than `dryRunTimeoutMinutes`, 5 by default. A suite
  that takes a few minutes on Playwright's default workers can take longer than that on one, so raise
  `workers` or `dryRunTimeoutMinutes`.
- `retries`: how many times to retry a failed test, in every project. Without it, each project keeps the
  `retries` that the Playwright config gives it. See Flaky tests.
- `survivorTraces`: a folder, relative to the folder you run Stryker from, for the Playwright traces of
  surviving mutants, such as `reports/lz-playwright-traces`. See Traces of surviving mutants.
- `traceScreenshots`: add screenshots to the traces that `survivorTraces` records. The default is
  `false`. See Traces of surviving mutants.
- `webServer`: mutants in the code that the Playwright config's `webServer` runs. `mutate` is `false`,
  the default, `true`, or `'auto'`. `isolate` defaults to `true`. See
  [Server-side code](#server-side-code).

## Server-side code

Without this option, only code that runs in the page or in a Playwright test worker gets the active
mutant. Code that the Playwright config's `webServer` runs, such as server rendering, loaders, actions and
API routes, runs without one, so its mutants stay NoCoverage. To test those mutants with e2e tests or API
tests against a Node.js `webServer`, set `mutate`:

```ts
lzPlaywright: { webServer: { mutate: true } },
```

- `mutate: false`, the default, leaves the `webServer` without a mutant. When the Playwright config has a
  `webServer`, the dry run logs one line that says its mutants stay NoCoverage.
- `mutate: true` gives the `webServer` each mutant. When the setup cannot work, the runner stops at
  startup with an error that names the cause.
- `mutate: 'auto'` starts as `true`. When the setup cannot work, the runner logs one warning with the
  cause and runs as with `false`. When the dry run reaches no mutant in the code the `webServer` runs, the
  runner turns server support off too, with one info line.

### How a mutant reaches the server

The runner starts the `webServer` in Playwright global setup, with `NODE_OPTIONS` set to import the
runner's server hook, after any `NODE_OPTIONS` of the environment that runs Stryker. Every Node.js process
that the `webServer` command starts loads the hook. Before each run, the runner writes the run's mutant to
a file that the hook reads at the start of each request.

The runner adds an `x-lz-stryker-test` header with the test's id to the requests that a test sends to the
`webServer`: the page requests to the `webServer`'s host and port, and the requests of a Playwright
`APIRequestContext`, such as the `request` fixture. The hook counts the code that a request runs for that
test, so Stryker runs each server-side mutant against the tests whose requests reached it.

Code that runs once when the server starts, such as module scope, cannot switch mutants per request. A
module that the server loads at its first request counts as such code too. Stryker runs a mutant in that
code against every test, and the runner restarts the `webServer` with the mutant in its environment for
that run, then without it for the next run.

### Isolate server-side mutants

A mutant run can leave state behind in the server, such as a cache filled with its mutated value, and the
next run then reads it. With `isolate: true`, the default, the runner restarts the `webServer` before a
mutant run when that run or the one before it in the same process tests a server-side mutant: a mutant
that the server reached in the dry run. With `isolate: false`, one server serves every run except those
of mutants in start-up code. Set it for a server that keeps no state between requests.

A restart costs the server's start and its cold first requests. On the epic-stack app's Vite dev server,
one measurement put that at about 10 s per restarted run.

Stryker runs the dry run in one test runner process. With `isolate: true` or `mutate: 'auto'`, that
process writes the server-side mutants it found to `.lz-playwright-server-mutants` in Stryker's sandbox,
and the other processes read the file at their first mutant run. A process that cannot read it restarts
the `webServer` around every mutant run and logs one warning. With Stryker's `inPlace: true`, the sandbox
is the project, so add `.lz-playwright-server-mutants` to `.gitignore`.

### More than one Stryker process

Each process must switch its own server to its mutant. Stryker starts more than one test runner process
with a checker, or with `concurrency` above 1, its default on a machine with more than one core. Then
each process moves every `webServer` that has a `port` or a `url` to a free port before Playwright starts
it. The runner moves:

- the `url` or `port` that Playwright waits for;
- every value in the `webServer`'s `env` that equals the configured port;
- the configured port where it stands as a whole word in the `command`, such as `--port 3000` or
  `-p 3000`;
- `PORT`, for the `command` and the workers, when one `webServer` moves;
- `PLAYWRIGHT_TEST_BASE_URL`, when it points at a moved `webServer`;
- the projects' `baseURL`.

So the `command` must take its port from one of these. A `command` that binds the configured port anyway
fails the startup with an error that names both ports, as soon as the configured port answers. The runner
also refuses a project `baseURL` that points at no `webServer`, and projects whose `baseURL`s point at
different `webServer`s.

### When the setup cannot work

With `mutate: true`, each of these stops the runner at startup. With `mutate: 'auto'`, each logs one
warning and the process runs as with `false`:

- No process that global setup started loaded the server hook within 1 s: the `webServer` is not
  Node.js, or its `command` replaces `NODE_OPTIONS`.
- A `webServer`'s `env` sets `NODE_OPTIONS`, which replaces the one that loads the hook. Set it in the
  environment that runs Stryker instead.
- A `webServer` has `reuseExistingServer: true` and already answers before global setup. Only the process
  that started a server can switch its mutant, so stop your own server.
- The `command` bound the configured port after the runner moved it.
- The runner cannot move the projects' `baseURL` along with the `webServer`.

Under `'auto'`, the process that runs the dry run decides for every process. When the dry run reached
server-side mutants and another process ran as with `false`, that process fails its mutant runs with an
error. Set `mutate: true` to see its cause as an error at startup.

## Flaky tests

A test that fails without a mutant at fault kills that mutant, and the report then counts a mutant as
detected that the tests may never detect. The runner hands flakiness to Playwright's own settings:

- Each failed test is retried as many times as the Playwright config's `retries` says, or the `retries`
  option. A `describe.configure({ retries })` above 0 applies to its tests and wins over both.
  `describe.configure({ retries: 0 })` does not turn retries off: Playwright gives the runner no way to tell
  it from no setting, so those tests get their project's retries.
- Projects that share a name must get the same retries, since the runner looks retries up by project
  name. When they would not, the runner stops with an error; give the projects distinct names or set the
  `retries` option.
- A test that passes on a retry passes, as in `npx playwright test`: the mutant survives that test. With
  `failOnFlakyTests: true` in the Playwright config, it fails, and the mutant is killed. The same holds in
  the dry run, where a failed test stops Stryker.
- The dry run warns with the names of the tests that passed only on a retry.

A retry costs time only for a test that failed, so mostly for killed mutants: each one runs its failing
test once more per retry, and each attempt waits out the `expect.timeout` of its failing assertion. On
this repository's demo e2e suite (32 mutants, 27 of them killed, a 5 s expect timeout), one retry makes
the mutant runs about 1.6 to 1.7 times as long, and two retries about 2.1 to 2.4 times: an estimate from
the measured times of its killed and surviving mutants. Playwright starts a new worker for each retry, so raise
`timeoutMS` by the expect timeout plus about 3 s per retry; the runner warns when it is lower and names the
value to set. A retry that runs past the runner's deadline is stopped, and the mutant counts as Killed, as
it would without the retry.

Playwright's `runTests` turns retries off, so the runner sets them again on Playwright's internal test
objects when a run begins. If a Playwright version changes those objects, every run, the dry run included,
ends in an error that names what changed. Set the `retries` option to 0 to run without retries until the
runner supports that version.

Playwright's `repeatEach` stays 1 under Stryker. To find flaky tests before a mutation run, run the suite
with `npx playwright test --repeat-each=10 --fail-on-flaky-tests`. Web-first assertions such as
`await expect(locator).toHaveText()` retry until `expect.timeout`, so they make tests less flaky without
any setting in the runner.

## Surviving mutants

Stryker's clear-text reporter prints each surviving mutant: its start `file:line:column`, each original
line marked `-` and each mutated line marked `+`, and under `Tests ran:` the tests that ran against it. By
default it lists at most 3 tests. To list more, raise `maxTestsToLog` in the Stryker config:

```ts
clearTextReporter: { maxTestsToLog: 20 },
```

A static mutant, one whose code ran outside any test, such as when a module loads or in a `beforeAll`
hook, prints `Ran all tests for this mutant.` instead. With
`coverageAnalysis: 'off'`, no tests are listed. To kill a surviving mutant:

1. Edit a test that ran against it, so that the test checks what the mutant changes.
2. Optionally, run those tests on the unmutated code first. Paste the `Tests ran:` lines into a file and run
   `npx playwright test --config <configFile> --test-list <file>`.
   - For a config without named projects, remove the `[...] › ` prefix from each line.
   - Tests that pass say nothing about the mutant.
   - A line that matches no test runs nothing and still exits 0, so compare the number of tests that ran
     with the number of lines.
   - A test from a `describe.serial` group runs alone.
   - `--test-list` has no effect with `--ui`.
3. Run the mutant again with Stryker:
   `npx stryker run stryker.config.ts --mutate "<file>:<startLine>-<endLine>" --reporters clear-text,progress`.
   `<startLine>` is the line that clear-text prints, and `<endLine>` is `<startLine>` plus the number of `-`
   lines, minus 1. Stryker tests a mutant only when the range holds all of it. `--reporters` on the command
   line replaces the config's list, so this run leaves the HTML and JSON reports as they were.

   If the last full run used `--incremental`, run `npx stryker run stryker.config.ts --incremental` instead.
   Stryker then tests once more each mutant whose covering test changed.

With `survivorTraces`, the traces index prints the `--mutate` command for each surviving mutant. See
[Traces of surviving mutants](#traces-of-surviving-mutants).

## Traces of surviving mutants

A surviving mutant shows that the tests miss a change, not what the page did with it. To see what the
page did, set `survivorTraces` and add the `lz-playwright-traces` reporter:

```ts
export default {
  // ...
  reporters: ['clear-text', 'html', 'lz-playwright-traces'],
  ignorePatterns: ['/reports/lz-playwright-traces'],
  lzPlaywright: { survivorTraces: 'reports/lz-playwright-traces' },
} satisfies PartialStrykerOptions;
```

Every test run then records a Playwright trace with DOM snapshots. After each run of a mutant that
survives, the runner copies the trace of every test that ran, one per attempt, to a folder for that
mutant. At the end, the reporter writes `index.html` in `survivorTraces`: Stryker's report, where each
surviving mutant lists the tests that ran, an `npx playwright show-trace` command for each trace, and an
`npx stryker run --mutate` command that runs that mutant again after a test change. In incremental mode,
a survivor whose result Stryker reused has no trace. Run it again with that command to record one.

- The reporter empties the folder when a run starts, a run of the `npx stryker run --mutate` command
  included: copy the folder first to keep its traces. The reporter refuses a folder that holds the project.
- Without the reporter, a run with `survivorTraces` stops with an error, since nothing would empty the
  folder.
- Add the folder to `ignorePatterns`, as above. Otherwise Stryker copies the previous run's traces into
  every sandbox.
- `stryker serve` builds no reporters, so it stops with that error too: leave `survivorTraces` unset in
  the config that `stryker serve` uses.

The traces have no screenshots unless `traceScreenshots` is `true`. Without them, the trace viewer cannot
show what a `<canvas>` drew, 2D or WebGL: it shows a gray checkerboard in its place, and a canvas that
covers the page hides the page behind it. A `<video>` that loads its file from a URL plays in the viewer
either way, since the trace holds that file. The viewer plays the file, not the frame the test saw. To see canvas content, set `traceScreenshots: true` and turn on "Display canvas
content" in the trace viewer's settings, which is off by default. Screenshots made one short test's trace
about 8 times as large, but a trace of tldraw's minimap test only 4% larger, since its network resources
made up most of it.

Playwright calls a trace of every test "not recommended as it's performance heavy". Measured on one
worker with a suite of 25 tests: the test durations added up to 100 to 120 s in three runs without
traces, 114 to 131 s in three runs with Playwright's default trace, which includes screenshots, and 117 s
in one run with the runner's trace without screenshots. One short test took 1.6 times as long with
Playwright's default trace, and 1.3 times as long with the runner's trace. The runner's traces of one suite run took
10 MB, against 42 MB with screenshots. No test changed status. A test that waits on timing can still
change status under tracing, so the reporter warns. Compare a mutant's status in a traced run with an
untraced run's report before you act on it, and leave `survivorTraces` unset in runs that gate a build.

## What killed the mutants

Stryker's JSON reporter writes each killed mutant's failure message as `statusReason`, in
`reports/mutation/mutation.json` by default. This script counts the kills by the kind of failure in the
message's first line:

```js
// kill-kinds.mjs. Run: node kill-kinds.mjs reports/mutation/mutation.json
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const mutants = Object.values(report.files).flatMap((file) => file.mutants);
const rules = [
  ['action timeout', /Timeout \d+ms exceeded/],
  ['assertion', /^Error: expect\(/],
  ['test timeout', /Test timeout of/],
];
const kinds = {};

for (const { statusReason = '' } of mutants.filter((m) => m.status === 'Killed')) {
  const first = statusReason.replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0];
  const kind = rules.find(([, rule]) => rule.test(first))?.[0] ?? 'other';

  kinds[kind] = (kinds[kind] ?? 0) + 1;
}

console.table(kinds);
console.log('Timeout:', mutants.filter((m) => m.status === 'Timeout').length);
```

Playwright's messages hold terminal color codes, so the script removes them before it matches. The
table counts only killed mutants, so the script also prints the number of `Timeout` mutants, which Stryker
counts as detected too.

- Each kill's kind is one sample. Stryker keeps the message of the first test that failed, and a mutant
  that several tests cover may fail differently in each.
- A kill caused by a page that fails to hydrate has an ordinary message, such as a locator timeout, so the
  table does not show those kills as a group.

## Faster mutation runs

Stryker's `concurrency` sets how many test runner processes run at once. Each one starts its own
`webServer`, so give each process its own port from `STRYKER_MUTATOR_WORKER`, as the example in Configure
Stryker shows. With `webServer.mutate` on, the runner moves the ports itself. On this repository's demo, concurrency 2 ran 1.9 times as fast as concurrency 1
and concurrency 4 ran 3.2 times as fast, with the same status for every mutant (2 rounds each, e2e and
component tests).

Playwright 1.64's source shows that each mutant run loads the Playwright config twice, in two new processes:
the test loader and the worker. So what the config imports adds to each run. Keep the config's imports light: on the
demo, `@nx/playwright/preset` and `@nx/devkit` took about 0.19 s to import in a fresh process, against
0.27 s for `@playwright/test` itself.

### Faster killed mutants

Killed mutants can take most of a mutation run's time. On this repository's demo, they took 90% of an e2e
run and 92% of a component-test run, at concurrency 1. A killed mutant's failing assertion waits out
`expect.timeout` before it fails, and Playwright's default is 5 s. Stryker sets `STRYKER_MUTATOR_WORKER` in
each test runner process, and Playwright's own processes inherit it. So the Playwright config can use a
shorter wait under Stryker only:

```ts
export default defineConfig({
  expect: { timeout: process.env['STRYKER_MUTATOR_WORKER'] === undefined ? 5000 : 1000 },
  // ...
});
```

On this repository's demo, 1000 ms cut a component-test run from a median of 58 s to 29 s, and an e2e
run from 111 s to 56 s. Those are 5 runs per side, interleaved, at concurrency 3. The e2e runs varied
more: the default side ranged from 89 s to 150 s, a spread larger than the 55 s gain. No mutant changed
between Killed and Survived. If the page needs longer than the shorter wait to show the right result, the
assertion fails without any mutant at fault, and the mutant counts as killed. So run once with each setting and compare the statuses in the
two JSON reports before you keep the shorter wait.

Set `use.actionTimeout` too, since Playwright's default is none. A mutant that removes an element makes a
click on it wait out the whole test timeout, and the mutant counts as a Timeout instead of Killed. On the
RealWorld app, `use.actionTimeout: 5000` turned the 15 timeouts among 26 detected mutants into kills, and
the run took 4 min 46 s, against 7 min 18 s and 8 min 48 s in two runs without it. Keep `actionTimeout`
below the per-test timeout, so that a killed mutant's failing test says what broke.

### Incremental mode

Stryker's `--incremental` option reuses the last run's result for each mutant whose code and tests did not
change, and runs the rest. Stryker keeps the results in `reports/stryker-incremental.json`, or in the file
that `--incrementalFile` names. To match tests from one run to the next, Stryker needs each test's file,
start position and name. The runner reports all three. The name holds the project name, the file name, the
`describe` titles and the test title.

```shell
npx stryker run --incremental
```

Stryker always runs the dry run, so an incremental run takes at least as long as the sandbox copy, the
`webServer` start and the dry run. On this repository's demo e2e config, at concurrency 7, with the median of 5 alternated
runs per side and the range in brackets:

| Change since the last run  | Results reused | Incremental  | Full         |
| -------------------------- | -------------- | ------------ | ------------ |
| None                       | 32 of 32       | 16 s (16-18) | 68 s (65-73) |
| One edit to a mutated file | 23 of 32       | 43 s (40-48) | 66 s (65-71) |
| One edit to a test         | 18 of 32       | 45 s (44-46) | 66 s (65-66) |

Stryker sees an edit to a file in `mutate`. It also sees an edit to a test, from the test's `test(` call to
the next test in the file. It does not see the changes below, and keeps a result that one of them would
change:

- Application files outside `mutate` that the app under test loads: other modules, styles and assets.
- Code in a spec file outside every test: imports, top-level helpers, and hooks above the first test. A hook
  between two tests counts as part of the test above it.
- In a spec file that starts with a block comment, such as a license header, Stryker places each test one
  line below its `test(` call. An edit on that line counts against the test above it, unless the edit
  changes the title.
- Fixtures, page objects and other modules that the specs import.
- The Playwright config, its `webServer` included.
- This runner, Playwright, Stryker, and the Stryker options. The JSX mutators too, unless the change alters
  a mutant's replacement text.
- The Node.js version and environment variables.

On the demo, an edit to the `beforeEach` above the first test reused all 32 results and ran no mutant. After a
change in that list, run `npx stryker run --incremental --force`. Stryker then runs every mutant in `mutate`
and replaces the file.

In CI, restore the file only when the inputs you can hash did not change. Hash them into the cache key, and add
the run id and attempt so that each run saves its own file. With GitHub Actions:

```yaml
- uses: actions/cache@v4
  with:
    path: reports/stryker-incremental.json
    key: stryker-incremental-${{ runner.os }}-${{ hashFiles('package-lock.json', '.nvmrc', 'stryker.config.*', 'e2e/playwright.config.*', 'e2e/fixtures/**') }}-${{ github.run_id }}-${{ github.run_attempt }}
    restore-keys: stryker-incremental-${{ runner.os }}-${{ hashFiles('package-lock.json', '.nvmrc', 'stryker.config.*', 'e2e/playwright.config.*', 'e2e/fixtures/**') }}-
- run: npx stryker run --incremental
```

Replace the paths with your lockfile, Node.js version file, Stryker config, Playwright config and fixture
folders. If you set `incrementalFile`, put that path in `path`. The cache step saves the file only when the
job succeeds, so a run that fails `thresholds.break` leaves the older file in the cache.

The hash does not cover the hooks and helpers in the spec files, or the application files outside `mutate`.
Add them to the hash if a full run after each such edit costs less than a result that is wrong and goes
unnoticed.

## What the runner changes in the Playwright config

On every run, these settings replace the ones in the Playwright config, except where a line says
otherwise:

- `screenshot` and `video` are off. `trace` is off, or on with DOM snapshots when `survivorTraces` is
  set, with screenshots only when `traceScreenshots` is `true`.
- The reporters in the Playwright config do not run.
- `outputDir` is a folder in a private temp directory, `lz-playwright-<pid>-*` in the OS temp
  directory, which `dispose` removes. A runner that Stryker killed first leaves that directory behind.
  The next runner to start removes it if the process that owned it no longer runs and the directory's
  `owner` file shows it was made on the same host (and, on Linux, in the same PID namespace). Runners
  in containers that share `/tmp`, or on hosts with different host names that share a temp directory,
  never remove one another's directories. A directory without a readable `owner` file is kept, and so
  is one a runner on Linux without `/proc` made; remove those by hand.
- `maxFailures` is 1, unless Stryker's `disableBail` is on. `disableBail` cannot clear a `maxFailures`
  that the Playwright config sets.
- In a mutant run, the per-test timeout is Stryker's timeout for the mutant less 5.6 s but at least
  2 s, and at most the largest test timeout in the Playwright config. The dry run keeps the config's
  timeouts.
- A mutant run that is still going 2.6 s before Stryker's timeout is stopped, and the mutant is a
  Timeout unless a test already killed it or every selected test has passed, which makes it Survived.
  This catches a looping test that raised its own timeout. When
  Stryker's timeout is under 7.6 s, there is no such stop, and Stryker's own timer ends the run. The dry
  run has no such stop either.
- `repeatEach` is 1. `retries` is the Playwright config's or the `retries` option, as Flaky tests says.
- With `webServer.mutate` on and more than one Stryker test runner process, each `webServer` and the
  projects' `baseURL` move to a free port, as
  [More than one Stryker process](#more-than-one-stryker-process) says.

## Limits

- Server-side code gets the active mutant only with `webServer.mutate` on, and only in a Node.js
  `webServer`. Otherwise its mutants are NoCoverage, or Survived with `coverageAnalysis: 'off'`, and on a
  server-rendered app, a mutant in code that both the server and the page run is active in the page only.
  A mutant there that changes text or an element then breaks hydration and counts as Killed even when no
  test checks it, and one that changes an attribute never reaches the DOM.
- The `webServer` restarts only for the runs that [Server-side code](#server-side-code) names, and a
  restart keeps what the server wrote to its backend, such as a database file. So what one run writes is
  still there in the next. A suite that needs a fresh backend can report a mutant wrongly.
- A request to the `webServer` without the test id header, such as one the server sends to itself or one
  from a page that a `beforeAll` hook opened, counts for every test that ran when it arrived. When no
  test ran then, it counts as reached outside any test, so Stryker runs every test for its mutants.
- When the runner moves a `webServer` to a free port, another process can take that port before the
  `webServer` binds it. Playwright then reports the bind error.
- Dependency projects, such as a `setup` project that logs in, run on every mutant run with the mutant
  active. Login in `globalSetup` runs once instead.
- Web workers and service workers never get the active mutant, because the runner sets it with a script
  that runs in pages only. A mutant in code that only a worker runs can never be killed: it is
  NoCoverage, or Survived with `coverageAnalysis: 'off'`. Leave such code out of `mutate`. A mutant in
  code that both a page and a worker run is active in the page only.
- Coverage is lost across a cross-origin navigation.
- Stryker's `ignoreStatic` skips the mutants that only `beforeAll` pages, `beforeAll` and `afterAll`
  hooks, fixtures, or imports reach. A mutant that both such code and a test reach still runs, but only
  with the tests whose own coverage reached it, and the runner keeps it active from the start of the
  run, in hooks, fixtures, and imports too. So that code can still kill it, while a skipped test that
  would have killed it does not run.
- The runner refuses Stryker's `--testFiles` option.
- A build that type-checks Angular templates, such as an Angular or Analog production build that the
  `webServer` runs, can reject Stryker's instrumented code: the `// @ts-nocheck` that Stryker adds to
  each instrumented file does not reach Angular's template type check. Turn off the build's type
  checking for the mutation run, with Analog `disableTypeChecking: true`.
- In an Nx workspace:
  - `.stryker-tmp`, or the folder your `tempDirName` names, must be in `.gitignore` or `.nxignore`. A
    failed Stryker run leaves its sandbox there, a full copy of the workspace, and Nx then refuses every
    task.
  - Add `/.nx` to Stryker's `ignorePatterns`. Otherwise Stryker copies `.nx/workspace-data` into the
    sandbox, the sandbox's Nx connects to the workspace's running Nx daemon, the daemon refuses a
    different workspace, and a `webServer` that runs an Nx task fails to start.
  - A `webServer` that runs an Nx task starts an Nx daemon in the sandbox, which outlives the run, and
    Stryker then fails with "Failed to delete stryker temp directory". Run `npx nx daemon --stop` in the
    sandbox folder, then delete the folder. `NX_DAEMON=false` in the `webServer`'s `env` should prevent this,
    but is untested.
- A Vite `define` of `globalThis.__stryker__.activeMutant` overrides the runner's value. Remove it.

## License

MIT
