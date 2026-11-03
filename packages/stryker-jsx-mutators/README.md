# @layzee/stryker-jsx-mutators

Mutators for the parts of JSX that Playwright tests look at. StrykerJS mutates expressions
and leaves JSX text and attribute strings alone, so a suite that finds elements by role, label, and text
gets few mutants it can kill. This plugin adds ten mutators:

- `LzJsxTextLiteral`: empties JSX text that has a letter or digit.
- `LzJsxLabelAttribute`: empties `aria-label`, `aria-labelledby`, `alt`, `title`, `placeholder`, and `htmlFor`.
- `LzJsxEventHandler`: sets an `onX` handler that is not inline to `undefined`.
- `LzJsxConditionalElement`: forces `x && <A/>` to render, and forces each branch of a JSX ternary.
- `LzJsxUrlAttribute`: empties `href`, `to`, and `action`.
- `LzJsxDisabledAttribute`: forces `disabled`, `readOnly`, and `aria-disabled` off.
- `LzJsxHiddenAttribute`: forces `hidden` and `aria-hidden` off.
- `LzJsxElementRole`: removes `role`, or swaps a `button`, or an `a` or `area` that has an `href`, for a
  `span`. It keeps a `role` that restates the tag's implicit role (see "Implicit roles").
- `LzJsxChildExpression`: replaces a `{value}` child with `null`.
- `LzJsxStateAttribute`: flips `aria-expanded`, `aria-pressed`, `aria-checked`, and `aria-selected`.

The [design document](https://github.com/LayZeeDK/lz-playwright-test/blob/main/docs/design/playwright-mutators.md)
says exactly what each mutator changes and which shapes it skips. Stryker's reports show these names as the mutator of each mutant.

## Requirements

- `@stryker-mutator/core` 10.1, tested on 10.1.1. The plugin patches internals of that version's
  instrumenter, and warns when it finds another version.
- Node.js 22 or later, tested on 22.23.1 and 24.22.0 on Windows 11 arm64, and on 24.22.1 on Linux arm64.
- React JSX or TSX. The mutators match React's attribute names, such as `htmlFor` and `readOnly`, so
  Solid, Preact or Vue JSX written with `for` or `readonly` gets no mutants on those attributes. Vue,
  Angular and Svelte templates get no UI mutants; JSX in a Vue `<script lang="tsx">` block does. The run
  prints nothing about the files it skips.

The mutators do not need a particular test runner. With `@layzee/stryker-playwright-runner`, a
Playwright test can kill each of them.

## Implicit roles

`LzJsxElementRole` reads a fixed table of implicit roles: the tags that have a role by tag alone, or by
tag and `href` for `a` and `area`. The table decides which tags the span swap changes (`button`, and `a`
and `area` with an `href`) and which `role` attributes restate a tag's own role and are left in place.

The table holds a tag when any test engine gives it that role, so removing a restating `role` never makes
a mutant that some engine cannot see. It is Playwright 1.64.1's table. Testing Library 10.4.2 agrees on
every tag except two that only Playwright gives a role: `svg` (`img`) and `search` (`search`). So with
Testing Library, `<svg role="img">` keeps its `role`, and a test that finds it by that role does not get
a mutant for it.

## Turn the mutators on

Use one of two ways:

- List the plugin and its ignorer. Both lines are required: without `ignorers`, a failed install only
  prints a warning, and the run goes on without UI mutants.

  ```ts
  appendPlugins: ['@layzee/stryker-playwright-runner', '@layzee/stryker-jsx-mutators'],
  ignorers: ['lz-jsx'],
  ```

  `appendPlugins` keeps the plugins Stryker loads by default. `plugins` replaces them, so a checker such
  as `@stryker-mutator/typescript-checker` no longer loads unless the list names it too.

- In a JavaScript or TypeScript config, import the plugin on the first line instead, and list nothing:

  ```ts
  import '@layzee/stryker-jsx-mutators';
  ```

Stryker finds its default plugins by listing the `@stryker-mutator` folder next to its own install, which
under pnpm or Yarn Plug'n'Play does not hold your checker. With either, name the checker in
`appendPlugins` whichever way you load this plugin, as in `'@stryker-mutator/typescript-checker'`.

Either way, the install checks that each mutator makes a mutant of a sample. It stops the run with the
names of the mutators that do not, and with the instrumenter's folder and version when an internal it
patches is missing.

## Turn a mutator off

For the whole project, list the mutator in `mutator.excludedMutations`. The names are case sensitive,
and Stryker does not check them, so `lzJsxTextLiteral` excludes nothing and logs nothing.

For one mutant, use a Stryker disable comment with a reason. StrykerJS reads such a comment only where
Babel attaches it to the code that follows, so in JSX only these forms work:

- An attribute: a line comment inside the opening tag, on the line before the attribute.

  ```tsx
  <input
    // Stryker disable next-line LzJsxLabelAttribute: the visible label names this field
    aria-label="Search"
  />
  ```

- An element that fits on one line: a line comment in a `{ }` container before it.

  ```tsx
  <header>
    {
      // Stryker disable next-line LzJsxTextLiteral: a decorative heading
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
`LzJsxConditionalElement` ternary, and both the `role` removal and the span swap of `LzJsxElementRole`.

## Survivors to expect

The mutators skip the mutants that are cheap to detect as changing nothing a test can see. These
remain:

- An `LzJsxEventHandler` mutant can behave like StrykerJS's own `BlockStatement` mutant, which empties the
  handler's body. They differ only when the handler is shared or a parent handler relies on the event
  bubbling.
- An `LzJsxConditionalElement` mutant on an empty list renders an empty list element, which Playwright
  reports as hidden. `toBeHidden` does not kill it; `toHaveCount(0)` on the items does.

With `@stryker-mutator/typescript-checker` and `strictNullChecks` on, an `LzJsxEventHandler` mutant on a
component prop that the component's type requires, such as `onClick: () => void`, fails to compile.
Stryker reports it as a CompileError and leaves it out of the score, so no test runs against it. The
mutator cannot see prop types. A disable comment on that attribute turns the mutant into an Ignored one,
which the report still lists and the score also leaves out.

## Develop this package

`test/implicit-roles.test.ts` checks the role table in `src/implicit-roles.ts` against the installed
`playwright-core` and `aria-query` (the version Testing Library pins). When either is upgraded and the
test fails, update the table to match.

## License

MIT
