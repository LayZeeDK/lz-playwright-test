# Design: Playwright-observable UI mutation operators (Opus draft)

Status: design, 2026-10-24. Builds on `docs/research/playwright-mutation-operators.md` (cited as "research", with its section numbers) and `docs/VERDICT.md`. StrykerJS sources are read at tag `v10.1.1` in `D:/projects/github/stryker-mutator/stryker-js`; Playwright docs at `v1.64.1` in `D:/projects/github/microsoft/playwright`.

Labels: **[checked]** = read or ran it (path or command given). **[inferred]** = reasoning from checked facts.

Spike artifacts (all under `spikes/design-opus/`): `ui-mutators.ts` (prototype of the plugin), `sample.tsx`, `spike.ts` + `spike-output.txt`, `neutral.ts` + `neutral-output.txt`, `directive.ts` + `directive-output.txt`.

## 1. Goal and non-goals

**Goal.** Give StrykerJS a small set of source-level mutation operators for React JSX/TSX whose effects show up through the locators and assertions that realistic Playwright e2e and component suites already use: role, label, text and test-id locators, actions, `toHaveURL`, `toBeVisible`, `toBeDisabled`. A surviving mutant should name one untested UI contract (a visible text, an accessible name, a handler's effect, a visibility or enabled state, a link target) at one source location. The operators ship as a Stryker plugin package that works with the unmodified StrykerJS 10.1.1 and the Playwright runner from `VERDICT.md` (which made per-test activation cheap), and are shaped so the same code can later move into `@stryker-mutator/instrumenter` through an upstream PR.

**Non-goals.** Angular, Vue and lit templates and CSS: they need new file formats in the instrumenter (research route b-2) and, for Angular, a mutant switch that compiled templates can reach (#5156); they come after JSX. Test-side mutation (negating or removing Playwright assertions): it needs no instrumenter work and belongs in a separate tool; the cheaper signal is assertion attribution in the runner (research 5.2). Visual-only operators (colour, spacing, fonts), `data-testid` changes (they measure the test hook, not the app) and timing operators (delay inflation, `await` removal: mostly equivalent under auto-waiting, and flaky). A general mutator plugin API for StrykerJS: maintainers declined it twice (#444, #2794, research 3.1); this design asks upstream for less. JSX runtimes other than React (Preact, Solid) are not validated.

## 2. Operator catalog (first release)

### 2.0 How the ranking was made

Rank = expected kill value against a realistic suite, judged on four points [inferred from research sections 2 and 4]:

1. **Gap**: StrykerJS 10.1.1 produces no equivalent mutant today (research 2.3).
2. **Observer in the realistic suite**: the locator or assertion that kills it is one of `getByRole`/`getByLabel`/`getByText`/`getByTestId`, an action, `toHaveURL`, `toBeVisible`, `toBeDisabled`.
3. **Low equivalent rate** after the operator's skip rules.
4. **Actionable survivor**: a survivor maps to one missing assertion, not to "the page is broken".

Names follow StrykerJS style (PascalCase noun for the thing mutated, like `StringLiteral`, `ArrowFunction`), and are framework-neutral on purpose: the same name will cover the Angular template variant later, so one `excludedMutations` entry keeps working across frameworks.

Placement levels used below (section 3.3 explains them): **value** = the switch sits on an existing expression (no new placement code); **attribute** = the switch becomes the attribute's value; **text** = the text node becomes `{switch}`; **element** = the whole element is duplicated per mutant.

Common rules for every attribute operator [checked: prototype `classifyValue` in `spikes/design-opus/ui-mutators.ts`]: the attribute name must be a plain `JSXIdentifier` (no `xlink:href` namespaces); values that are literals in braces (`{'x'}`, `{true}`, template literals) or functions are skipped, because `StringLiteral`, `BooleanLiteral`, `ArrowFunction` and `BlockStatement` already mutate them; a replacement that equals the original (emptying `""`) is never emitted.

### 2.1 `TextContent` (rank 1)

- **Matches**: `JSXText` whose parent is `JSXElement` or `JSXFragment`, whose value contains a letter or digit (`/[\p{L}\p{N}]/u`), and whose parent element is not `style` or `script`.
- **Replacement**: empty text. Placement level: text; the node becomes `{stryMutAct("2") ? null : (stryCov("2"), "Edit items")}` [checked: `spikes/design-opus/out/instrumented.tsx` line 91].
- **Example**: `<h1>Edit items</h1>` -> `<h1></h1>`; `<p>Hello {user.name}</p>` -> `<p>{user.name}</p>`.
- **Killed by**: `getByText('Edit items')`, `getByRole('heading', { name: 'Edit items' })`, `getByRole('button', { name: 'Save' })` when the text is the name, `getByLabel` when the text is inside a `<label>`, `toHaveText`/`toContainText`.
- **Equivalent risk and avoidance**: whitespace, punctuation and icon glyphs are skipped by the letter-or-digit rule (the `&times;` close button got no `TextContent` mutant [checked: `spike-output.txt`]). Text that no test reads survives, and that is the finding (in the demo app, the `Subtotal`/`Shipping`/`Total` labels are read by no test because the tests use `getByTestId` [checked: `apps/demo-app-e2e/src/cart.spec.ts`]). Substring matching (research 4.1) means emptying `"Hello "` is killed only by a test that matches the whole sentence.
- **Built-in overlap**: none; no mutator handles `JSXText` [checked: research 2.2].
- **Frameworks**: JSX now; Angular template text nodes later.

### 2.2 `AccessibleName` (rank 2)

- **Matches**: `JSXAttribute` named `aria-label`, `aria-labelledby`, `alt`, `title`, `placeholder`, `htmlFor` or `label`, with a non-empty `StringLiteral` value or a non-literal expression (`aria-label={label}`).
- **Replacement**: `name=""`. Placement level: attribute.
- **Example**: `<button aria-label="Close dialog" onClick={close}>&times;</button>` -> `aria-label=""`.
- **Killed by**: `getByRole(role, { name })`, `getByLabel`, `getByAltText`, `getByPlaceholder`, `getByTitle`, `toHaveAccessibleName`.
- **Equivalent risk and avoidance**: `htmlFor` on a `<label>` that also wraps its control stays associated by nesting, so the operator skips `htmlFor` when the label's children contain an `input`, `select` or `textarea` [inferred; not spiked]. `title` on an element that has text content does not change its name but still changes its description and `getByTitle`, so it stays. `label` covers design-system components whose `label` prop becomes the accessible name (`<TextField label="Email">`) [inferred]. Template literals are left to `StringLiteral` (the demo app's ``aria-label={`${line.name} quantity`}`` got 0 `AccessibleName` mutants [checked: `neutral-output.txt`]).
- **Built-in overlap**: none for plain attribute strings; `StringLiteral` skips `JSXAttribute` parents [checked: research 2.2].
- **Frameworks**: JSX now; Angular static attributes, `[attr.aria-label]`, `[alt]`, `for` later.

### 2.3 `EventHandler` (rank 3)

- **Matches**: `JSXAttribute` whose name matches `/^on[A-Z]/`, with a `JSXExpressionContainer` value that is not a function or literal (an identifier, member expression, call such as `onClick={select(id)}`, or conditional).
- **Replacement**: `onX={undefined}`; React attaches no listener for `undefined` [inferred from React prop semantics; the render oracle in 5.1 shows the prop disappears]. Placement level: attribute.
- **Example**: `<button onClick={save}>Save</button>` -> `<button onClick={undefined}>Save</button>`.
- **Killed by**: whatever the test asserts after the action: `toHaveURL`, `toHaveText`, `toBeVisible` of the next UI state. On a controlled input, a missing `onChange` makes React revert the value, so `fill()` followed by any value-dependent assertion kills it.
- **Equivalent risk and avoidance**: inline arrows and function expressions are skipped because `ArrowFunction` (`() => undefined`) and `BlockStatement` (`{}`) already empty them; the demo app has only inline handlers and got 0 `EventHandler` mutants [checked: `neutral-output.txt`]. Handlers with no visible effect (analytics, logging) survive legitimately; users mark them with a directive (see 3.5 for the JSX-comment caveat). On a component (`<Dialog onClose={close}>`) the prop becomes `undefined`, and a component that calls it unguarded throws: a kill by crash, which is cheap but says little [inferred].
- **Why rank 3**: event-handler removal is the most valuable and least killed class in the prior art (MaewU EHDM score 0.00, research 1.1 and 1.3).
- **Frameworks**: JSX now; Angular `(click)="save()"` output bindings later.

### 2.4 `ConditionalRendering` (rank 4)

- **Matches**: (a) `LogicalExpression` with operator `&&` directly inside a `JSXExpressionContainer`, whose right operand is a `JSXElement` or `JSXFragment`; (b) `ConditionalExpression` with a `JSXElement`, `JSXFragment` or `NullLiteral` consequent or alternate.
- **Replacement**: (a) the right operand (force render); (b) the consequent, and separately the alternate. Placement level: value.
- **Example**: `{open && <p role="status">Opened</p>}` -> `{<p role="status">Opened</p>}`; `{busy ? <span>Saving</span> : <span>Idle</span>}` -> `{<span>Saving</span>}` and `{<span>Idle</span>}`.
- **Killed by**: force render: `toBeHidden`, `not.toBeVisible`, `toHaveCount(0)`, and strict-mode violations when a locator now matches two elements; forced other branch: the locator, action or `toBeVisible` that targets the branch that disappeared.
- **Equivalent risk and avoidance**: branches whose generated code is identical are skipped. The guard pattern `user && <p>{user.name}</p>`, where the branch reads a property of the guard's root identifier, is skipped: forcing it crashes on `undefined`, which every test notices and which says nothing about the suite [inferred; not spiked].
- **Built-in overlap**: for `&&`, `ConditionalExpression` already gives `false` (hide), and its `true` renders nothing in React (research 2.2), so only "force render" is missing. Ternaries with an identifier test get no built-in mutant at all (the ternary branch is commented out in `conditional-expression-mutator.ts:83`, research 2.2).
- **Frameworks**: JSX now; Angular `@if`/`@else`, `*ngIf` later.

### 2.5 `NavigationTarget` (rank 5)

- **Matches**: `JSXAttribute` named `href`, `to`, `action` or `formAction`, with a non-empty `StringLiteral` or a non-literal expression.
- **Replacement**: `name=""`. Placement level: attribute.
- **Example**: `<Link to="/about">About</Link>` -> `<Link to="">About</Link>`; `<a href={url}>` -> `<a href="">`.
- **Killed by**: a click followed by `toHaveURL` or an assertion on the destination page (the demo's `example.spec.ts` asserts the `About` heading after clicking the link [checked]); `toMatchAriaSnapshot` with `/url`.
- **Equivalent risk and avoidance**: `""` resolves to the current location, so a link to the page it sits on is equivalent for a test that clicks it there [inferred]. `""` was chosen over removal because removing `href` also removes the `link` role, which turns a navigation fault into a locator timeout. External `https:`/`mailto:` links are rarely clicked, so they mostly survive; that is a real, if minor, gap.
- **Built-in overlap**: expression strings and `navigate('/x')` arguments are already covered by `StringLiteral` and skipped here.
- **Frameworks**: JSX now; Angular `routerLink`, `href`, form `action` later.

### 2.6 `DisabledState` (rank 6)

- **Matches**: `JSXAttribute` named `disabled`, `aria-disabled` or `readOnly`: bare (`<input disabled />`), `StringLiteral` (`aria-disabled="true"`), or non-literal expression (`disabled={busy}`).
- **Replacement**: bare or string -> `{undefined}` (attribute gone); expression -> `{false}`. Placement level: attribute.
- **Example**: `<button disabled={busy}>Save</button>` -> `disabled={false}`; `<input id="q" disabled />` -> `disabled={undefined}`.
- **Killed by**: `toBeDisabled`, `toBeEditable` (negated), `getByRole(role, { disabled: true })`, or a test that clicks and expects nothing to happen.
- **Why only "force enabled"**: forcing disabled is killed by the Enabled check of any click, which waits for the whole test timeout because Playwright's action timeout defaults to none and the test timeout to 30 s [checked: `docs/src/test-api/class-testoptions.md:86`, `docs/src/test-timeouts-js.md:10,158`]. Such a mutant is expensive and only proves that the button is clicked. Force-enabled measures whether any test checks the disabled state. Literal `disabled={true}` is already flipped by `BooleanLiteral`.
- **Equivalent risk**: low; a survivor means no test exercises the disabled state.
- **Frameworks**: JSX now; Angular `[disabled]`, `disabled`, `readonly` later.

### 2.7 `HiddenState` (rank 7)

- **Matches**: `JSXAttribute` named `hidden`, `aria-hidden` or `inert`, with the same value kinds as `DisabledState`; `aria-hidden` on `svg`, `img` and `i` elements is skipped.
- **Replacement**: as `DisabledState` (force shown). Placement level: attribute.
- **Example**: `<div role="dialog" hidden={!open}>` -> `hidden={false}`.
- **Killed by**: `toBeHidden`, `not.toBeVisible`, `toHaveCount`; a strict-mode violation when the exposed element duplicates a role and name; `getByRole` counts because ARIA-hidden elements are excluded by default [checked: research 4.1].
- **Equivalent risk and avoidance**: decorative icons carry `aria-hidden="true"` everywhere and only an aria snapshot would notice their exposure, hence the `svg`/`img`/`i` skip [inferred]. An element hidden by two mechanisms at once (attribute plus CSS class, or plus conditional rendering) gives an equivalent mutant that no rule can detect; such survivors need manual triage.
- **Frameworks**: JSX now; Angular `[hidden]`, `[attr.aria-hidden]`, `inert` later.

### 2.8 `Role` (rank 8)

- **Matches**: (a) `JSXAttribute` named `role` with a non-empty `StringLiteral`, unless it equals the element's implicit role (`<button role="button">`, `<nav role="navigation">`, `<ul role="list">`, `<a href role="link">`, small table); (b) `JSXElement` whose opening name is `button` or `a`.
- **Replacement**: (a) `role={undefined}`, placement level attribute; (b) the same element renamed to `span` with attributes and children kept, placement level element.
- **Example**: `<div role="dialog">` -> `<div>`; `<button onClick={save}>Save</button>` -> `<span onClick={save}>Save</span>`.
- **Killed by**: `getByRole('dialog' | 'button' | 'link')`, `toHaveRole`, aria snapshots; the tag swap also breaks keyboard activation (`press('Enter')`), form submission and `<a>` navigation.
- **Equivalent risk and avoidance**: redundant explicit roles are skipped through the implicit-role table [inferred; not spiked]. Suites that locate by test id, CSS or text let these survive, which is the signal: the accessibility contract is not tested.
- **Cost**: (b) duplicates the element subtree once per mutant; limiting it to `button` and `a` keeps the copies small. The sample's four tag swaps are part of the 1,657 -> 6,803 character growth [checked: `spike-output.txt`].
- **Frameworks**: JSX now; Angular `role` attribute and template tag swap later.

### 2.9 `ChildExpression` (rank 9)

- **Matches**: an `Identifier`, `MemberExpression`, `OptionalMemberExpression` or `CallExpression` that is the expression of a `JSXExpressionContainer` in child position (parent `JSXElement`/`JSXFragment`), except calls to `.map`, `.filter` or `.flatMap` (list rendering, already emptied by `ArrowFunction`).
- **Replacement**: `null`. Placement level: value.
- **Example**: `<dd data-testid="total">{formatPrice(total(lines, code))}</dd>` -> `<dd data-testid="total">{null}</dd>`; `{props.children}` -> `{null}`.
- **Killed by**: `toHaveText`/`toContainText` (including through `getByTestId`, as in the demo cart tests), `getByText`, and any locator for projected children.
- **Equivalent risk**: an expression that is already empty in every test (an optional slot) survives, which correctly reports the slot as untested. In the demo app, `{line.name}` inside the quantity `<label>` will survive because the input's `aria-label` provides the name the test uses [inferred from `apps/demo-app/src/app/app.tsx` and `cart.spec.ts`].
- **Built-in overlap**: none for identifiers and member expressions; for `{t('key')}` the built-in mutant is `t('')`, a different fault.
- **Frameworks**: JSX now; Angular `{{ expr }}` interpolation and `<ng-content>` later.

### 2.10 `AriaState` (rank 10)

- **Matches**: `JSXAttribute` named `aria-expanded`, `aria-pressed`, `aria-checked`, `aria-selected`, `aria-current`, `aria-invalid` or `checked`; `StringLiteral` or non-literal expression.
- **Replacement**: string -> `{undefined}`; expression -> `{!(expr)}`. Placement level: attribute.
- **Example**: `<button aria-expanded={open}>Menu</button>` -> `aria-expanded={!open}`.
- **Killed by**: `getByRole(role, { expanded | pressed | checked | selected })`, `toBeChecked`, `toHaveAttribute`, `toMatchAriaSnapshot`, `toHaveAccessibleErrorMessage` (for `aria-invalid`).
- **Why negation here and not in `DisabledState`**: ARIA state never blocks an action, so no cheap actionability kill hides the state check, and negation is observed in whichever state the test checks.
- **Equivalent risk**: low. Expect many survivors, because few suites pass state options; each one is a real accessibility gap.
- **Frameworks**: JSX now; Angular `[attr.aria-expanded]`, `[checked]` later.

### 2.11 Later, and why each waits

| Operator | Why it waits |
|---|---|
| `ListRendering` (`items.map(f)` -> `items.slice(0, 1).map(f)`) | Killed only by `toHaveCount` or second-item assertions, which are outside the realistic-suite list. "Render none" is already covered by `ArrowFunction`. First candidate for the next release |
| `InputType` (`type="submit"` -> `type="button"`) | Useful for forms, but the `text`/`email`/`search` swaps are mostly equivalent for roles; needs a per-type table |
| `FocusManagement` (`autoFocus`, `.focus()` removal) | High survival: suites click before typing. `focus()` statements are already removed by `CallExpression` when alone in their statement |
| `TabIndex`, `EventTypeSwap` (`onClick` -> `onMouseDown`) | Killed only by keyboard-driven tests; `click()` fires `mousedown`, so the swap survives every mouse-driven test |
| `HistoryReplace` (`navigate(x)` -> `navigate(x, { replace: true })`) | Router-specific API knowledge; few suites press Back |
| `DuplicateElement` | Strict-mode kills are valuable, but it is element-level (subtree copied per mutant) and adds many mutants |
| `AwaitExpression` removal | Mostly equivalent under 5 s auto-retrying assertions and makes runs flaky (research 4.1) |
| CSS operators (`display`, `visibility`, `pointer-events`) | No parser in the instrumenter; needs route b-2, an init-script activation, and has no per-test coverage (research 3.3 e) |
| Angular, Vue, lit templates | New file formats (route b-2) and, for Angular, a compiled-template-reachable switch (#5156); the operator names above are reused |
| `TestId`, `DelayInflate` | Never: the first measures the test hook, the second kills by timeout and creates flaky verdicts |

## 3. Integration architecture

### 3.1 Package shape

One package, `packages/stryker-ui-mutators` (`@layzee/stryker-ui-mutators`), ESM, TypeScript source run by Node type stripping like the runner package (`"main": "./src/index.ts"` [checked: `packages/stryker-playwright-runner/package.json`]). Three modules:

| Module | Contents | Depends on |
|---|---|---|
| `src/operators.ts` | The registry (section 4): one entry per operator, attribute rules as data, node rules as functions that receive Babel's `types` as an argument | Babel types only (`import type`), no StrykerJS |
| `src/install.ts` | Resolves the instrumenter that core uses, checks its version, adapts registry entries to `NodeMutator`s, pushes them into `allMutators`, patches `expressionMutantPlacer` | `@stryker-mutator/instrumenter` internals (by file URL) |
| `src/index.ts` | `await install()` at module top level; `export const strykerValidationSchema = { properties: {} }` | `install.ts` |

`operators.ts` is the part an upstream PR lifts unchanged (3.6). Peer dependency: `@stryker-mutator/core` `10.1.1` exact, because the plugin patches internals that have no compatibility promise.

Splitting `operators.ts` into its own package (the weapon-regex shape) waits until a second consumer exists: the upstream PR or Angular template support.

### 3.2 Registration with StrykerJS 10.1.1, no upstream change

1. The user lists the package in `plugins`. Core imports plugin modules in the prepare step, before instrumentation [checked: research 3.2, `1-prepare-executor.ts:70-78`], and awaits the import, so the top-level `await install()` finishes first [inferred from ESM semantics].
2. `install()` resolves `@stryker-mutator/core/package.json` from the project, then `@stryker-mutator/instrumenter/package.json` **from core's directory**. That is the copy core itself imports, so a second instrumenter elsewhere in `node_modules` is never patched by mistake. This closes the duplicate-install hole that `@hughescr/stryker-llm-mutator` documents (research 3.3 b-1) [checked: `instrumenterDir()` in the prototype; the spikes instrument with the `Instrumenter` from that directory].
3. It refuses any instrumenter version other than the pinned one and throws a message that names the found version and path [checked: prototype].
4. It imports `dist/src/mutators/mutate.js` and `dist/src/mutant-placers/index.js` by file URL (the `exports` map exposes only `.`, research 3.2), pushes one `NodeMutator` per enabled operator into `allMutators`, which `transformBabel` reads by reference (`babel-transformer.ts:36`), and patches the placer (3.3). It is idempotent: a second call adds nothing [checked: `spike.ts` asserts `again.added` is empty].
5. The module exports only `strykerValidationSchema`, not `strykerPlugins`. Core puts a module in `pluginModulePaths` only when it exports plugins [checked: `node_modules/@stryker-mutator/core/dist/src/di/plugin-loader.js:41-56`], so the module (and Babel) is not imported again into every test-runner and checker child process.

Known weakness: core downgrades any error thrown while importing a plugin to a warning and continues [checked: `plugin-loader.js:112-120`], so a version mismatch prints `Error during loading "@layzee/stryker-ui-mutators" plugin: ...` and the run proceeds with built-in mutators only. The report then shows no UI mutator names. Section 5 lists this risk.

### 3.3 JSX-safe placement

The built-in `expressionMutantPlacer` puts `cond ? mutant : original` where the mutated expression was. Inside JSX this breaks in two ways (research F.1): a conditional is not a valid `JSXAttribute` value (Babel throws), and a conditional placed among `JSXElement` children is printed without braces and re-parses as text. Element-level mutants also copy the whole element.

The plugin wraps `expressionMutantPlacer`'s `canPlace` and `place` (the `allMutantPlacers` array is frozen, the placer object is not [checked: `mutant-placers/index.ts`]):

| Node | `canPlace` | `place` does |
|---|---|---|
| `JSXAttribute` | always (new) | turns the value into `{expr}` (bare -> `true`, string -> a fresh `StringLiteral`, container -> its expression), maps each mutant's replacement attribute the same way (removal is represented as `{undefined}`), then calls the original `place` on that expression |
| `JSXText` with a letter or digit, in child position | new | replaces the text by `{"cleaned text"}`, using Babel's `types.react.buildChildren` so whitespace is cleaned exactly as the JSX transform cleans it; an emptied text becomes `null` |
| Any expression whose parent is `JSXElement`/`JSXFragment` | unchanged | wraps the node in a `JSXExpressionContainer` first (the research F.1 fix) |
| Everything else | unchanged | original behaviour |

Why every attribute operator targets the `JSXAttribute` node rather than its value: the transformer registers a mutant at the nearest placement site on the path from the mutated node upwards (`babel-transformer.ts:158-172`). Making `JSXAttribute` a placement site keeps the switch inside the attribute, so the element is not copied, while built-in mutants inside an attribute's expression still find their own expression first. Nested placement works: `<a href="/docs">Docs</a>` carries an element-level `Role` switch, an attribute-level `NavigationTarget` switch and a text-level `TextContent` switch at once [checked: `out/instrumented.tsx` line 105].

Two details the spike surfaced:

- **JSX entities**: Babel keeps the undecoded `&amp;` in `extra.raw` of a JSX attribute string, and the generator prints `extra.raw`. Moving the literal into braces unchanged turns `title="Fish &amp; Chips"` into the JS string `"Fish &amp; Chips"`. A fresh `StringLiteral` fixes it [checked: negative control in 5.1].
- **Empty text**: `{""}` as a child leaves an empty-string child where the JSX transform leaves none; `null` matches the original exactly [checked: 5.1, first run mismatched on all 14 `TextContent` mutants until this change].

### 3.4 Enabling and excluding operators

- **Enable**: add the package to `plugins`. All ten operators are on.
- **Exclude**: the existing `mutator.excludedMutations` takes the operator names, exactly as for built-ins [checked: `babel-transformer.ts:275-283`; `neutral.ts` MODE=patched]. Excluded mutants are not placed but appear in the report as `Ignored` (the sample reported 48 ignored mutants [checked: `neutral-output.txt`]); that is the same behaviour users already get for built-ins.
- **Per location**: `// Stryker disable next-line TextContent` works in JavaScript context and as a line comment inside `{ }`, but the JSX comment form `{/* Stryker disable next-line TextContent */}` is silently ignored [checked: `directive-output.txt`, L5 placed, L9 and L15 ignored, no warning]. The directive bookkeeper reads only `leadingComments` (`directive-bookkeeper.ts:76`), and a JSX comment is an inner comment of `JSXEmptyExpression`. This affects built-in mutators in JSX equally [inferred]. Documented workaround: a file- or function-level `// Stryker disable TextContent`; the fix goes into the upstream PR (3.6).
- **No plugin-specific config in v1.** Every candidate option (an allow-list of operators, extra accessible-name prop names for a design system) needs the options object, which a plugin only receives through dependency injection; the earliest DI hook before instrumentation is an `Ignore` plugin factory (core creates ignorers right before `instrument()` [checked: `core/src/process/2-mutant-instrumenter-executor.ts:64-73`]). Adding it costs users an extra `ignorers: ['ui-mutators']` line that, when forgotten, silently turns the options off. Deferred until a user needs tuning; the shape is in section 4.

Example (this repository's config style [checked: `stryker.e2e.config.ts`]):

```ts
export default {
  plugins: ['@layzee/stryker-playwright-runner', '@layzee/stryker-ui-mutators'],
  testRunner: 'playwright',
  playwright: { configFile: 'apps/demo-app-e2e/playwright.config.mts' },
  mutate: ['apps/demo-app/src/app/**/*.tsx', '!**/*.story.tsx'],
  mutator: { excludedMutations: ['AriaState'] },
  coverageAnalysis: 'perTest',
} satisfies PartialStrykerOptions;
```

### 3.5 How mutator names show in reports

`transformBabel` yields `mutatorName: mutator.name` for every mutant [checked: `babel-transformer.ts:258-272`], so reports show `TextContent`, `AccessibleName`, ... exactly like built-in names, with the mutant's location on the mutated node (attribute, text or element range) and the replacement printed by Babel's generator: `aria-label=""`, `onClick={undefined}`, `disabled={false}`, an empty string for text, `<span ...>...</span>` for a tag swap [checked: `spike-output.txt`]. `.tsx` files are reported as TypeScript (research 3.2). Unlike `Regex`, which collapses all weapon-regex sub-mutators into one name (research F.3), each operator keeps its own name.

### 3.6 The upstream PR, later

Mirrors the weapon-regex split: the instrumenter owns Babel, placement, ids and reporting; the operator rules live in a table that can be versioned on its own. Three PRs, smallest first:

1. **PR A, behaviour-neutral fixes** in `packages/instrumenter`:
   - `mutant-placers/jsx-mutant-placer.ts` (new, listed in `allMutantPlacers`): the `JSXAttribute` and `JSXText` rows of the 3.3 table.
   - `mutant-placers/expression-mutant-placer.ts`: wrap expressions in JSX child position in a `JSXExpressionContainer`.
   - `transformers/directive-bookkeeper.ts`: also read `innerComments` of `JSXEmptyExpression`, so `{/* Stryker disable next-line X */}` works for every mutator.
   - Evidence it is neutral for built-ins: with the patch installed and all UI operators excluded, instrumented output equals the stock output once mutant ids are masked [checked: `neutral-output.txt`, three files]; upstream's existing snapshot suite would confirm.
2. **PR B, default-off UI mutators**: `mutators/ui/*.ts` adapters over the table, appended to `allMutators` with a new optional `NodeMutator.defaultEnabled?: false`; a new option `mutator.includedMutations: string[]` (schema `packages/api/schema/stryker-core.json`, next to `excludedMutations`). `transformBabel` drops default-off mutators that are not included before traversal, so they create no `Ignored` noise. Default-off answers the main objection to new mutators: higher mutant counts for every React user (research 3.3 a). Unit specs per mutator plus a `testResources/instrumenter/jsx-ui.tsx` snapshot.
3. **PR C, external table** (only when Angular template support starts): move `operators.ts` into a package the instrumenter depends on, as it depends on `weapon-regex ~2.0.0` (research F.3). That package would also carry the template-string operators in weapon-regex style (`mutateAngularTemplate(source) -> { replacement, name, location }[]`), which is where the delegation pattern fits best.

After PR B ships, this plugin is reduced to a compatibility shim for older StrykerJS versions and can be retired.

## 4. Data shapes

Erasable TypeScript only (no enums, namespaces or parameter properties). The registry is a table: attribute operators are pure data interpreted by one generic `NodeMutator`; only the four operators whose matching cannot be expressed as "attribute name plus value kind" carry a function. The prototype in `spikes/design-opus/ui-mutators.ts` implements a subset of these shapes (no `skip`, no `frameworks`) and passed the spike.

```ts
import type { NodePath, types } from '@babel/core';

export type OperatorName =
  | 'TextContent'
  | 'AccessibleName'
  | 'EventHandler'
  | 'ConditionalRendering'
  | 'NavigationTarget'
  | 'DisabledState'
  | 'HiddenState'
  | 'Role'
  | 'ChildExpression'
  | 'AriaState';

/** How an attribute's value is written in the source. Literal-in-braces and function values are never matched. */
export type ValueKind = 'string' | 'bare' | 'expression';

/** What the attribute becomes. `remove` is emitted as `{undefined}` so placement stays at the attribute. */
export type Replacement = 'emptyString' | 'remove' | 'false' | 'negate';

export type Framework = 'jsx' | 'angular-template';

export interface AttributeRule {
  readonly kind: 'attribute';
  readonly attributes: readonly string[] | RegExp;
  readonly replacements: Readonly<Partial<Record<ValueKind, readonly Replacement[]>>>;
  /** Element names the rule never applies to, e.g. `aria-hidden` on `svg`. */
  readonly skipElements?: readonly string[];
  /** Extra equivalence guard, e.g. `htmlFor` on a label that wraps its control. */
  readonly skip?: (attribute: NodePath<types.JSXAttribute>) => boolean;
}

export interface NodeRule {
  readonly kind: 'node';
  /** Babel's `types` is passed in so the table has no runtime dependency on a Babel copy. */
  mutate(path: NodePath, t: typeof types): Iterable<types.Node>;
}

export type Rule = AttributeRule | NodeRule;

export interface UiOperator {
  readonly name: OperatorName;
  /** Section 2 rank; reports and docs list operators in this order. */
  readonly rank: number;
  readonly frameworks: readonly Framework[];
  readonly rules: readonly Rule[];
}

/** The registry: ordered by rank, looked up by name. */
export interface UiOperatorRegistry {
  readonly all: readonly UiOperator[];
  readonly byName: ReadonlyMap<OperatorName, UiOperator>;
}

/** The subset of the instrumenter's NodeMutator contract the adapter produces (`mutators/node-mutator.ts`). */
export interface NodeMutatorLike {
  readonly name: string;
  mutate(path: NodePath, context: { isExpressionContext: boolean }): Iterable<types.Node>;
}

/** Arguments of install(); the plugin entry point passes process.cwd(). */
export interface InstallOptions {
  readonly projectDir: string;
  readonly supportedInstrumenterVersion: '10.1.1';
}

export interface InstallResult {
  readonly instrumenterDir: string;
  readonly added: readonly OperatorName[];
}

/**
 * Deferred (3.4): user options under a `uiMutators` key, read by an Ignore-plugin factory.
 * Not part of v1; listed so the schema contribution has a known target.
 */
export interface UiMutatorsOptions {
  /** Operators to generate; default: all. Unlisted operators produce no Ignored entries. */
  readonly operators?: readonly OperatorName[];
  /** Extra attribute names per attribute operator, e.g. { AccessibleName: ['tooltip'] }. */
  readonly extraAttributes?: Readonly<Partial<Record<OperatorName, readonly string[]>>>;
}
```

Example registry entry (data, no branching):

```ts
const disabledState: UiOperator = {
  name: 'DisabledState',
  rank: 6,
  frameworks: ['jsx'],
  rules: [
    {
      kind: 'attribute',
      attributes: ['disabled', 'aria-disabled', 'readOnly'],
      replacements: { bare: ['remove'], string: ['remove'], expression: ['false'] },
    },
  ],
};
```

## 5. Risks and spikes, riskiest first

| # | Risk | Status | How a spike settles it |
|---|---|---|---|
| 1 | JSX-safe placement produces code that parses but behaves differently from the intended mutation (wrong whitespace, entities, nesting, inert baseline) | **Settled for React in Node** (5.1) | Done: instrumented build vs hand-applied source, per mutant. Remaining: Vue/HTML `<script>` and Svelte files are not exercised (the operators match only JSX nodes, so they should stay inert there [inferred]) |
| 2 | The placer patch changes built-in mutants | **Settled** (5.2) | Done: masked-id output equality on three files |
| 3 | Patched internals: the plugin patches a different instrumenter copy than core uses, or a StrykerJS upgrade moves `dist/src/mutators/mutate.js` | Partly settled: resolution from core's directory works in the spike; version pin refuses other versions | Run a real `stryker run` through core with `testRunner: 'command'` and `commandRunner.command: 'node -e 0'` (no browser) on `sample.tsx`, and assert that `mutation.json` lists the ten operator names. Repeat on every StrykerJS bump in CI |
| 4 | A failed install is only a warning, so users believe UI mutants ran | Open | Same core run with the pin set to a wrong version: confirm the warning text, then decide whether the plugin should also refuse to continue (for example by pushing a mutator that throws a clear error on the first file) |
| 5 | Run time: `TextContent` adds many mutants, and kills through a missing locator wait for the 30 s test timeout because the action timeout defaults to none [checked: Playwright docs, 2.6] | Open; measured counts only: demo `app.tsx` 21 -> 36 mutants (+15 UI) [checked: `neutral-output.txt`] | Run `stryker.e2e.config.ts` on `app.tsx` with the plugin, with and without `use.actionTimeout: 5000`; record wall time and kill/timeout split. If timeouts dominate, the runner should set an action timeout under mutation (a runner change, not an operator change) |
| 6 | Equivalent and noise rates differ from the estimates in section 2 | Open | Classify every survivor by hand on the demo app and `stryker-playwright-hello-world` (VERDICT evidence table); adjust skip rules where a pattern repeats |
| 7 | Replacements fail type checking (`onClose={undefined}` on a required prop) and inflate CompileErrors with the TypeScript checker | Open | Run `@stryker-mutator/typescript-checker` on the demo app; CompileError is the correct verdict, but count it |
| 8 | `{/* Stryker disable */}` JSX comments are ignored | **Checked** (5.3) | Fix upstream (PR A); a 5-line patch of `DirectiveBookkeeper.prototype.processStrykerDirectives` is possible in the plugin but not planned |
| 9 | React semantics assumed (`undefined` props omitted, `null` children render nothing); other JSX runtimes may differ | Open | Out of scope for v1; documented as React-only |

### 5.1 Spike: placement correctness (risk 1)

Command: `node spikes/design-opus/spike.ts` (full output in `spikes/design-opus/spike-output.txt`).

Method: `install()` the prototype into the installed `@stryker-mutator/instrumenter@10.1.1`, instrument `sample.tsx` (all ten operators plus built-ins, with the edge cases: multi-line text, text next to `{expr}`, `&amp;`/`&mdash;`/`&times;` entities, bare boolean attributes, element-level swaps of JSX children, three placement levels on one `<a>`), check that the output re-parses as TSX, transpile with TypeScript (`jsx: react-jsx`) and render with React 19's `jsx-runtime` in Node into a serialized element tree (props including handler presence, and children), for two prop scenarios. Oracle per mutant: render(instrumented build with `__stryker__.activeMutant = id`) must equal render(original source with the mutant's `replacement` spliced in at its `location`). Also: instrumented build with no active mutant must equal the original.

Result:

```
installed: TextContent, AccessibleName, EventHandler, ConditionalRendering, NavigationTarget, DisabledState, HiddenState, Role, ChildExpression, AriaState
mutants: 61 total, 48 from UI operators
per mutator: BlockStatement=2 TextContent=14 ChildExpression=4 AccessibleName=6 Role=8 EventHandler=2 DisabledState=3 NavigationTarget=2 HiddenState=2 BooleanLiteral=2 ConditionalExpression=2 LogicalOperator=1 ConditionalRendering=5 AriaState=2 ArrowFunction=2 StringLiteral=4
size: original 1657 chars, instrumented 6803 chars
...48 lines "ok   L<n> <Operator>: <original> -> <replacement>"...
mutants rendering identically to the original in both scenarios (equivalent for this oracle): 1
47 ArrowFunction L41 () => undefined
mismatches: 0
```

All 61 mutants (48 UI, 13 built-in) behave exactly like their hand-applied source edit, and the baseline renders like the original [checked]. The one "equivalent" is the built-in `ArrowFunction` on an inline handler, which the serializer cannot tell apart (both are functions); it is not a UI operator.

Controls, so the green result could have come out otherwise:

- First run, activation broken (the spike replaced `globalThis.__stryker__` instead of mutating the cached namespace object): 60 mismatches. The oracle detects wrong behaviour.
- Second run, `{""}` for emptied text: 14 mismatches, all `TextContent` (empty-string child vs. no child). Fixed by emitting `null`.
- `SPIKE_KEEP_RAW=1 node spikes/design-opus/spike.ts` reuses the parsed attribute literal: the baseline assertion fails with `title="Fish &amp; Chips"` vs `title="Fish & Chips"`, and the instrumented file shows `title={stryMutAct_9fa48("8") ? "" : (stryCov_9fa48("8"), "Fish &amp; Chips")`. The fresh-literal step is required.

Limits: React elements are rendered in Node, not in a browser DOM; event handlers are compared by presence, not by running them; no skip rules marked "not spiked" in section 2 are in the prototype.

### 5.2 Spike: neutrality and real-file counts (risks 2 and 5)

Command: `for m in plain patched ui; do MODE=$m node spikes/design-opus/neutral.ts; done` (output in `neutral-output.txt`).

```
plain sample.tsx: sha (ids masked) 2a5dc33ba953, 1657 -> 3770 chars, mutants placed 13 (ui 0), ignored 0
plain app.tsx: sha (ids masked) 0f4bff0567d9, 2066 -> 4573 chars, mutants placed 21 (ui 0), ignored 0
plain price-tag.tsx: sha (ids masked) bc0accb7ef05, 817 -> 3901 chars, mutants placed 27 (ui 0), ignored 0
patched sample.tsx: sha (ids masked) 2a5dc33ba953, 1657 -> 3786 chars, mutants placed 13 (ui 0), ignored 48
patched app.tsx: sha (ids masked) 0f4bff0567d9, 2066 -> 4573 chars, mutants placed 21 (ui 0), ignored 15
patched price-tag.tsx: sha (ids masked) bc0accb7ef05, 817 -> 3901 chars, mutants placed 27 (ui 0), ignored 3
ui app.tsx: ... mutants placed 36 (ui 15)
  TextContent=8 AccessibleName=0 EventHandler=0 ConditionalRendering=0 NavigationTarget=2 DisabledState=0 HiddenState=0 Role=0 ChildExpression=5 AriaState=0
ui price-tag.tsx: ... mutants placed 30 (ui 3)
  TextContent=0 AccessibleName=0 EventHandler=0 ConditionalRendering=1 NavigationTarget=0 DisabledState=0 HiddenState=0 Role=0 ChildExpression=2 AriaState=0
```

With the patch installed and the UI operators excluded, the output equals stock output once mutant ids are masked [checked]. Raw output differs only because ignored mutants still consume ids (the `sample.tsx` length differs by 16 characters of longer ids). On the demo's real components the operators add 15 and 3 mutants, and the duplicate-avoidance rules held: no `EventHandler` mutants for inline arrows, no `AccessibleName` mutants for template literals [checked].

### 5.3 Spike: directives in JSX (risk 8)

Command: `node spikes/design-opus/directive.ts` (output in `directive-output.txt`): `{/* Stryker disable next-line TextContent */}` -> mutant on L5 still placed, no warning; `// Stryker disable next-line TextContent` inside `{ }` (L9) and before a JS statement (L15) -> `Ignored using a comment` [checked].

## 6. Verification plan

Three layers, cheapest first. Each layer has a negative control, so a green result could have failed.

### 6.1 Operator unit tests (Node, no browser)

`packages/stryker-ui-mutators/test/operators.test.ts`, run with `node --test`, in the style of `packages/stryker-playwright-runner/test/runner.test.ts` (plain `node:test` + `assert/strict`, the real `Instrumenter`, helper lookups by `mutatorName` and `replacement`).

- **Generation table**: one row per operator with a TSX snippet and the exact set of `(mutatorName, replacement)` pairs expected, filtered to UI operators. For example `<button aria-label="Close" onClick={close}>Save</button>` must give exactly `AccessibleName aria-label=""`, `EventHandler onClick={undefined}`, `TextContent ""`, `Role <span ...>`.
- **Must-not-generate rows**, one per skip rule: `aria-label=""`, `aria-label={'x'}`, ``aria-label={`${x}`}``, `onClick={() => f()}`, `<button>&times;</button>`, `<style>{'...'}</style>` text, `<button role="button">`, `<label htmlFor="q">Q <input id="q"/></label>`, `user && <p>{user.name}</p>`, `c ? <A/> : <A/>`, `<svg aria-hidden="true">`, `disabled={true}`, `items.map(...)` as a child.
- **Render oracle**: `spike.ts` promoted to a test over a fixture that covers all ten operators and the edge cases of 5.1: zero mismatches, baseline equal.
- **Neutrality**: `neutral.ts` promoted: for a small corpus (the three spike files plus a few of upstream's `testResources/instrumenter/*.tsx` inputs read from the StrykerJS clone), masked output with the patch and all UI operators excluded equals stock output.
- **Install guards**: second `install()` adds nothing; a fake project directory whose core resolves an instrumenter with another version makes `install()` throw a message that contains the found version and path.
- Negative control for the suite: run it once with the `extra.raw` step removed (the `SPIKE_KEEP_RAW` switch) and once with the JSX-child wrap removed; both must fail.

### 6.2 Runner integration: a Playwright test kills each operator's mutant

`packages/stryker-playwright-runner/test/ui-mutators.test.ts`, structured like `runner.test.ts`: `before()` installs the operators, instruments a fixture, writes the served bundle, creates `PlaywrightTestRunner`, and runs the dry run with `coverageAnalysis: 'perTest'`; each test calls `mutantRun` with a `testFilter` and asserts the status and `killedBy`.

Fixture `test/ui-fixture/`:

- `src/app.tsx`: one page with an element per operator (heading text, an icon button with `aria-label`, a referenced `onClick` handler that reveals a status, an `&&` panel, a link to `#/done`, a `disabled={busy}` submit button, a `hidden={!open}` region, a `role="dialog"`, a `{total}` output, an `aria-expanded={open}` toggle). Transpiled in `before()` with TypeScript (`jsx: react`, `jsxFactory: 'h'`) against a 30-line `h()` DOM helper that follows React DOM's prop rules (`undefined`/`null`/`false` omitted, `true` as an empty attribute, `on*` as listeners, `htmlFor` as `for`). The helper keeps the fixture bundler-free like the existing one; React fidelity is already covered by 6.1's oracle.
- `tests/ui.spec.ts`: realistic tests using only `getByRole`, `getByLabel`, `getByText`, `getByTestId`, `click`, `toHaveURL`, `toBeVisible`, `toBeHidden`, `toBeDisabled`, `toHaveText`.
- `playwright.config.ts`: as the existing fixture, plus `use: { actionTimeout: 2_000 }` so locator-failure kills finish quickly.

Assertions, one test per row:

| Operator | Mutant (lookup) | Killing test | Expected |
|---|---|---|---|
| `TextContent` | `<h1>Orders</h1>` emptied | "shows the heading" (`getByRole('heading', { name: 'Orders' })`) | Killed, `killedBy` = that test |
| `AccessibleName` | `aria-label=""` on the close button | "closes the dialog" (`getByRole('button', { name: 'Close' }).click()`) | Killed |
| `EventHandler` | `onClick={undefined}` on Show | "reveals the status" (`click`, then `toBeVisible`) | Killed |
| `ConditionalRendering` | `open && <Panel/>` forced | "panel starts hidden" (`toBeHidden`) | Killed |
| `NavigationTarget` | `href=""` on Done | "navigates to done" (`click`, `toHaveURL(/#\/done/)`) | Killed |
| `DisabledState` | `disabled={false}` | "submit is disabled while busy" (`toBeDisabled`) | Killed |
| `HiddenState` | `hidden={false}` | "region hidden until opened" (`toBeHidden`) | Killed |
| `Role` | `role={undefined}` on the dialog | "opens the dialog" (`getByRole('dialog')`) | Killed |
| `ChildExpression` | `{total}` -> `{null}` | "shows the total" (`getByTestId('total')` + `toHaveText`) | Killed |
| `AriaState` | `aria-expanded={!open}` | "toggle reports expanded" (`getByRole('button', { expanded: true })`) | Killed |

Negative controls in the same file: each operator also gets one mutant that a selected test does not observe (for example `TextContent` on a footer note run against "shows the heading" only), which must be `Survived`, followed by the killing run of the same mutant in the same file, as `runner.test.ts` already does for its survivor case. This proves the kill comes from the observation and not from a broken page. A last test asserts that the dry run's per-test coverage credits the text mutant only to tests that render the page, as the existing per-test coverage test does.

### 6.3 End-to-end on the demo app

`stryker.e2e.ui.config.ts` (the 3.4 example with `mutate: ['apps/demo-app/src/app/app.tsx']`, JSON reporter to `reports/e2e-ui/mutation.json`), run by `npx stryker run stryker.e2e.ui.config.ts`, and a small Node check that reads the JSON report:

- the report contains exactly the 15 UI mutants counted in 5.2, with mutator names and replacements as listed there;
- predicted statuses [inferred from `cart.spec.ts` and `example.spec.ts`]: killed: `TextContent` on `Cart`, `Discount code`, `About` (link), `About` (heading), `Back to cart`; both `NavigationTarget`; `ChildExpression` on the four `formatPrice(...)` outputs. Survived: `TextContent` on `Subtotal`, `Shipping`, `Total` (tests use test ids), `ChildExpression` on `{line.name}` (the `aria-label` provides the name). That is 11 killed, 4 survived;
- any deviation from the prediction is triaged by hand and fed into risk 6. Wall time and the kill/timeout split are recorded for risk 5, once with the e2e config's current timeouts and once with `use.actionTimeout: 5000`.
