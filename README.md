# stryker-playwright-runner

A StrykerJS test runner for Playwright Test. One plugin runs Playwright e2e tests and
Playwright component tests (`mount()`) as Stryker tests, with per-test coverage, and starts the
`webServer` once instead of once per mutant. A second plugin adds mutators for the parts of
JSX that Playwright tests look at: text, labels, handlers, conditional elements, links, and disabled,
hidden, role, and ARIA state attributes.

The answer to whether this works, the evidence, and the limits are in `docs/VERDICT.md`.

## Packages

- `packages/stryker-playwright-runner/README.md`: the runner's requirements, Stryker config, options,
  and the Playwright settings it replaces on every run.
- `packages/stryker-jsx-mutators/README.md`: the ten JSX mutators and how to turn them on.
- `packages/stryker-playwright-mutators/README.md`: the mutators for Playwright test code, their tiers and
  limits, and why Stryker's built-in mutators are off in test code.

These packages ship built JavaScript in `dist`. The workspace's own Stryker runs load the runner and the JSX
mutators from there, so build first (the Nx targets below do).

## Layout

- `packages/stryker-playwright-runner`: the runner, package `@layzee/stryker-playwright-runner`.
- `packages/stryker-jsx-mutators`: the JSX mutators, package `@layzee/stryker-jsx-mutators`.
- `packages/stryker-playwright-mutators`: the mutators for Playwright test code, package
  `@layzee/stryker-playwright-mutators`.
- `packages/stryker-mutator-install`: the private code that both mutator packages use to put their mutators into
  Stryker, package `@layzee/stryker-mutator-install`.
- `packages/<package>/stryker.config.mjs`: in the JSX mutators, the Playwright mutators and the install code, a
  Stryker config that mutates the package's own source.
- `apps/demo-app` (Nx project `@layzee/demo-app`): the demo app and its Playwright component tests
  (`playwright.components.config.mts`).
- `apps/demo-app-e2e`: the demo app's Playwright e2e tests.
- `stryker.e2e.config.ts`, `stryker.ct.config.ts`: Stryker configs for the demo.
  `stryker.e2e.ui.config.ts` adds the JSX mutators to the e2e run.
- `stryker.base.ts`: the settings that all four Stryker configs share. The package configs share its reporters
  and ignore list.
- `stryker.package.ts`: `packageConfig(name)`, the shared body of the three package `stryker.config.mjs` files.
- `stryker.e2e.command.config.ts`: the demo baselines on Stryker's `command` runner, selected with
  `STRYKER_BASELINE=define` or `STRYKER_BASELINE=off`.
- `oss/`: the configs, patches, and scripts that copies of four open-source repos needed for a Stryker
  run. `oss/README.md` describes each copy.
- `tools/`: the scripts that the Rerun section of `docs/VERDICT.md` calls: the benchmarks, the Linux
  container run (`linux-run.sh`), and the demo on the packed tarballs (`packed-demo/`).
- `docs/research/`: the research behind the design.
- `docs/filings.md`: drafts of upstream issues found while validating the runner, none filed.
- `docs/design/`: the design for the JSX mutators.
- `spikes/`: throwaway experiments behind that design.

## Type-check and test the runner

Run these from the repo root. The `test` target needs no browser; `test-browser` starts Chromium, so
install it first.

```sh
npm install
npx playwright install chromium
npx nx run-many -t typecheck build
npx nx run @layzee/stryker-playwright-runner:test
npx nx run @layzee/stryker-playwright-runner:test-browser
```

`test/browser/jsx-mutators.test.ts` runs the runner against a page instrumented with the JSX mutators
and checks that a Playwright test kills each mutator's mutant.

The JSX mutators' tests need no browser:

```sh
npx nx run @layzee/stryker-jsx-mutators:test
```

Neither do the Playwright mutators' tests nor the install code's. To check that a package's tests catch a change to
its source, run Stryker on it with the package's own config, where `<package>` is `stryker-jsx-mutators`,
`stryker-playwright-mutators` or `stryker-mutator-install`:

```sh
npx nx run @layzee/stryker-playwright-mutators:test
npx nx run-many -t build
npx stryker run packages/<package>/stryker.config.mjs
```

Build first: one of the JSX mutators' tests starts a process that loads the install code from its `dist` folder, so
without a build Stryker's first test run fails. The configs' thresholds are 100, so the run exits 1 when a mutant survives. To mutate only a change, add
`--mutate "packages/<package>/src/<file>.ts:<startLine>-<endLine>"`. Each config runs the tests with
Stryker's `command` runner and `node --test --test-concurrency=1`. Run in parallel, each Stryker worker would start
test files on every core, and mutants would time out without being killed. For the same reason each config sets
`timeoutMS` to 30000: on a loaded machine, Stryker's default of 5000 let mutants that no test kills pass as Timeouts.

To run Stryker on the demo app, use `npx nx run @layzee/demo-app-e2e:mutate-e2e`,
`npx nx run @layzee/demo-app-e2e:mutate-e2e-ui`, or `npx nx run @layzee/demo-app:mutate-ct`. Each
target builds both packages first, because Stryker loads them from their `dist` folders.
`stryker.e2e.command.config.ts` has no target: it loads neither package, so it needs no build, and it
runs once per `STRYKER_BASELINE` value. The Rerun section of `docs/VERDICT.md` lists the commands for
the measured rows, and `oss/README.md` gives the steps for the open-source copies.
