# @layzee/stryker-mutator-install

The code that puts custom mutators into StrykerJS. It is not a mutator package and has no mutators of its own.
`@layzee/stryker-jsx-mutators` and `@layzee/stryker-playwright-mutators` use it. The package is private and is not
for direct use. Both mutator packages declare it as a regular dependency, so installing either one installs this
one.

StrykerJS has no public way to add a mutator to its instrumenter or to turn off a built-in one. This package
patches the installed `@stryker-mutator/instrumenter` in memory, and checks that the patch took effect.

## Exports

- `resolveInstrumenter`, `coreInstrument`, `corePackageJson`: find and load the instrumenter that
  `@stryker-mutator/core` uses.
- `resolveExpressionPlacer`: the instrumenter's expression placer, for a package that patches it. The
  other functions do not need the placer to exist.
- `fieldOf`, `isRecord`: read a field of a value of unknown shape, and test for an object.
- `register`, `markOf`: put mutators in its list, each marked as a `@layzee` mutator. A second call replaces the
  entries of the first from the same package, in place, and leaves the entries of other packages where they are.
- `checkNames`: throws on a mutator name that has other characters than letters, or that another package's mutator already has (compared without case).
- `selfCheck`: instruments one sample per mutator and throws when the instrumenter makes no mutant of it.
- `undoOnThrow`: runs an install's changes and the checks after them. When one of them throws, it gives each object
  it was handed, such as the mutator list or the expression placer, back the own properties it had before, and
  rethrows.
- `warnUntested`: warns when the instrumenter is not the version the calling package was tested with.
- `builtInNames`, `removeBuiltIns`: the 17 built-in mutators of Stryker, and the removal of them by name.
- `builtInSample`, `checkBuiltInsRemoved`: a source file in which each of the 17 makes a mutant, and the check that
  throws when the instrumenter still makes one of them after the removal.
- `selectMutators`: turns the options of a mutator package into the list of mutators to install. The options and
  an `experimental` object are plain objects, an object literal or an object without a prototype, and only their
  own keys count. An option holds only `true`. The function throws on any other value and on any unknown or
  misplaced name.
- Types: `Instrumenter`, `ListedMutator`, `MutatorList`, `MutatorOptions`, `MutatorSets`, `NamedMutator`,
  `SampledMutator`, and the types of the instrumenter's parts.

## Requirements

- `@stryker-mutator/core` 10.1, tested on 10.1.1. `warnUntested` warns when it finds another version.
- Node.js 22 or later.
