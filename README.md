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
