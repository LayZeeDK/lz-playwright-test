# @layzee/stryker-ui-mutators

Mutation operators for the parts of JSX that Playwright tests look at. StrykerJS mutates expressions
and leaves JSX text and attribute strings alone, so a suite that finds elements by role, label, and text
gets few mutants it can kill. This plugin adds ten operators:

- `TextLiteral`: empties JSX text that has a letter or digit.
- `LabelAttribute`: empties `aria-label`, `aria-labelledby`, `alt`, `title`, `placeholder`, and `htmlFor`.
- `EventHandler`: sets an `onX` handler that is not inline to `undefined`.
- `ConditionalElement`: forces `x && <A/>` to render, and forces each branch of a JSX ternary.
- `UrlAttribute`: empties `href`, `to`, and `action`.
- `DisabledAttribute`: forces `disabled`, `readOnly`, and `aria-disabled` off.
- `HiddenAttribute`: forces `hidden` and `aria-hidden` off.
- `ElementRole`: removes `role`, or swaps a `button`, or an `a` that has an `href`, for a `span`.
- `ChildExpression`: replaces a `{value}` child with `null`.
- `StateAttribute`: flips `aria-expanded`, `aria-pressed`, `aria-checked`, and `aria-selected`.

The repository's `docs/design/playwright-mutators.md` says exactly what each operator changes and which
shapes it skips. Reports show each operator's name as the mutator name.

## Requirements

- `@stryker-mutator/core` 10.1, tested on 10.1.1. The plugin patches internals of that version's
  instrumenter, and warns when it finds another version.
- Node.js 22 or later, tested on 22.23.1 and 24.22.0.

The operators do not need a particular test runner. With `@layzee/stryker-playwright-runner`, a
Playwright test can kill each of them.

## Turn the operators on

Use one of two ways:

- List the plugin and its ignorer. Both lines are required: without `ignorers`, a failed install only
  prints a warning, and the run goes on without UI mutants.

  ```ts
  plugins: ['@layzee/stryker-playwright-runner', '@layzee/stryker-ui-mutators'],
  ignorers: ['ui-mutators'],
  ```

- In a JavaScript or TypeScript config, import the plugin on the first line instead, and list nothing:

  ```ts
  import '@layzee/stryker-ui-mutators';
  ```

Either way, the install checks that each operator makes a mutant of a sample. It stops the run with the
names of the operators that do not, and with the instrumenter's folder and version when an internal it
patches is missing.

## Turn an operator off

Exclude an operator by name with `mutator.excludedMutations`, or with a `// Stryker disable <name>`
comment on the code.

## License

MIT
