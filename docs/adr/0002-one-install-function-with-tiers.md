# One install function per mutator package, with opt-in and experimental tiers as options

Each mutator package exports one install function from its main entry, and its first argument turns on mutators
beyond the default tier: `extended: true` or `<name>: true` for opt-in mutators, `experimental: true` or
`experimental: { <name>: true }` for experimental ones. Every key takes only `true`, and the function throws on an
unknown name, a default mutator's name, or a name in the wrong tier. Turning a mutator off stays with Stryker's own
`mutator.excludedMutations`, so there is one way to turn a mutator off. Lars ruled, on where the Wait mutators go:
"No secondary entry point. Make them opt-in/"extended" mutators."

## Considered Options

- A subpath entry per group, such as `@layzee/stryker-playwright-mutators/wait` or `.../experimental`. It was
  approved for the Wait mutators first and then replaced by the ruling above, so the same rule holds for every
  mutator package, here and in the sibling Node mutator packages.
