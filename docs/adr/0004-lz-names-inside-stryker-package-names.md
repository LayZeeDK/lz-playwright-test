# Packages are named `@layzee/stryker-*`; the names Stryker reads carry the `lz` prefix

Package names follow StrykerJS's convention, `@layzee/stryker-<target>[-<kind>]`, while every name a Stryker config
or report shows carries an `lz` prefix: the test runner `lz-playwright` and its options key `lzPlaywright`, the
`LzPlaywright*` and `LzJsx*` mutators, and ignorers such as `lz-jsx-styling` and `lz-storybook-csf`. The runner's
environment variables start with `LZ_STRYKER_PLAYWRIGHT_`. Lars ruled: "I want to follow conventions but add an
`Lz`, `lz` or `lz-` prefix where supported, followed by a `Playwright` infix (or suffix when the LZ suffix isn't
possible)." A package with no Stryker peer, such as `@layzee/storybook-mock-transformer`, has no `stryker-` in its
name.

In StrykerJS 10.1.1, `mutator.excludedMutations` matches a mutator by its exact name and `// Stryker disable`
comments by its name without case, whichever package added the mutator, and `checkNames` in
`@layzee/stryker-mutator-install` refuses a name that another package's mutator already has. A prefixed name cannot
meet a built-in or another plugin's name there.

## Considered Options

- `@layzee/lz-<name>` package names, which the packages had before. `stryker init` shows a plugin package by the text
  before the first `-` after it strips `@stryker-mutator/` and `stryker-` (`getName` in
  `packages/core/src/initializer/npm-client.ts`, StrykerJS 10.1.1), so it lists every `@layzee/lz-*` package as
  `@layzee/lz`.
