# Keep this repository's own install package until it merges with lz-node-test

The sibling repository lz-node-test (the StrykerJS runner and mutators for `node:test`) has a package for the same
job as `@layzee/stryker-mutator-install`: putting mutators into Stryker's instrumenter and selecting them from
options. This repository does not depend on it. It keeps its own private install package, which every mutator
package here depends on. Lars ruled: "You may have your own mutator core package until your repo merges with
lz-node-test's repo."

## Considered Options

- Depend on lz-node-test's `@layzee/stryker-mutator-core`. It is unpublished and lives in another repository, and
  Lars ruled: "3: No dependency yet."
- Byte copies of the install code in each mutator package. Three copies would have to be kept in step, which the
  ruling above replaced with one package.

## Consequences

- Two install packages with the same option shape exist until the merge. A change to how mutators are selected or
  installed needs the same change in the other repository, or the merge has to reconcile them.
