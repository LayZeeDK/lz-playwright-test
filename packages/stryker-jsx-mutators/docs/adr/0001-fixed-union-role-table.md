# `LzJsxElementRole` reads a fixed union of implicit-role tables

`LzJsxElementRole` keeps a `role` attribute that restates a tag's implicit role, and reads those roles from a
table in the package, not from the consumer's installed Playwright. The table is the union of Playwright 1.64.1's
roles and Testing Library 10.4.0's (aria-query 5.3.0): a tag is in it when any engine gives it that role by tag
alone. The mutators do not depend on one test runner, so the table serves every engine; a `role` that one engine
treats as redundant would make a mutant that engine's tests can never kill. Lars ruled, in turn: "Yes, make it
general as recommended and add tests with the other supported (1st-party) StrykerJS test runners.", "Yes, keep svg
and search.", and, for the union over the intersection, "Role table: Approve recommendation."

## Considered Options

- Read the roles from the consumer's `playwright-core`. Tuned to Playwright, but the mutators run under every
  StrykerJS test runner, and the other engines' tests would then meet unkillable mutants.
- The intersection of the engines' tables. It drops `svg` and `search`, which only Playwright gives a role, so
  `<svg role="img">` would get a removal mutant that no Playwright test can kill.
