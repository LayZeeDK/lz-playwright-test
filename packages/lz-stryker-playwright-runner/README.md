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
  plugins: ['@layzee/lz-stryker-playwright-runner'],
  testRunner: 'lz-stryker-playwright',
  lzStrykerPlaywright: { configFile: 'playwright.config.ts' },
  coverageAnalysis: 'perTest',
  mutate: ['src/**/*.tsx'],
} satisfies PartialStrykerOptions;
```

`coverageAnalysis` can be `off`, `all`, or `perTest`. With `perTest`, Stryker runs only the tests that
reached a mutant. Coverage from the browser pages counts for the test that opened the page. Coverage of
code that the Playwright worker itself imports counts too: for the test whose body or `beforeEach` and
`afterEach` hooks ran it, and as shared coverage when a `beforeAll` or `afterAll` hook or a fixture ran
it.

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

Playwright 1.64's source loads the Playwright config twice per mutant run, in two new processes: the test
loader and the worker. So what the config imports adds to each run. Keep the config's imports light: on the
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
between Killed and Survived. If the page needs longer than the shorter wait to show the right result, the assertion fails without any mutant
at fault, and the mutant counts as killed. So run once with each setting and compare the statuses in the
two JSON reports before you keep the shorter wait. Keep `timeoutMS` at least twice the expect timeout;
the runner warns at startup when it is lower.

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

The repository's `docs/VERDICT.md` (Limits) lists what the runner cannot do, among them: on a
server-rendered app the mutant is active in the browser only, and Stryker's `ignoreStatic` skips mutants
that only `beforeAll` pages, `beforeAll` and `afterAll` hooks, or fixtures reach.

## License

MIT
