# The mock reset plugin resets module mock spies in every run, not only Stryker's

`sb.mock` spies live in one registry for the whole Vitest run, and Storybook's default mock reset only clears them,
so a stub one story sets is still there when a later story renders. A story that relies on that leak passes in a
full run and fails when it runs alone, which is what Stryker does for a mutant only that story covers: Stryker then
reports the mutant Killed whatever it changes. Lars ruled that a plugin injects the reset ("Sure it does, if they
don't know that it's an issue at all or how to fix it."), and left whether it applies only under Stryker to the
probe result. `lzStorybookMockResetPlugin()` adds a Vitest setup module that resets every spy in the registry before
each test, and it does so in every run of the Vitest config, Stryker's or not.

## Considered Options

- Reset only when `STRYKER_MUTATOR_WORKER` is set. Rejected: the story that relies on the leak would pass in CI and
  fail in Stryker's dry run, which reads as a Stryker problem; in every run it fails where the user writes tests.
- Leave the reset to the user's preview (`beforeEach(() => resetAllMocks())`). Rejected by the ruling above: users
  who do not know about the leak never add it.

## Consequences

- Adding the plugin can turn a passing story red in the user's own runs, when that story relied on a module mock
  leak, so the package README has to name that risk.
- Only module mock spies are reset; spies a story makes with `fn()` keep Storybook's own reset settings.
- The plugin needs Storybook 10.3.0 or later, where the registry exists; with an older Storybook it resets nothing.
- In Stryker's sandbox the setup module loads through the linked `node_modules`, so it needs the sandbox plugin there.
