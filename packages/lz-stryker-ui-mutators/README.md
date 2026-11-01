# @layzee/lz-stryker-ui-mutators

Mutators for the parts of JSX that Playwright tests look at. StrykerJS mutates expressions
and leaves JSX text and attribute strings alone, so a suite that finds elements by role, label, and text
gets few mutants it can kill. This plugin adds ten mutators:

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

The repository's `docs/design/playwright-mutators.md` says exactly what each mutator changes and which
shapes it skips. Stryker's reports show these names as the mutator of each mutant.

## Requirements

- `@stryker-mutator/core` 10.1, tested on 10.1.1. The plugin patches internals of that version's
  instrumenter, and warns when it finds another version.
- Node.js 22 or later, tested on 22.23.1 and 24.22.0 on Windows 11 arm64, and on 24.22.1 on Linux arm64.
- Optional: `playwright-core` 1.63 or later, below 2. With npm, any `@playwright/test` or `playwright`
  install brings it. With pnpm or Yarn Plug'n'Play, see "The roles come from your Playwright".
- React JSX or TSX. The mutators match React's attribute names, such as `htmlFor` and `readOnly`, so
  Solid, Preact or Vue JSX written with `for` or `readonly` gets no mutants on those attributes. Vue,
  Angular and Svelte templates get no UI mutants; JSX in a Vue `<script lang="tsx">` block does. The run
  prints nothing about the files it skips.

The mutators do not need a particular test runner. With `@layzee/lz-stryker-playwright-runner`, a
Playwright test can kill each of them.

## The roles come from your Playwright

`LzElementRole` uses Playwright's table of implicit roles, the one `getByRole` uses, so the mutator
treats an element the way your tests find it. The table decides which tags the span swap changes and
which `role` attributes restate a tag's own role and are left in place.

When the plugin loads, it reads the table from the `playwright-core` that Node.js resolves from the
plugin's own folder. `playwright-core` is an optional peer dependency. With npm, it is hoisted next to the
plugin, so the version your tests use is the one the plugin finds. pnpm and Yarn Plug'n'Play link an
optional peer only when your project depends on it, so the plugin can find another version or none. In
those setups, add `playwright-core` to your `devDependencies` at the version your `@playwright/test`
uses.

- Without `playwright-core`, the plugin uses the table it bundles, and prints nothing.
- If `playwright-core` is installed but the plugin cannot read its table, the plugin prints one warning
  and uses the bundled table. A table that lacks the entry for `a`, `area` or `button` counts as
  unreadable, because the span swap needs them. To decide which `role` attributes to leave in place, the
  mutator uses whatever entries the table holds. The warning names the version and path it found (only
  the path of `package.json` when that file cannot be read), the reason, and the version of the bundled
  table:

  ```text
  lz-stryker-ui-mutators: cannot read the implicit role table of playwright-core 1.99.0 in <path> (Error: kImplicitRoleByTagName not found); LzElementRole uses the table bundled from playwright-core 1.64.1.
  ```

The bundled table is generated from `playwright-core` when the package is built, so each release carries
the table of the Playwright version it was built with. If that table cannot be read, or lacks one of those
entries, the build fails and names what is missing. The
package's tests parse the table of each Playwright minor version from 1.63 on.

## Turn the mutators on

Use one of two ways:

- List the plugin and its ignorer. Both lines are required: without `ignorers`, a failed install only
  prints a warning, and the run goes on without UI mutants.

  ```ts
  appendPlugins: ['@layzee/lz-stryker-playwright-runner', '@layzee/lz-stryker-ui-mutators'],
  ignorers: ['lz-stryker-ui-mutators'],
  ```

  `appendPlugins` keeps the plugins Stryker loads by default. `plugins` replaces them, so a checker such
  as `@stryker-mutator/typescript-checker` no longer loads unless the list names it too.

- In a JavaScript or TypeScript config, import the plugin on the first line instead, and list nothing:

  ```ts
  import '@layzee/lz-stryker-ui-mutators';
  ```

Stryker finds its default plugins by listing the `@stryker-mutator` folder next to its own install, which
under pnpm or Yarn Plug'n'Play does not hold your checker. With either, name the checker in
`appendPlugins` whichever way you load this plugin, as in `'@stryker-mutator/typescript-checker'`.

Either way, the install checks that each mutator makes a mutant of a sample. It stops the run with the
names of the mutators that do not, and with the instrumenter's folder and version when an internal it
patches is missing.

## Turn a mutator off

For the whole project, list the mutator in `mutator.excludedMutations`. The names are case sensitive,
and Stryker does not check them, so `lzTextLiteral` excludes nothing and logs nothing.

For one mutant, use a Stryker disable comment with a reason. StrykerJS reads such a comment only where
Babel attaches it to the code that follows, so in JSX only these forms work:

- An attribute: a line comment inside the opening tag, on the line before the attribute.

  ```tsx
  <input
    // Stryker disable next-line LzLabelAttribute: the visible label names this field
    aria-label="Search"
  />
  ```

- An element that fits on one line: a line comment in a `{ }` container before it.

  ```tsx
  <header>
    {
      // Stryker disable next-line LzTextLiteral: a decorative heading
      <h1>Welcome</h1>
    }
  </header>
  ```

- Anything else: `// Stryker disable <name>: <reason>` on the line before the statement that holds the
  JSX, and `// Stryker restore <name>` on the line before the next statement or declaration. A restore
  after the last statement of a block is never read, so the disable then runs to the end of the file.

A JSX comment, `{/* Stryker disable ... */}`, is never read, and Stryker logs nothing about it. A
`next-line` comment before a multi-line element covers only that element's first line.

A comment or exclusion names a mutator, not one of its mutations, so it turns off both branches of an
`LzConditionalElement` ternary, and both the `role` removal and the span swap of `LzElementRole`.

## Survivors to expect

The mutators skip the mutants that are cheap to detect as changing nothing a test can see. These
remain:

- An `LzEventHandler` mutant can behave like StrykerJS's own `BlockStatement` mutant, which empties the
  handler's body. They differ only when the handler is shared or a parent handler relies on the event
  bubbling.
- An `LzConditionalElement` mutant on an empty list renders an empty list element, which Playwright
  reports as hidden. `toBeHidden` does not kill it; `toHaveCount(0)` on the items does.

With `@stryker-mutator/typescript-checker` and `strictNullChecks` on, an `LzEventHandler` mutant on a
component prop that the component's type requires, such as `onClick: () => void`, fails to compile.
Stryker reports it as a CompileError and leaves it out of the score, so no test runs against it. The
mutator cannot see prop types. A disable comment on that attribute turns the mutant into an Ignored one,
which the report still lists and the score also leaves out.

## Develop this package

The build runs `node scripts/generate-roles.ts`, which writes `src/bundled-roles.ts`. When a Playwright
minor version ships, run `node scripts/playwright-roles-matrix.ts` from the package folder. It saves that
version's table in `test/fixture/roles/`, and the tests fail if the parser cannot read it.

## License

MIT
