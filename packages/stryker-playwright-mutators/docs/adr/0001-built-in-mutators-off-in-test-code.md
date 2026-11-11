# Stryker's 17 built-in mutators are off in Playwright test code

This package mutates test code, which StrykerJS's docs and maintainers advise against, so it decides each built-in
mutator for test code on its own instead of keeping Stryker's set. Lars ruled: "StrykerJS' built-in mutators are
intentionally not meant to mutate test code as per Nico Jansen and other maintainers. Disbaling them for Playwright
test code is a valid default." and then asked for the analysis to decide "which is useful when mutating Playwright
test code (e2e server/browser, component, API server/client) on its own, which is better replaced by one of our
mutators, and which should be disabled/replaced for Playwright test code." Measured on e2e, component and API
suites, none of the 17 stays on: each one's mutants survive by construction (an emptied test body or title), only
loosen a locator, or die whenever their line runs and so show nothing about what a test checks, or the mutator had
no sites in spec files. The README lists the reason and the replacement for each one.

The install removes the built-ins for every file in the run, so test code gets a Stryker config of its own, and
app code is mutated in another.

## Considered Options

- Remove only the built-ins measured as harmful first, `BlockStatement`, `ArrowFunction` and `CallExpression`, and
  keep the other 14. The per-mutator analysis found no keeper among those 14 either.
- Keep Stryker's defaults in test code. Emptied titles and test bodies survived 10 of 10 times, so the score would
  count noise.
