# Mutator packages patch Stryker's instrumenter, through an awaited install call

StrykerJS 10.1 has no plugin kind for mutators, and a plugin cannot turn a built-in mutator off (only the user's
`mutator.excludedMutations` can), so `@layzee/stryker-jsx-mutators` and `@layzee/stryker-playwright-mutators` install
their mutators by patching the installed `@stryker-mutator/instrumenter` in memory, through
`@layzee/stryker-mutator-install`. The patch touches
undocumented internals (the instrumenter's mutator list and expression placer), so the mutator packages peer on
`@stryker-mutator/core` `~10.1.0`, warn on any other instrumenter version, and check after every install that each
added mutator makes a mutant of a sample and that each removed built-in makes none. A failed check undoes the patch
and stops the run.

The install is a function the Stryker config awaits (`await lzJsxMutators()`), not a side effect of listing the
package in `plugins`. Stryker only warns when a module in `plugins` fails to load, so a broken install there would
let the run finish and report a score without the mutators.

## Considered Options

- Install when the package is imported or listed in `plugins`. This was the JSX mutators' first form; it was
  replaced by the install function because a failure could not stop the run.

## Consequences

- Each new Stryker minor version needs the internals checked again before the peer range can widen.
- The config file must be a JavaScript or TypeScript module; a JSON config cannot call the install function.
