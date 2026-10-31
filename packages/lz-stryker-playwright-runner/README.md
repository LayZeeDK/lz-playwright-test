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

Then select it in the Stryker config:

```ts
import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

export default {
  appendPlugins: ['@layzee/lz-stryker-playwright-runner'],
  testRunner: 'lz-stryker-playwright',
  lzStrykerPlaywright: { configFile: 'playwright.config.ts' },
  coverageAnalysis: 'perTest',
  concurrency: 1,
  timeoutMS: 10_000,
  mutate: ['src/**/*.tsx'],
} satisfies PartialStrykerOptions;
```

`appendPlugins` adds the runner to the plugins Stryker loads by default. Setting `plugins` instead
replaces that list, so a checker such as `@stryker-mutator/typescript-checker` no longer loads unless the
list names it too.

Each Stryker test runner process starts the Playwright `webServer` itself. Without `concurrency`, Stryker
starts one process per CPU core, less one on a machine with more than 4 cores, and with a fixed port in
the Playwright config every process after the first fails at startup because the port is taken. A Stryker
checker hands its processes to new test runners when it finishes, so even at `concurrency` 1 a second
test runner starts. So either give each process its own port, for example from `STRYKER_MUTATOR_WORKER`
(see Faster mutation runs), or set the `webServer`'s `reuseExistingServer` to `true` so that the
processes share one server. With `reuseExistingServer`, stop any dev server of your own first: a server
that was already running serves the original sources, not Stryker's instrumented copy.

Stryker's default `timeoutMS` is 5000 ms, the same as Playwright's default `expect.timeout`. Keep
`timeoutMS` at least twice the expect timeout, or a killed mutant's failing assertion runs out Stryker's
timeout and the mutant counts as a Timeout. The runner warns at startup when it is lower.

`coverageAnalysis` can be `off`, `all`, or `perTest`. With `perTest`, Stryker runs only the tests that
reached a mutant, except for a mutant reached outside any test, which Stryker runs against every test.
Coverage from the browser pages counts for the test that opened the page. Coverage of code that the
Playwright worker itself imports counts for the test whose body or `beforeEach` and `afterEach` hooks ran
it. Code that a `beforeAll` or `afterAll` hook, a fixture, or the import itself ran is reached outside
any test.

## Break threshold

Stryker's `thresholds.break` defaults to none, so a run passes at any score. Set it a mutant or two below
the first measured score: a browser test that waits on timing can flip one mutant between Killed and
Survived from one run to the next.

## Options

Set these under `lzStrykerPlaywright` in the Stryker config. Stryker checks them against the schema the package
exports as `strykerValidationSchema`.

- `configFile`: the Playwright config file, relative to the project root. Without it, Playwright looks
  for `playwright.config.*` in the working directory.
- `projects`: the Playwright projects to run. Without it, the runner runs the projects that Playwright
  runs without `--project`, so not those with `default: false`.
- `workers`: the Playwright workers per Stryker test runner process. The default is 1. The `workers`
  value in the Playwright config has no effect.

## Faster mutation runs

Stryker's `concurrency` sets how many test runner processes run at once. Each one starts its own
`webServer`, so the Playwright config must give each process its own port, for example from
`STRYKER_MUTATOR_WORKER`. On this repository's demo, concurrency 2 ran 1.9 times as fast as concurrency 1
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
- Web workers and service workers get no coverage, and coverage is lost across a cross-origin
  navigation.
- Stryker's `ignoreStatic` skips the mutants that only `beforeAll` pages, `beforeAll` and `afterAll`
  hooks, fixtures, or imports reach.
- The runner refuses Stryker's `--testFiles` option.
- In an Nx workspace, `.stryker-tmp` must be in `.gitignore` or `.nxignore`. A failed Stryker run leaves
  its sandbox there, a full copy of the workspace, and Nx then refuses every task.
- A Vite `define` of `globalThis.__stryker__.activeMutant` overrides the runner's value. Remove it.

## License

MIT
