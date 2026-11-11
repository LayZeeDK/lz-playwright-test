# Host Playwright's internal TestRunner in the Stryker worker

The runner loads Playwright's `TestRunner` from the undocumented `playwright/lib/runner` and keeps it in the Stryker
test runner process. Global setup and the `webServer` start once per process, and each dry run or mutant run calls
`runTests({ testIds })`, so tests are selected by Playwright's own stable test ids and per-test coverage is
possible. Playwright's CLI selects tests only by file, title or a `--test-list` of title paths, not by test id,
and a CLI run per mutant would start the `webServer` per mutant. The price is a dependency on Playwright internals
that any release can change: the peer range is `@playwright/test >=1.63.0 <2`, and the runner checks the internals
it calls at startup and fails with an error that names what changed, instead of reporting survivors.

Playwright 1.63 is the floor because it removed the `@playwright/experimental-ct-*` packages: component tests are
plain `@playwright/test` tests that call the built-in `mount()` fixture, so one code path runs e2e and component
tests, with no component-specific branch and no support for the experimental component-test packages.

## Considered Options

- Stryker's `command` runner, with the active mutant passed in a Vite `define` and the dev server restarted per
  mutant, or the component bundle rebuilt per mutant. Both exist in other projects. Neither has coverage analysis,
  so every mutant runs every test, and each mutant pays for a restart or a rebuild.
