# stryker-playwright-runner

A prototype StrykerJS test runner for Playwright Test. One plugin runs Playwright e2e tests and
Playwright component tests (`mount()`) as Stryker tests, with per-test coverage, and starts the
`webServer` once instead of once per mutant.

The answer to whether this works, the evidence, and the limits are in `docs/VERDICT.md`.

## Layout

- `packages/stryker-playwright-runner`: the runner, package `@layzeedk/stryker-playwright-runner`.
- `apps/demo-app` (Nx project `@layzeedk/demo-app`): the demo app and its Playwright component tests
  (`playwright.components.config.mts`).
- `apps/demo-app-e2e`: the demo app's Playwright e2e tests.
- `stryker.e2e.config.ts`, `stryker.ct.config.ts`: Stryker configs for the demo.
- `oss/`: the configs, patches, and scripts that copies of four open-source repos needed for a Stryker
  run. `oss/README.md` describes each copy.
- `docs/research/`: the research behind the design.

## Options

Set these under `playwright` in the Stryker config. `packages/stryker-playwright-runner/src/index.ts` holds
the schema Stryker checks them against.

- `configFile`: the Playwright config file, relative to the project root. Without it, Playwright looks
  for `playwright.config.*` in the working directory.
- `projects`: the Playwright projects to run. Without it, the runner runs the projects Playwright runs
  without `--project`, so not those with `default: false`.
- `workers`: the Playwright workers per Stryker test runner process. The default is 1. The `workers`
  value in the Playwright config has no effect.

On every run, these settings replace the ones in the Playwright config, except where a line says otherwise:

- `screenshot`, `trace`, and `video` are off.
- The reporters in the Playwright config do not run.
- `outputDir` is a folder in a private temp directory, which `dispose` removes.
- `maxFailures` is 1, unless Stryker's `disableBail` is on. `disableBail` cannot clear a `maxFailures` that
  the Playwright config sets.
- In a mutant run, the per-test timeout is Stryker's timeout for the mutant less 5 s, capped at the largest
  test timeout in the Playwright config. The dry run keeps the config's timeouts.
- `retries` is 0 and `repeatEach` is 1. Playwright's `TestRunner.runTests` sets these two, not the runner.
  Retries set with `describe.configure({ retries })` still apply.

## Type-check and test the runner

Run these from the repo root. The tests start a browser, so install Chromium first.

```sh
npm install
npx playwright install chromium
npx tsc -p packages/stryker-playwright-runner/tsconfig.json
node --test packages/stryker-playwright-runner/test/runner.test.ts packages/stryker-playwright-runner/test/run-result.test.ts
```

To run Stryker on the demo app, use `npx stryker run stryker.e2e.config.ts` or
`npx stryker run stryker.ct.config.ts`. The Rerun section of `docs/VERDICT.md` lists the commands for
the measured rows, and `oss/README.md` gives the steps for the open-source copies.
