# Mutating the runner's hooks

Can Stryker mutate the code that this runner loads into the processes it tests, as `@layzee/stryker-node-test-runner`
does for its own hook? Short answer: yes, once the hooks' tests install the hooks under test on a global of their
own. The spike at the end of this note measured it, and the runner's Stryker config now mutates all of `src`. The
sections before the spike describe the state that led to it.

## How lz-node-test mutates its hook

Read from `LayZeeDK/lz-node-test` at its main branch, 2026-11-10.

- The runner package's config mutates all of `src/**/*.ts`, the hook included
  (`packages/stryker-node-test-runner/stryker.config.mjs`), and runs every test file, unit and integration, with its
  own runner.
- The hook is split in two. `src/hook-core.ts` exports `install(deps)`, which takes everything it touches from
  `deps`: the environment, the pid, timers, and the global object (`HookDependencies['global']`). `src/hook.ts` is the
  entry that `--import` loads; it passes the real process and `globalThis`.
- The unit tests call `install` with a plain object as `global` (`test/hook-core.fixtures.ts`), so the hook under test
  never touches the namespace that Stryker's instrumented code uses in the test process.
- The hook only adds fields to Stryker's namespace object (`deps.global.__stryker__ ??= {}`, then `hitLimit` and
  `hitCount`). It never replaces the namespace or puts an accessor on it. So the integration tests can install it on
  the real `globalThis` (`test/integration/hook.test.ts`), and an instrumented copy of the hook still reads and writes
  the same plain object as every other instrumented module.
- `install` does nothing unless the runner's output folder is in the environment, so importing the hook in a test
  installs nothing.
- The runner puts its own hook first in each test file's `NODE_OPTIONS`, so a copy of the runner that a test starts
  takes precedence over the runner running it (`src/runner.ts`, `testEnv`).

## Why this runner's hooks differ

- `server-hook.ts` and `worker-hook.ts` install when imported, behind an environment check and a `Symbol.for` guard,
  as lz-node-test's hook does.
- Unlike lz-node-test's hook, they replace the namespace: `installServerHook` defines `globalThis.__stryker__` as an
  accessor, so it can switch the active mutant per request and count hits made while a module starts as static. In
  the Playwright worker, the worker hook puts accessors on the namespace's `activeMutant`, `hitCount` and
  `currentTestId` fields; the script it adds to each page does the same for `activeMutant`.
- An instrumented copy of that code reads `__stryker__` through the accessor it defines. A probe on an instrumented
  copy of the package, measured 2026-11-10 without Stryker, showed two failures:
  - The `activeMutant` getter in `namespace.ts` called Stryker's `isActive`, which read `activeMutant` again, until
    the stack overflowed.
  - With that getter left uninstrumented, 25 server-hook tests that pass uninstrumented failed. The instrumented hook
    marked its own process instrumented and recorded coverage of its own mutants.
- `page-helpers.ts` reaches the page as source text through `addInitScript`. Instrumented, that text would call a
  namespace the page does not have.

## Does lz-node-test's way apply here?

Only in part.

- The injected global would let unit tests run the namespace logic against a plain object. The hooks already take
  the namespace name as a parameter (`ns`), so tests could install the hook under test on a name other than
  `__stryker__`. Stryker's own instrumentation in the test process would then keep its namespace, as in lz-node-test.
  This is inferred and not measured: no Stryker run has mutated a hook installed under another name.
- The accessor stays. Per-request switching and the static-hit count need it, so an instrumented hook running on the
  real namespace still reads through itself. Tests that start real Playwright workers and servers on the default
  namespace would still fail, as the probe showed.
- `page-helpers.ts` stays excluded either way.

## Recommendation

Keep the nine files excluded. To mutate the hooks later, first build a small spike:

1. Let the server and worker hook tests choose the namespace name, for example through the hook's environment.
2. Mutate `server-hook.ts` alone under Stryker.
3. Check that the 25 server-hook tests still pass, and that no coverage comes from the hook's own mutants.

That spike would cost about half a day of test changes plus one Stryker slot. It is worth doing only when the hooks
change often enough that unit tests alone stop catching regressions.

## Spike result, 2026-11-10

The hooks did change that often. From 2026-10-24 to 2026-11-10 the nine files held 41% of the runner's source lines, and took 51% of its
commits and 52% of its fix commits.

What changed:

- Both hooks take the global's name from `LZ_STRYKER_PLAYWRIGHT_HOOK_TEST_NAMESPACE` when they install on import,
  and keep `__stryker__` when it is unset or empty. The runner never sets it.
- The hooks' tests set it to `__stryker_hook_test__`, and instrument their test app onto that name, with its own
  active-mutant variable `__STRYKER_HOOK_TEST_ACTIVE_MUTANT__`.
- The tests' servers exit when their stdin ends instead of being killed. On Windows a kill runs no exit listener, so
  the lz-node-test hook in a server lost the coverage it writes on exit: before, 3 of 31 server processes in
  `server-hook.test.ts` left a record; after, 31 of 31.
- The coverage assertions compare exact mutant ids, so a hook's own mutants showing up as the app's fails a test.

Measured on copies of the package with files replaced by `@stryker-mutator/instrumenter` 10.1.1 output, without
Stryker:

- Before the change, with `server-hook.ts` instrumented: `server-hook.test.ts` 29 of 29 fail
  (`Maximum call stack size exceeded`).
- After it, with `server-hook.ts` instrumented: `server-hook.test.ts` 29 of 29 pass,
  `server-hook-self-requests.test.ts` 26 of 26.
- Positive control, `__STRYKER_ACTIVE_MUTANT__` set to one of the hook's mutants: 2 tests fail, so the variable
  reaches the hook under test.
- After it, with all nine files instrumented (`page-helpers.ts` included): 611 of 611 pass.

`page-helpers.ts` needed no exclusion: it runs only in the runner's main process, and none of its own code reaches the
page. The earlier reason for leaving it out was wrong. The code that does reach the page as source text is in
`worker-hook.ts`: `initPage`, which `addInitScript` hands to each page, and the callback that reads the page's
global. It is mutated safely only while no test in the Stryker run opens a real page; the browser tests are a
separate target.
