# @layzee/stryker-mutator-install

The code that puts custom mutators into StrykerJS. It is not a mutator package and has no mutators of its own.
`@layzee/stryker-jsx-mutators` uses it, and so will this repository's other mutator packages. The package is
private and is not for direct use. The JSX package declares it as a regular dependency, so installing that
package installs this one.

StrykerJS has no public way to add a mutator to its instrumenter or to turn off a built-in one. This package
patches the installed `@stryker-mutator/instrumenter` in memory, and checks that the patch took effect.

## Exports

- `resolveInstrumenter`, `coreInstrument`, `corePackageJson`: find and load the instrumenter that
  `@stryker-mutator/core` uses.
- `resolveExpressionPlacer`: the instrumenter's expression placer, for a package that patches it. The
  other functions do not need the placer to exist.
- `fieldOf`, `isRecord`: read a field of a value of unknown shape, and test for an object.
- `register`, `markOf`: add mutators to its list, each marked as a `@layzee` mutator.
- `checkNames`: throws on a mutator name that has other characters than letters, or that another package's mutator already has (compared without case).
- `selfCheck`: instruments one sample per mutator and throws when the instrumenter makes no mutant of it.
- `warnUntested`: warns when the instrumenter is not the version the calling package was tested with.
- `builtInNames`, `removeBuiltIns`: the 17 built-in mutators of Stryker, and the removal of them by name.
- `selectMutators`: turns the options of a mutator package into the list of mutators to install. An option
  holds only `true`. The function throws on any other value and on any unknown or misplaced name.
- Types: `Instrumenter`, `ListedMutator`, `MutatorList`, `MutatorOptions`, `MutatorSets`, `NamedMutator`,
  `SampledMutator`, and the types of the instrumenter's parts.

## Requirements

- `@stryker-mutator/core` 10.1, tested on 10.1.1. `warnUntested` warns when it finds another version.
- Node.js 22 or later.
