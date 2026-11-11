# A test that passes on a retry passes, unless `failOnFlakyTests` is set

Playwright's `TestRunner.runTests` sets retries to 0, so the runner raises each test's retries again to its
project's `retries`, or to the `lzPlaywright.retries` option, when a run begins. A test that fails and then passes
on a retry passes, as in `npx playwright test`, so the mutant survives that test; with `failOnFlakyTests: true` in
the Playwright config it fails and kills the mutant. A test that fails without a mutant at fault would otherwise
count that mutant as detected, and the score would credit tests with a check they do not make. Lars approved this
default.

## Considered Options

- Count any failed attempt as a kill, which the runner did before. It never lets a flaky test hide a mutant, but it
  turns flakiness into kills. Set `failOnFlakyTests: true` to get that behaviour; the Wait and Clock mutators of
  `@layzee/stryker-playwright-mutators` need it.

## Consequences

- A mutant that only makes a test flaky survives under the default.
- Retries make killed mutants slower: each failing test runs once more per retry, and `timeoutMS` must cover it.
