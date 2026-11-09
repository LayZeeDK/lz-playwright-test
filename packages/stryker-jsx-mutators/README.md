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

The [design document](https://github.com/LayZeeDK/lz-playwright-test/blob/main/docs/design/jsx-mutators.md)
says exactly what each mutator changes and which shapes it skips. Stryker's reports show these names as the mutator of each mutant.

## Requirements

- `@stryker-mutator/core` 10.1, tested on 10.1.1. The plugin patches internals of that version's
  instrumenter, and warns when it finds another version.
- Node.js 22 or later, tested on 22.23.1 and 24.22.0 on Windows 11 arm64, and on 24.22.1 on Linux arm64.
- React JSX or TSX. The mutators match React's attribute names, such as `htmlFor` and `readOnly`, so
  Solid, Preact or Vue JSX written with `for` or `readonly` gets no mutants on those attributes. Vue,
  Angular and Svelte templates get no JSX mutants; JSX in a Vue `<script lang="tsx">` block does. The run
  prints nothing about the files it skips.

The mutators do not need a particular test runner. With `@layzee/stryker-playwright-runner`, a
Playwright test can kill each of them.

## Implicit roles

`LzJsxElementRole` reads a fixed table of implicit roles: the tags that have a role by tag alone, or by
tag and `href` for `a` and `area`. The table decides which tags the span swap changes (`button`, and `a`
and `area` with an `href`) and which `role` attributes restate a tag's own role and are left in place.

The table holds a tag when any test engine gives it that role by tag alone, so a `role` that restates
such a role keeps its place even where only one engine would see it go. It joins two tables:

- Playwright 1.64.1's, which alone gives `svg` (`img`) and `search` (`search`) a role.
- Testing Library 10.4.0's, from aria-query 5.3.0, which ignores aria-query's context rules and so gives
  `address` (`group`), `footer` (`contentinfo`), `header` (`banner`), `td` (`cell`) and `th`
  (`columnheader`) their role anywhere. Playwright gives `address` no role, and the others only in some
  places, such as a `header` that is not inside a `section`.

A role that comes from other attributes, such as `checkbox` on `<input type="checkbox">`, is not in the
table, so removing a restating one still gives a mutant, even though no engine can tell it apart.

So `<svg role="img">` and `<footer role="contentinfo">` keep their `role`, and get no removal mutant.
The `generic` role is left out: Playwright gives it to no tag, and a `role="generic"` is rare.

## Turn the mutators on

Call `lzJsxMutators` at the top of your Stryker configuration file. It adds the mutators to Stryker's own:

```ts
import { lzJsxMutators } from '@layzee/stryker-jsx-mutators';

await lzJsxMutators();

export default {
  appendPlugins: ['@layzee/stryker-playwright-runner'],
  testRunner: 'lz-playwright',
};
```

Call it in the configuration file, not through `plugins`. Stryker only warns when a module in `plugins` fails to
load, while a failed call stops the run. The configuration file must be a JavaScript or TypeScript ES module, such
as `stryker.config.mjs`, as a JSON configuration cannot import a module.

The package has no opt-in or experimental mutators yet, so `lzJsxMutators` takes no options. It throws when it
gets any. Turn a mutator off with `mutator.excludedMutations`, as below.

The call checks that each mutator makes a mutant of a sample. It stops the run with the names of the
mutators that do not, and with the instrumenter's folder and version when an internal it patches is
missing. It also stops the run when another mutator already has one of these mutators' names.

## Hide styling mutants with lz-jsx-styling

StrykerJS mutates class name and inline style expressions. A DOM test rarely sees those changes, so
their mutants survive and lower the score. The opt-in `lz-jsx-styling` ignorer reports them as Ignored,
with a reason. Ignored mutants stay in the report and are left out of the score.

It hides every mutant inside:

- A `className`, `class`, or `*ClassName` attribute with a `{...}` value, such as
  `className={cn('p-2', active && 'bg-accent')}` or a `NavLink` callback. Reason: "lz-jsx-styling: class
  names only style the element; DOM tests do not observe them".
- A call to `cn`, `clsx`, `classnames`, `classNames`, `cx`, `twMerge`, `cva`, or `tv` outside such an
  attribute. Reason: "lz-jsx-styling: class-name builder call; DOM tests do not observe class names".
- A variable whose name ends in `ClassName` or `Classes` and whose value is a string, a template or an
  object literal, such as `const sizeClasses = { sm: 'h-4', lg: 'h-8' }`. Reason: the same as for a class attribute.
- A `style` attribute with an object literal value, such as `style={{ color: on ? 'red' : 'blue' }}`.
  Reason: "lz-jsx-styling: inline styles only style the element; DOM tests do not observe them".

Static strings, such as `className="p-2"`, have no mutants to hide: StrykerJS skips them.

### Classes that hide an element

A class can hide an element, and Playwright's `toBeVisible` sees that. So the ignorer keeps the mutants of
a class attribute, call or variable when one of its strings, template parts or object keys holds one of
these classes:

`hidden`, `invisible`, `collapse`, `sr-only`, `not-sr-only`, `d-none`, `visually-hidden`, `is-hidden`.

It matches whole class names, split on whitespace. A class with variants matches by its last part, so
`md:hidden` and `peer-invalid:hidden` match. `overflow-hidden` and `hiddenish` do not.

Add your project's own hiding classes with `lzJsxStyling.visibilityClasses`. They add to the list above;
they do not replace it.

### Paint-only style keys

The ignorer hides the mutants of a `style` object literal only when every key is one of these paint-only
keys, in camelCase or kebab-case, quoted or not: `color`, `background`, `backgroundColor`,
`backgroundImage`, `borderColor`, `borderTopColor`, `borderRightColor`, `borderBottomColor`,
`borderLeftColor`, `borderRadius`, `outlineColor`, `boxShadow`, `textShadow`, `textDecorationColor`,
`accentColor`, `caretColor`, `cursor`, `fill`, `stroke`.

It keeps the mutants of a `style` value in every other case:

- It is not an object literal, such as `style={styles.card}`.
- It has a spread (`...base`) or a computed key (`[name]: value`).
- It has any other key, such as `width`, `padding`, `border`, `display` or `fontSize`.

Any key that can change an element's size, position or visibility can change what a test observes.
Playwright reads the box for `toBeVisible`, `toBeInViewport` and clicks, and an app can measure its own
elements. In react-virtuoso's e2e suite, a mutant that removed a list item's `border` or a list's `padding`
changed which items rendered, and a test caught it.

### Turn it on

List the plugin in `appendPlugins` or `plugins`, then the ignorer. The `lzJsxMutators` call does not give
Stryker the ignorer or the option's schema.

```ts
appendPlugins: ['@layzee/stryker-playwright-runner', '@layzee/stryker-jsx-mutators'],
ignorers: ['lz-jsx-styling'],
lzJsxStyling: {
  visibilityClasses: ['closed', 'is-collapsed'],
},
```

The ignorer does not need the JSX mutators: it also hides StrykerJS's own class name and style mutants.
Listing the plugin does not turn the JSX mutators on; only the `lzJsxMutators` call does.

`appendPlugins` keeps the plugins Stryker loads by default. `plugins` replaces them, so a checker such as
`@stryker-mutator/typescript-checker` does not load unless the list names it too. Stryker finds its
default plugins by listing the `@stryker-mutator` folder next to its own install, which under pnpm or Yarn
Plug'n'Play does not hold your checker. With either, name the checker in `appendPlugins`, as in
`'@stryker-mutator/typescript-checker'`.

`visibilityClasses` must be an array of class names without whitespace. Stryker checks it against the
schema the plugin exports, and the ignorer throws when it is created with any other value.

### When to leave it out

Leave `lz-jsx-styling` out when your tests assert classes or styles, with `toHaveClass`, `toHaveCSS` or
`toHaveStyle`. Those tests can kill the mutants it hides. A `// Stryker restore` comment does not bring
them back; only leaving the ignorer out does.

Leave it out, or add the class to `visibilityClasses`, when your own CSS hides an element through a class
the list above does not name.

## Hide telemetry mutants with lz-telemetry

Analytics and error-monitoring calls send data that a DOM test does not see, so the mutants in their
arguments survive. The opt-in `lz-telemetry` ignorer reports them as Ignored, with a reason.

It hides every mutant of a statement that is just a call to one of these callees:

- Analytics: `gtag`, `window.gtag`, `fbq`, `ttq.track`, `dataLayer.push`, `window.dataLayer.push`,
  `analytics.track`, `analytics.page`, `analytics.identify`, `analytics.group`, `analytics.alias`,
  `analytics.screen`, `posthog.capture`, `posthog.identify`, `posthog.group`, `posthog.alias`,
  `posthog.register`, `posthog.reset`, `mixpanel.track`, `mixpanel.identify`, `mixpanel.register`,
  `mixpanel.people.set`, `plausible`, `window.plausible`, `umami.track`, `amplitude.track`,
  `amplitude.logEvent`, and `amplitude.identify`. Reason: "lz-telemetry: analytics call; DOM tests do not
  observe what it sends".
- Error monitoring: `Sentry.captureException`, `Sentry.captureMessage`, `Sentry.addBreadcrumb`,
  `Sentry.setUser`, `Sentry.setTag`, `Sentry.setTags`, `Sentry.setContext`, `Sentry.setExtra`, and
  `Sentry.flush`. A bare `captureException` or `captureMessage` counts when the name, where it is called,
  refers to an import under that name from a `@sentry/` package; a parameter or local of the same name does
  not count. Reason: "lz-telemetry: error-monitoring call; DOM tests do not observe what it reports".

The ignorer matches a callee by its name only, so an app's own object named `analytics` or `posthog` counts
too.

The statement can be an optional call, such as `window.gtag?.('event', name)`, and can sit under `await` or
`void`, such as `await Sentry.flush(2000)`. An optional call's own mutant, the one that removes the `?.`, is
hidden with the rest of the statement, though a test that runs without the library loaded could kill it. The
same holds for a `?.` inside an argument, such as `user?.id` in `analytics.track('Bought', { id: user?.id })`:
its mutant throws when `user` is undefined, but the ignorer hides it with the statement.

The ignorer keeps the mutants in every other case:

- An argument holds code that can act on the page: a function (arrow, function expression, object or class
  method), a call, a dynamic `import()`, `new`, a tagged template, a decorator, an assignment, an update such
  as `count++`, `await`, `yield`, `delete`, and in `.js` and `.jsx` files a `throw` expression or a pipeline
  (`|>`). For example, the callback in `analytics.track('Clicked', {}, {}, () => navigate('/done'))` or the
  `eventCallback` in `dataLayer.push({ event: 'buy', eventCallback: () => setDone(true) })` runs in the page,
  and a DOM test can see what it does.
- The call is not a statement of its own, such as the body of `onClick={() => gtag('event', 'buy')}`.
- The code uses the call's result, such as `const id = analytics.track('signup')` or `return gtag(...)`.
- The callee is computed, such as `analytics['track'](...)`, or longer than the listed name, such as
  `lib.analytics.track(...)`.
- The callee is `Sentry.init`. Its options, such as `beforeSend`, decide what the app reports, and a unit
  test can check them.

Add your project's own callees with `lzTelemetry.calls`. They add to the lists above. Reason:
"lz-telemetry: telemetry call from lzTelemetry.calls; DOM tests do not observe what it sends". When
`calls` repeats a built-in callee, such as `gtag`, the statement keeps the built-in reason.

```ts
appendPlugins: ['@layzee/stryker-playwright-runner', '@layzee/stryker-jsx-mutators'],
ignorers: ['lz-telemetry'],
lzTelemetry: {
  calls: ['track', 'telemetry.send'],
},
```

Each entry in `calls` must be an identifier or a dotted chain of identifiers, such as `track` or
`analytics.track`. Stryker checks it against the schema the plugin exports, and the ignorer throws when it
is created with any other value.

Leave `lz-telemetry` out when your tests check what the app sends, for example by intercepting the
analytics request with `page.route`.

## Hide console mutants with lz-console

Console output does not reach the DOM, so the mutants in a `console.log` call's arguments survive. The
opt-in `lz-console` ignorer hides every mutant of a statement that is just a call to one of the listed
`console` methods. Reason: "lz-console: console output; DOM tests do not observe it".

By default it hides `console.log`, `console.debug`, `console.info`, and `console.trace`. It keeps the
mutants of `console.warn` and `console.error` unless you list them. Set `lzConsole.methods` to choose the
methods. Your list replaces the default list:

```ts
appendPlugins: ['@layzee/stryker-playwright-runner', '@layzee/stryker-jsx-mutators'],
ignorers: ['lz-console'],
lzConsole: {
  methods: ['log', 'debug', 'info', 'trace', 'warn'],
},
```

`methods` takes the names of the `console` methods: `assert`, `clear`, `count`, `countReset`, `debug`,
`dir`, `dirxml`, `error`, `group`, `groupCollapsed`, `groupEnd`, `info`, `log`, `table`, `time`,
`timeEnd`, `timeLog`, `trace`, and `warn`. Stryker checks it against the schema the plugin exports, and the
ignorer throws when it is created with any other value, such as the typo `lgo`.

As with `lz-telemetry`, the statement can be an optional call, such as `console.log?.(message)`, whose `?.`
mutant is hidden with the statement, and can sit under `await` or `void`. The ignorer keeps the mutants of a
console call whose result the code uses, such as `ok || console.log(message)`, of a computed callee, such
as `console['log'](message)`, and of a call whose argument can act on the page, by the same rule as
`lz-telemetry`: `console.log(count++)` and `console.log(queue.shift())` keep their mutants.

Leave `lz-console` out when your tests check console output, for example with Playwright's
`page.on('console')` or a spy on `console` in a unit test.

## Use several ignorers

List each ignorer you want, after the plugin in `appendPlugins` or `plugins`:

```ts
ignorers: ['lz-jsx-styling', 'lz-telemetry', 'lz-console'],
```

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
