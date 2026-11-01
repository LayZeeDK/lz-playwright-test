# @layzee/lz-stryker-playwright-runner

A StrykerJS test runner for Playwright Test. It runs Playwright e2e tests and Playwright component
tests (`mount()`) as Stryker tests, reports per-test coverage, and starts the Playwright `webServer`
once per Stryker test runner process instead of once per mutant.

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
npm install -D @layzee/lz-stryker-playwright-runner @stryker-mutator/core @playwright/test
```

Then select it in a Stryker config file, here `stryker.config.ts`:

```ts
import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

export default {
  appendPlugins: ['@layzee/lz-stryker-playwright-runner'],
  testRunner: 'lz-stryker-playwright',
  lzStrykerPlaywright: { configFile: 'playwright.config.ts' },
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
projects. Stryker's timeout for a mutant counts only the time of the tests it selected. So add the time
of the longest serial group and of the dependency projects to the `timeoutMS` above, or such a run ends
as a Timeout, which Stryker counts as detected even when no test would have failed.

## Break threshold

Stryker's `thresholds.break` defaults to none, so a run passes at any score. Set it a mutant or two below
the first measured score: a browser test that waits on timing can flip one mutant between Killed and
Survived from one run to the next.

## Options

Set these under `lzStrykerPlaywright` in the Stryker config. Stryker checks them against the schema the package
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

## Faster mutation runs

Stryker's `concurrency` sets how many test runner processes run at once. Each one starts its own
`webServer`, so give each process its own port from `STRYKER_MUTATOR_WORKER`, as the example in Configure
Stryker shows. On this repository's demo, concurrency 2 ran 1.9 times as fast as concurrency 1
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

## What the runner changes in the Playwright config

On every run, these settings replace the ones in the Playwright config, except where a line says
otherwise:

- `screenshot`, `trace`, and `video` are off.
- The reporters in the Playwright config do not run.
- `outputDir` is a folder in a private temp directory, `lz-stryker-playwright-<pid>-*` in the OS temp
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
  Timeout unless a test already killed it. This catches a looping test that raised its own timeout. When
  Stryker's timeout is under 7.6 s, there is no such stop, and Stryker's own timer ends the run. The dry
  run has no such stop either.
- `retries` is 0 and `repeatEach` is 1. Retries set with `describe.configure({ retries })` still apply.

## Limits

- Only code that runs in the page or in a Playwright test worker gets the active mutant. Server-side code
  (SSR, API routes) runs in the `webServer`, which starts once without one, so its mutants are
  NoCoverage, or Survived with `coverageAnalysis: 'off'`. On a server-rendered app, a mutant that
  changes text or an element breaks hydration and counts as Killed even when no test checks it, and one
  that changes an attribute never reaches the DOM.
- One server serves every mutant run, so what one run writes to the server or its backend is still
  there in the next. A suite that needs a fresh backend can report a mutant wrongly.
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
