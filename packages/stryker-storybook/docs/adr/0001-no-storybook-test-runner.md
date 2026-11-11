# No Storybook test runner plugin; stories run under Stryker's Vitest runner

`@layzee/stryker-storybook` adds two ignorers (`lz-storybook-csf` and `lz-storybook`) and the `lz-storybook`
reporter, and no test runner. Story tests run through Storybook's Vitest addon under Stryker's own
`@stryker-mutator/vitest-runner`, which already runs browser-mode stories. Lars ruled: "We should not have a
test-runner plugin that wraps `@stryker-mutator/vitest-runner`, unless we need to create a Storybook- or
vitest-addon-specific one."

## Considered Options

- A runner plugin that wraps `@stryker-mutator/vitest-runner` to add Storybook setup. Rejected by the ruling:
  a runner plugin earns its place only when Storybook or its Vitest addon needs behaviour that Stryker's runner
  lacks, and none has come up.
