# @layzee/lz-stryker-ui-mutators

Mutation operators for the parts of JSX that Playwright tests look at. StrykerJS mutates expressions
and leaves JSX text and attribute strings alone, so a suite that finds elements by role, label, and text
gets few mutants it can kill. This plugin adds ten operators:

- `LzTextLiteral`: empties JSX text that has a letter or digit.
- `LzLabelAttribute`: empties `aria-label`, `aria-labelledby`, `alt`, `title`, `placeholder`, and `htmlFor`.
- `LzEventHandler`: sets an `onX` handler that is not inline to `undefined`.
- `LzConditionalElement`: forces `x && <A/>` to render, and forces each branch of a JSX ternary.
- `LzUrlAttribute`: empties `href`, `to`, and `action`.
- `LzDisabledAttribute`: forces `disabled`, `readOnly`, and `aria-disabled` off.
- `LzHiddenAttribute`: forces `hidden` and `aria-hidden` off.
- `LzElementRole`: removes `role`, or swaps a `button`, or an `a` or `area` that has an `href`, for a
  `span`. It takes these roles from Playwright (see "The roles come from your Playwright").
- `LzChildExpression`: replaces a `{value}` child with `null`.
- `LzStateAttribute`: flips `aria-expanded`, `aria-pressed`, `aria-checked`, and `aria-selected`.

The repository's `docs/design/playwright-mutators.md` says exactly what each operator changes and which
shapes it skips. Reports show each operator's name as the mutator name.

## Requirements

- `@stryker-mutator/core` 10.1, tested on 10.1.1. The plugin patches internals of that version's
  instrumenter, and warns when it finds another version.
- Node.js 22 or later, tested on 22.23.1 and 24.22.0 on Windows 11 arm64, and on 24.22.1 on Linux arm64.
- Optional: `playwright-core` 1.63 or later, below 2. Any `@playwright/test` or `playwright` install
  brings it.

The operators do not need a particular test runner. With `@layzee/lz-stryker-playwright-runner`, a
Playwright test can kill each of them.

## The roles come from your Playwright

`LzElementRole` uses Playwright's table of implicit roles, the one `getByRole` uses, so the operator
treats an element the way your tests find it. The table decides which tags the span swap changes and
which `role` attributes restate a tag's own role and are left in place.

When the plugin loads, it reads the table from the `playwright-core` it resolves from its own folder.
`playwright-core` is an optional peer dependency, so your installed version is the one it finds.

- Without `playwright-core`, the plugin uses the table it bundles, and prints nothing.
- If `playwright-core` is installed but the plugin cannot read its table, the plugin prints one warning
  and uses the bundled table. A table that lacks the entry for `a`, `area` or `button` counts as
  unreadable, because the span swap needs them. The role skip uses whatever entries the table holds. The warning names the version and path
  it found (only the path of `package.json` when that file cannot be read), the reason, and the version
  of the bundled table:

  ```text
  lz-stryker-ui-mutators: cannot read the implicit role table of playwright-core 1.99.0 in <path> (Error: kImplicitRoleByTagName not found); LzElementRole uses the table bundled from playwright-core 1.64.1.
  ```

The bundled table is generated from `playwright-core` when the package is built, so each release carries
the table of the Playwright version it was built with. If that table cannot be read, or lacks one of those
entries, the build fails and names what is missing. The
package's tests parse the table of each Playwright minor version from 1.63 on.

In this repository, `node scripts/generate-roles.ts` writes `src/bundled-roles.ts`; the build runs it.
When a Playwright minor version ships, run `node tools/playwright-roles-matrix.ts` from the repository root.
It downloads that version's table into `test/fixture/roles/`, and the tests then fail if the parser cannot
read it.

## Turn the operators on

Use one of two ways:

- List the plugin and its ignorer. Both lines are required: without `ignorers`, a failed install only
  prints a warning, and the run goes on without UI mutants.

  ```ts
  plugins: ['@layzee/lz-stryker-playwright-runner', '@layzee/lz-stryker-ui-mutators'],
  ignorers: ['lz-stryker-ui-mutators'],
  ```

- In a JavaScript or TypeScript config, import the plugin on the first line instead, and list nothing:

  ```ts
  import '@layzee/lz-stryker-ui-mutators';
  ```

Either way, the install checks that each operator makes a mutant of a sample. It stops the run with the
names of the operators that do not, and with the instrumenter's folder and version when an internal it
patches is missing.

## Turn an operator off

Exclude an operator by name with `mutator.excludedMutations`, or with a `// Stryker disable <name>`
comment on the code.

## License

MIT
