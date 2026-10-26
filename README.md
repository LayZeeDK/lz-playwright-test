# stryker-playwright-runner

A prototype StrykerJS test runner for Playwright Test. One plugin runs Playwright e2e tests and
Playwright component tests (`mount()`) as Stryker tests, with per-test coverage, and starts the
`webServer` once instead of once per mutant. A second plugin adds mutation operators for the parts of
JSX that Playwright tests look at: text, labels, handlers, conditional elements, links, and disabled,
hidden, role, and ARIA state attributes.

The answer to whether this works, the evidence, and the limits are in `docs/VERDICT.md`.

## Requirements

- Playwright 1.63 or a later 1.x release, tested on 1.63.0 and 1.64.1. The runner calls Playwright internals that a
  release can change. The Limits section of `docs/VERDICT.md` lists them.
- StrykerJS 10, tested on 10.1.1.
- A Node.js version that strips TypeScript types by default, tested on 24.22.0. The package ships its
  TypeScript source, and Node does not strip types under `node_modules`. Reach the runner through a
  symlink that Node resolves outside `node_modules`, such as an npm workspace or `npm link`.
- Chromium. The runner is tested only with Chromium. Firefox and WebKit are untested.

## Layout

- `packages/stryker-playwright-runner`: the runner, package `@layzee/stryker-playwright-runner`.
- `packages/stryker-ui-mutators`: the UI mutation operators, package `@layzee/stryker-ui-mutators`.
- `apps/demo-app` (Nx project `@layzee/demo-app`): the demo app and its Playwright component tests
  (`playwright.components.config.mts`).
- `apps/demo-app-e2e`: the demo app's Playwright e2e tests.
- `stryker.e2e.config.ts`, `stryker.ct.config.ts`: Stryker configs for the demo.
  `stryker.e2e.ui.config.ts` adds the UI mutation operators to the e2e run.
- `stryker.e2e.command.config.ts`: the demo baselines on Stryker's `command` runner, selected with
  `STRYKER_BASELINE=define` or `STRYKER_BASELINE=off`.
- `oss/`: the configs, patches, and scripts that copies of four open-source repos needed for a Stryker
  run. `oss/README.md` describes each copy.
- `tools/`: the benchmark scripts that the Rerun section of `docs/VERDICT.md` calls.
- `docs/research/`: the research behind the design.
- `docs/filings.md`: drafts of upstream issues found while validating the runner, none filed.
- `docs/design/`: the design for the UI mutation operators.
- `spikes/`: throwaway experiments behind that design.

## Options

Set these under `playwright` in the Stryker config. `packages/stryker-playwright-runner/src/options.ts` holds
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
- `outputDir` is a folder in a private temp directory, which `dispose` removes. A runner that Stryker
  killed first leaves that directory behind; the next runner to start removes it.
- `maxFailures` is 1, unless Stryker's `disableBail` is on. `disableBail` cannot clear a `maxFailures` that
  the Playwright config sets.
- In a mutant run, the per-test timeout is Stryker's timeout for the mutant less 5.6 s but at least 2 s,
  capped at the largest test timeout in the Playwright config. The dry run keeps the config's timeouts.
- A mutant run that is still going 2.6 s before Stryker's timeout is stopped, and the mutant is a Timeout
  unless a test already killed it. This catches a looping test that raised its own timeout, which
  outranks the per-test timeout. The dry run has no such stop.
- `retries` is 0 and `repeatEach` is 1. Playwright's `TestRunner.runTests` sets these two, not the runner.
  Retries set with `describe.configure({ retries })` still apply.

## UI mutation operators

StrykerJS mutates expressions and leaves JSX text and attribute strings alone, so a suite that finds
elements by role, label, and text gets few mutants it can kill. `@layzee/stryker-ui-mutators` adds ten
operators: `TextLiteral`, `LabelAttribute`, `EventHandler`, `ConditionalElement`, `UrlAttribute`,
`DisabledAttribute`, `HiddenAttribute`, `ElementRole`, `ChildExpression`, and `StateAttribute`.
`docs/design/playwright-mutators.md` says what each one changes and which shapes it skips. The operators
need StrykerJS 10.1, the version the plugin patches internals of.

Turn them on in one of two ways:

- List the plugin and its ignorer. Both lines are required: without `ignorers`, a failed install only
  prints a warning and the run goes on without UI mutants.

  ```ts
  plugins: ['@layzee/stryker-playwright-runner', '@layzee/stryker-ui-mutators'],
  ignorers: ['ui-mutators'],
  ```

- In a JavaScript or TypeScript config, import the plugin on the first line instead, and list nothing:

  ```ts
  import '@layzee/stryker-ui-mutators';
  ```

Either way, the install checks that each operator makes a mutant of a sample, and stops the run with
the names of those that do not. Exclude an operator by name with `mutator.excludedMutations`, or with a
`// Stryker disable` comment. Reports show each operator's name as the mutator name.

## Type-check and test the runner

Run these from the repo root. The tests start a browser, so install Chromium first.

```sh
npm install
npx playwright install chromium
npx nx run-many -t typecheck build
npx nx run @layzee/stryker-playwright-runner:test
```

`ui-mutators.test.ts` runs the runner against a page instrumented with the UI operators and checks that a
Playwright test kills each operator's mutant.

The UI operators' tests need no browser:

```sh
npx nx run @layzee/stryker-ui-mutators:test
```

To run Stryker on the demo app, use `npx nx run @layzee/demo-app-e2e:mutate-e2e`,
`npx nx run @layzee/demo-app-e2e:mutate-e2e-ui`, or `npx nx run @layzee/demo-app:mutate-ct`. Each target builds
both packages first, because Stryker loads them from their `dist` folders. `stryker.e2e.command.config.ts`
has no target: it loads neither package, so it needs no build, and it runs once per `STRYKER_BASELINE`
value. The Rerun section of
`docs/VERDICT.md` lists the commands for the measured rows, and `oss/README.md` gives the steps for the
open-source copies.
