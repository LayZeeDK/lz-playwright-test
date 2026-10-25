# Design: Playwright-observable mutation operators for StrykerJS (Fable draft)

Written 2026-10-24. Builds on `docs/research/playwright-mutation-operators.md` (operator inventory, StrykerJS gaps, routes) and `docs/VERDICT.md` (the runner this complements). It does not repeat them; section numbers like "research 2.2" point into the research file.

Labels: **[checked]** = read or ran (path or command cited). **[inferred]** = reasoning from checked facts. StrykerJS paths are inside `D:/projects/github/stryker-mutator/stryker-js` at tag `v10.1.1`, read with `git show v10.1.1:<path>`.

Spike for this document: `spikes/design-fable/spike-jsx-placement.ts` (fixture `spikes/design-fable/Dialog.tsx`, output `spikes/design-fable/spike-output.txt`, instrumented and compiled files under `spikes/design-fable/out/`). Section 5 reports it.

## 1. Goal and non-goals

**Goal.** A StrykerJS plugin package that adds mutation operators for application UI code whose mutants a Playwright suite can observe through the locators and assertions it already uses (`getByRole`, `getByLabel`, `getByText`, `getByTestId`, actions, `toHaveURL`, `toBeVisible`, `toBeDisabled`). It runs on StrykerJS 10.1.1 with no upstream change, in the same process as the built-in mutators, so the mutants are planned, run and reported exactly like built-in ones and get per-test coverage from the Playwright runner in `VERDICT.md`. The first release covers JSX/TSX only, because that is the one UI syntax StrykerJS already parses as an AST (research 2.1), and its operators must generate no mutant a built-in mutator already generates.

**Non-goals.** Not in the first release: Angular, Vue and Svelte templates and CSS (they need new parsers and a runtime switch that templates can reach: research 3.3 routes d and e); mutating the Playwright tests themselves (research 5); visual-only operators that only `toHaveScreenshot` kills (research 1.3 point 4); timing operators (`DelayInflate`, `AwaitRemoval`) that kill by timeout and make verdicts flaky (research inventory rows 16 and 23); a mutator plugin API in StrykerJS (declined upstream since 2017, research 3.1); and a DOM-level (runtime) mutation engine like MaewU. The plugin also does not try to make the instrumenter's internals a stable API: it pins the instrumenter version and verifies at startup that its mutators are live (section 3.2).

## 2. Operator catalog, first release

Ten operators, ranked by expected kill value against a realistic Playwright suite (research 4.2 gives the observable per change class; MaewU's per-operator scores in research 1.1 give the prior-art ranking). "Kill value" here means: the mutant is not equivalent, and a suite that locates by role/label/text and asserts the effect of its actions kills it without adding assertions written for mutation testing.

All ten mutate nodes that StrykerJS 10.1.1 does not touch today or touches only in a misleading way (research 2.2, 2.3). Each operator's `mutate` skips the cases a built-in mutator already covers, so no mutant is generated twice (the skips are listed per operator and were checked in the spike: 37 mutants on the fixture, 26 from these operators, 11 built-in, no overlapping replacement [checked: `spikes/design-fable/spike-output.txt`]).

Placement: the seven attribute operators (1, 4, 5, 6, 7, 8, 10) mutate at the `JSXAttribute` node and are placed as a spread attribute; operator 3 mutates at `JSXText` and is placed as an expression container; operators 2 and 9 mutate ordinary expressions that the built-in expression placer already handles. Section 3.3 has the placement design; the spike proved it.

Naming follows StrykerJS (`StringLiteral`, `ConditionalExpression`, ...): PascalCase, letters only, because the `// Stryker disable` directive regex only accepts `[a-zA-Z, ]` in the mutator list [checked: `packages/instrumenter/src/transformers/directive-bookkeeper.ts:62-63`]. The `Jsx` prefix keeps them distinct from built-ins in reports and in `excludedMutations`.

### 2.1 The ten operators

Each entry: AST pattern (Babel node types, from `@babel/types` 8.0.8 as nested in the installed instrumenter [checked: `node_modules/@stryker-mutator/instrumenter/node_modules/@babel/types/package.json`]), replacements, before/after, what kills it, equivalent-mutant risks and the operator's avoidance, Angular applicability.

#### 1. `JsxEventHandlerRemoval`

- **Pattern.** `JSXAttribute` whose `name` is a `JSXIdentifier` matching `/^on[A-Z]/` (`onClick`, `onChange`, `onSubmit`, `onKeyDown`, ...), on any element or component. Skips `JSXNamespacedName` names and the attributes `key`, `ref`, `children`, `dangerouslySetInnerHTML` (never event handlers anyway; listed once for all attribute operators).
- **Replacement.** `onX={undefined}`. React treats an `undefined` prop like an absent one, so this is handler removal with a replacement string that reads well in the report. One mutant per handler attribute.
- **Before/after.** `<button onClick={close}>` -> `<button onClick={undefined}>`; `<form onSubmit={onSubmit}>` -> `<form onSubmit={undefined}>`.
- **Killed by.** The assertion that follows the action: `click()` then `toBeVisible`/`toHaveText`/`toHaveURL`; `fill()` then `toHaveValue` on a controlled input (removing `onChange` freezes the value). A native form whose `onSubmit` is removed submits with a full page load, so `toHaveURL` or any lost client state kills it.
- **Built-in overlap avoided.** None at the attribute: StrykerJS empties inline arrows (`ArrowFunction`) and handler bodies (`BlockStatement`) but never removes the binding of a referenced handler (research 2.2). The two built-ins keep producing their mutants on the handler body; this operator adds the binding mutant.
- **Equivalence risk.** Low. (a) A parent handler that does the same work by bubbling: rare, and then the mutant is truly equivalent; `// Stryker disable next-line JsxEventHandlerRemoval` is the escape. (b) A component that ignores the prop (`<Card onClick>` where `Card` never forwards it): equivalent, same escape. The lazier alternative is to apply the operator to host elements only (lowercase tag names); not chosen, because design-system wrappers (`<Button onClick>`) are where most handlers live in real apps [inferred].
- **Angular later.** `(click)="..."`, `(ngSubmit)="..."` removal in templates (research inventory row 4); needs route b-2.

#### 2. `JsxConditionalRender`

- **Pattern.** (a) `LogicalExpression` with `operator === '&&'` whose `right` is a `JSXElement` or `JSXFragment`. (b) `ConditionalExpression` whose `consequent` or `alternate` is a `JSXElement`/`JSXFragment`. Anywhere in the file, not only directly inside `JSXExpressionContainer` (`const panel = open && <Panel/>` counts).
- **Replacements.** (a) the `right` operand (force-show). (b) the `consequent`, then the `alternate` (force each branch).
- **Before/after.** `{open && <p role="status">Opened</p>}` -> `{<p role="status">Opened</p>}`; `{busy ? <Spinner/> : <Idle/>}` -> `{<Spinner/>}` and `{<Idle/>}`.
- **Killed by.** `toBeHidden`/`not.toBeVisible`, `toHaveCount`, and strict-mode violations when a locator now matches two elements (force-show); `getByRole`/`toBeVisible` on the branch that disappeared (branch force). `getByRole` alone kills a force-show only when the test asserts absence, so this operator measures exactly the "it should NOT be there" assertions suites tend to skip (MaewU TIM 0.03, research 1.1).
- **Built-in overlap avoided.** StrykerJS replaces `open && <p/>` with `true`, `false` and `open || <p/>`; React renders `true` as nothing, so no built-in mutant forces the element to show (research 2.2). For a ternary it never mutates an identifier test (the branch is commented out in `conditional-expression-mutator.ts:83` [checked]). When the test or left operand IS a boolean expression (`BinaryExpression` with `== != === !== < <= > >=`, or `LogicalExpression` `&&`/`||`), the built-in already yields `true` for it, which equals force-show / force-consequent; the operator skips those (`builtInForcesTrue` in the spike) so each force mutant exists once.
- **Equivalence risk.** Medium for lists: `{items.length > 0 && <ul>...</ul>}` forced on an empty list renders an empty `<ul>`, which Playwright reports as not visible (empty bounding box, research 4.1), so a `toBeHidden` test survives it. That mutant is not equivalent (the DOM differs) but it is invisible to the common assertion; accepted, and `toHaveCount(0)` on the items kills it. The branch-swap pair on a ternary is equivalent to each other only when both branches render the same thing, which is a code smell, not a design problem.
- **Angular later.** `@if (x) {...}` -> `@if (true)`, `*ngIf`, `@else` swap (row 5).

#### 3. `JsxTextEmpty`

- **Pattern.** `JSXText` whose value contains at least one letter or digit (`/[\p{L}\p{N}]/u`). Whitespace-only text (indentation between elements) and punctuation/glyph-only text (`×`, `…`, `|`, `-`) are skipped. The fixture's close button text is the letter `x`, so it is mutated; a real app would use `aria-label` plus a glyph, and the glyph produces nothing.
- **Replacement.** The string literal `""` (placed as `{""}`, section 3.3).
- **Before/after.** `<h1>Edit items</h1>` -> `<h1>{""}</h1>`; `<button>Save</button>` -> `<button>{""}</button>`.
- **Killed by.** `getByText`, `getByRole('button', { name: 'Save' })` (the text is the accessible name), `toHaveText`/`toContainText`, `toHaveTitle` for `<title>`. Emptying is the only text change the default matching rules observe: case and whitespace changes are invisible to Playwright's case-insensitive, whitespace-normalised matching (research 4.2), which is why there is no "change text" variant.
- **Built-in overlap avoided.** None: no built-in mutator handles `JSXText` (research 2.2). Text written as `{'Title'}` is already mutated by `StringLiteral` and is not a `JSXText` node.
- **Equivalence risk.** Low for user-facing text. Visually hidden text (`<span className="sr-only">`) is still in the accessible name, so `getByRole` kills it. Text inside `<script>`/`<style>` JSX is skipped by the glyph rule only if it has no letters; add an explicit skip for those two tag names.
- **Angular later.** Static template text (row 1) and interpolation removal (row 2).

#### 4. `JsxAccessibleNameEmpty`

- **Pattern.** `JSXAttribute` with `JSXIdentifier` name in `{aria-label, alt, placeholder, aria-labelledby, htmlFor}` and a non-empty value: `StringLiteral`, or `JSXExpressionContainer` holding any expression except an empty string literal.
- **Replacement.** `name=""` (one mutant). For an expression value (`aria-label={t('close')}`) the replacement is the same `aria-label=""`, which also removes the translation call from the mutated branch; that is intended, the mutant asks "does any test need this element's name".
- **Before/after.** `<button aria-label="Close dialog">` -> `<button aria-label="">`; `<label htmlFor="email">` -> `<label htmlFor="">` (the input loses its label, so `getByLabel('Email')` fails).
- **Killed by.** `getByRole(role, { name })`, `getByLabel`, `getByAltText`, `getByPlaceholder`; `toHaveAccessibleName`.
- **Built-in overlap avoided.** `StringLiteral` skips strings whose parent is a `JSXAttribute` (`string-literal-mutator.ts:38` [checked]) but mutates `aria-label={'Close'}` (parent is the container). The operator skips a value that is a `JSXExpressionContainer` holding a `StringLiteral` or `TemplateLiteral`, leaving those to the built-in.
- **Equivalence risk.** `title` is not in the default set: for most elements the accessible name comes from content first and `title` is a fallback, so emptying it is often equivalent (research inventory row 3). `aria-describedby` is out too: only `toHaveAccessibleDescription` observes it. `alt=""` on a decorative image is a valid pattern; the operator only mutates non-empty values, so it never creates that case from nothing, and a test that uses `getByAltText` on a meaningful image kills the mutant.
- **Angular later.** `aria-label="..."`, `[attr.aria-label]`, `for` (row 3).

#### 5. `JsxDisabledFlip`

- **Pattern.** `JSXAttribute` named `disabled`, `readOnly`, or `aria-disabled`, with value: (a) none (bare `disabled`), (b) `JSXExpressionContainer` with an expression that is neither a `BooleanLiteral` nor a `!`-prefixed `UnaryExpression`, (c) `StringLiteral` `"true"`/`"false"` (the ARIA form).
- **Replacements.** (a) `disabled={false}`; (b) `disabled={!expr}`; (c) the other string.
- **Before/after.** `<button type="submit" disabled={busy}>` -> `disabled={!busy}`; `<input readOnly>` -> `<input readOnly={false}>`.
- **Killed by.** Any action on the element: `click()` waits for Enabled and `fill()` for Editable, so a flipped `disabled` fails the action by timeout (research 4.1); `toBeDisabled`/`toBeEnabled`; `getByRole(..., { disabled: true })`. `aria-disabled="true"` on an ancestor also makes Playwright treat the element as disabled, so that flip is killed the same way.
- **Built-in overlap avoided.** `BooleanLiteral` already flips `disabled={true}` and strips `!` from `disabled={!ready}` (research 2.2), so those two shapes are skipped; the spike's first run generated `hidden={!!open}` next to the built-in `hidden={open}` and the rule was added [checked: the second run lists no `!!` replacement].
- **Equivalence risk.** Low. In a test where `busy` stays `false`, `disabled={!busy}` keeps the button disabled for the whole test, and the click that the test performs times out: killed, not equivalent. `disabled={false}` from a bare attribute is equivalent only if no test ever interacts with the control while it is meant to be disabled, which is a coverage gap worth reporting.
- **Angular later.** `[disabled]="busy()"` -> `"!busy()"` (row 7).

#### 6. `JsxNavigationTarget`

- **Pattern.** `JSXAttribute` named `href` or `to` with a `StringLiteral` value (direct or in a container) that is not `"#"` and not empty.
- **Replacement.** `href="#"` / `to="#"`. `"#"` rather than `""`: both keep the element a link (so `getByRole('link')` still finds it, which keeps the mutant about navigation, not about presence), but `""` resolves to the current document, which a `toHaveURL` on the same route would not catch, while `"#"` only changes the fragment, so `toHaveURL('/help')` fails on every route [inferred from URL resolution rules; spike shows the rendered `href="#"`].
- **Before/after.** `<Link to="/help">Help</Link>` -> `<Link to="#">`; `<a href="/docs">` -> `<a href="#">`.
- **Killed by.** `toHaveURL` after `click()`, assertions on the destination page, `toMatchAriaSnapshot` with `/url`, `toHaveAttribute('href', ...)`.
- **Built-in overlap avoided.** `StringLiteral` mutates `href={'/docs'}` (container form) to `""` but never a plain attribute string (research 2.2). The operator skips container-with-string-literal values. Dynamic targets (`to={route}`) are left alone: the built-in mutators already mutate wherever `route` is computed.
- **Equivalence risk.** Low; a link to the current route becomes a fragment link, which is still a URL change. External links (`href="https://..."`) mutate too; a test that asserts the new tab or the `href` kills it, otherwise it survives honestly (untested link).
- **Angular later.** `routerLink="/help"`, `href` (row 9).

#### 7. `JsxHiddenFlip`

- **Pattern.** `JSXAttribute` named `hidden`, `aria-hidden`, or `inert`, same three value shapes as operator 5.
- **Replacements.** Same rules as operator 5: bare -> `={false}`, expression -> `{!expr}`, `"true"` <-> `"false"`.
- **Before/after.** `<p hidden>Secret</p>` -> `<p hidden={false}>`; `<div hidden={!open}>` is skipped (built-in strips the `!`); `<div aria-hidden="true">` -> `aria-hidden="false"`.
- **Killed by.** `toBeVisible`/`toBeHidden`, any action (Visible check), `getByRole` (excludes ARIA-hidden elements, research 4.1), strict-mode violations when a previously hidden duplicate becomes a second match.
- **Built-in overlap avoided.** As operator 5.
- **Equivalence risk.** `aria-hidden` flipped to `"true"` on a container hides a whole subtree from `getByRole` but not from `getByText` (research 4.1: text matching does not skip hidden elements), so a text-only suite survives it; that is the operator doing its job (the suite should use roles). `inert` is observed only through actions (the element stops receiving events). Low equivalence otherwise.
- **Angular later.** `[hidden]`, `[attr.aria-hidden]` (row 6).

#### 8. `JsxRoleRemoval`

- **Pattern.** `JSXAttribute` named `role` with a `StringLiteral` value other than `presentation` and `none`.
- **Replacement.** `role={undefined}` (the element falls back to its implicit role or none).
- **Before/after.** `<div role="dialog">` -> `<div role={undefined}>`; `<p role="status">` -> `<p role={undefined}>`.
- **Killed by.** `getByRole('dialog')`, `toHaveRole`, `toMatchAriaSnapshot`. A suite that locates by test id or CSS survives it, which is the signal this operator exists to produce (research 1.3 point 5).
- **Built-in overlap avoided.** None (plain attribute strings are never mutated by built-ins).
- **Equivalence risk.** Removing `role="presentation"`/`"none"` makes an element GAIN a role, which only a test asserting absence observes; skipped. `role="button"` on a `<button>` is redundant and its removal equivalent; such redundancy is also flagged by `eslint-plugin-jsx-a11y`, so the operator does not special-case it. Role swaps (`dialog` -> `alertdialog`) are out: Playwright's role matching makes most swaps invisible unless the test names the exact role, and they add N mutants per attribute for little gain.
- **Angular later.** `role="..."` removal (row 8).

#### 9. `JsxListTruncate`

- **Pattern.** `CallExpression` whose `callee` is a `MemberExpression` with property `Identifier` `map` and at least one argument, and whose `parentPath` is a `JSXExpressionContainer` (the call's result is rendered directly). `items?.map(...)` (`OptionalCallExpression`) is included in the release version.
- **Replacement.** `<object>.slice(0, 1).map(<same arguments>)`: render only the first item.
- **Before/after.** `<ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>` -> `<ul>{items.slice(0, 1).map((i) => <li key={i}>{i}</li>)}</ul>`.
- **Killed by.** `toHaveCount(n)` with n > 1, `getByRole('listitem').nth(1)`, `getByText` for a later item, any action on a non-first item.
- **Built-in overlap avoided.** `ArrowFunction` already turns the callback into `() => undefined` (renders nothing: the "no items" mutant); `MethodExpression` has no entry for `map` (its table covers `filter`, `slice`, `sort`, ... [checked: `method-expression-mutator.ts:10-29`]). The "first item only" mutant is new and discriminates tests that only look at the first row.
- **Equivalence risk.** Equivalent when every test renders the list with zero or one items, which the mutant then reports as survived: a fixture-design finding, not noise. The `slice` call is itself a `MethodExpression` target in the *mutated* branch only, and mutants are not generated from mutated branches (the mutator runs on the original tree, `babel-transformer.ts` enter phase [checked]), so no cascade.
- **Angular later.** `@for (i of items.slice(0, 1); ...)` (row 17).

#### 10. `JsxButtonTypeSwap`

- **Pattern.** `JSXAttribute` named `type` with `StringLiteral` value in `{submit, button, reset}`.
- **Replacements.** `submit` -> `button`, `button` -> `submit`, `reset` -> `button` (one mutant each).
- **Before/after.** `<button type="submit" disabled={busy}>Save</button>` -> `type="button"`: clicking no longer submits the form. `<button type="button" onClick={open}>` inside a form -> `type="submit"`: clicking also submits.
- **Killed by.** The assertion after the click (`toHaveURL`, `toHaveText('Saved')`, a `waitForRequest`), and for `button -> submit` the side effects of an unintended submit (navigation, cleared state).
- **Built-in overlap avoided.** None.
- **Equivalence risk.** `reset -> button` is equivalent when no test checks that fields clear. `type` on a non-form element (`<input type="text">`) is excluded by the value set. Input types (`checkbox`, `email`, ...) wait, see "later".
- **Angular later.** same attribute in templates (row 15).

### 2.2 Later

| Operator (research row) | Why it waits |
|---|---|
| `JsxAriaStateFlip` (`aria-expanded`/`pressed`/`checked`/`selected`/`current`/`invalid`, row 11) | Same attribute machinery as 5 and 7, so cheap, but killed only by tests that pass the state option or use aria snapshots; shipping it first would inflate survivors with "your tests don't check ARIA state" findings before the ten above have proven the pipeline. Second release, level 2. |
| `JsxTagSwap` (`button`/`a` -> `div`/`span`, row 8) | The tag name appears in opening and closing elements, so the mutant lives at the `JSXElement`; placing it duplicates the subtree per mutant and, for a child element, needs the F.1 container wrap. A `createElement`-style rewrite avoids duplication but needs the JSX runtime import. Needs its own placer design. |
| `JsxInputTypeChange` (`checkbox` <-> `text`, row 15) | Most swaps keep the ARIA role (`email`/`text`/`search` are all `textbox`), so equivalence is high; only `checkbox`/`radio` <-> `text` is clearly observable. Fold into operator 10 once measured. |
| `FocusCallRemoval`, `TabIndexChange` (rows 12, 13) | Keyboard and focus flows are rare in suites; high survival with low information until teams write keyboard tests. |
| `DuplicateElement` (row 26) | Element-level placement (as `JsxTagSwap`), and the duplicated element also duplicates all nested mutants' switch sites. |
| `EventTypeSwap`, `HistoryReplace` (rows 24, 25) | Need keyboard or Back-button tests to be killed; level 3. |
| `ChildrenDrop` (row 18) | `{children}` -> `{null}` is killed by almost any test of a layout component; it inflates the score without saying much. Maybe as a component-test-only operator. |
| `AwaitRemoval`, `DelayInflate` (rows 16, 23) | Kill by timeout under auto-retrying assertions; flaky verdicts. Not planned. |
| Angular templates, Vue templates, CSS (routes d, e) | New parser/transformer/printer plus a runtime switch reachable from templates (#5156); several weeks each, each needs its own spike. The attribute tables in section 4 are written so a template port reuses them. |

## 3. Integration architecture

### 3.1 Package shape

One workspace package, `packages/stryker-ui-mutators`, named `@layzee/stryker-ui-mutators` (the Playwright runner is `@layzee/stryker-playwright-runner` [checked: `packages/stryker-playwright-runner/package.json`]). It is a Stryker plugin module: listed in `plugins`, imported by core's `PluginLoader` in the main process before instrumentation [checked: `packages/core/src/di/plugin-loader.ts:171` imports the module; research 3.2 for the executor order].

```
packages/stryker-ui-mutators/
  package.json          exports ".": ./src/index.ts; peerDependency @stryker-mutator/core 10.1.x (exact minor, see 3.2)
  src/index.ts          plugin entry: registers mutators + placer, exports strykerValidationSchema
  src/register.ts       resolves core's instrumenter, pushes operators into allMutators, wraps the placer, self-checks
  src/placement.ts      JSX placement: attribute -> spread, text -> expression container (3.3)
  src/operators/        one file per operator, each a UiOperator (section 4)
  src/registry.ts       the ordered table of operators, byName/atLevel
  src/attributes.ts     attribute name tables and value-shape helpers shared by the attribute operators
  test/operators.test.ts   Node-only: mutant list + React render per mutant (6.1)
  test/playwright.test.ts  browser: each operator killed by its test through the runner (6.2)
```

The plugin depends on `@babel/types` only through the instrumenter's own nested copy (`createRequire(<instrumenter>/package.json)('@babel/core').types`), so there is exactly one Babel in play; the spike does this [checked: `spike-jsx-placement.ts:19-24`]. The root `node_modules/@babel/types` is 7.29 while the instrumenter nests 8.0.8 [checked]; using the root copy would make `path.replaceWith` validate against a different version.

The lazier alternative, shipping the operators inside `@layzee/stryker-playwright-runner` and registering them from its `index.ts`, saves a package but couples two unrelated concerns (a test runner and a mutator set) and would register mutators in every process that loads the runner plugin, including the test-runner child processes where they are useless. Separate package.

### 3.2 Registering with StrykerJS 10.1.1 without upstream changes

Route b-1 from research 3.3, as `@hughescr/stryker-llm-mutator` does, plus the placer wrap from this design:

1. `src/index.ts` runs registration as a module side effect on import. Core imports plugin modules once in the main process; ESM caches the module, so registration runs once per process.
2. `register.ts` resolves the instrumenter **core will use**: `createRequire(require.resolve('@stryker-mutator/core/package.json')).resolve('@stryker-mutator/instrumenter/package.json')`, then imports `dist/src/mutators/mutate.js`, `dist/src/mutant-placers/index.js` and `dist/src/util/syntax-helpers.js` by file URL (none are in the `exports` map, which only has `.` and `./package.json` [checked: instrumenter `package.json`]). The spike resolves this way [checked: `spike-jsx-placement.ts:19-20`].
3. It pushes the operators into the live `allMutators` array. `transformBabel` takes `mutators = allMutators` as a default parameter, evaluated per call, so later pushes are seen [checked: `babel-transformer.ts:36`; the research F.1 spike and this spike both got custom mutants out]. Everything that consumes the mutator list follows: `excludedMutations` matching (`babel-transformer.ts:275-283`), the directive bookkeeper's known-name list (`directive-bookkeeper.ts:73`), the filter bookkeeping.
4. It wraps `expressionMutantPlacer.canPlace` and `.place` (3.3). `allMutantPlacers` is frozen but the placer objects are not [checked: `mutant-placers/index.js` `Object.freeze([...])` is shallow; the spike reassigns both methods].
5. **Self-check at import.** It instruments the one-line string `export const x = <a href="/x" hidden>t</a>;` through `Instrumenter` imported from the same resolved package and asserts three mutants named `JsxNavigationTarget`, `JsxHiddenFlip`, `JsxTextEmpty` come back. If not, it throws with the resolved path, which core reports as "Error during loading plugin" [checked: `plugin-loader.ts:204`]. This catches the two silent failure modes the llm-mutator documents: a duplicate instrumenter install and a bundled copy (research 3.3 b-1).
6. **Version pin.** `peerDependencies: { "@stryker-mutator/core": "~10.1.0" }` plus a runtime check of the resolved instrumenter's `package.json` version against the range the plugin was tested with; a mismatch logs a warning (not an error) naming the tested range. The internals touched are three file paths and two method names; the self-check in step 5 is the real guard.

Why not route b-2 (wrapping `Instrumenter.prototype.instrument`)? It is the right tool for new file formats, where the plugin must parse and print itself. For JSX the built-in parser, transformer, ids, coverage calls and printer all already work; b-1 reuses them and the spike shows the output is indistinguishable from built-in placement.

### 3.3 JSX-safe placement

The problem (research F.1): the built-in expression placer puts a `ConditionalExpression` wherever a mutant's placement site is, and a `JSXAttribute.value` or a `JSXElement` child cannot hold one; mutating at non-expression nodes made placement climb to the element and duplicate it, and printed bare conditionals into children.

The design: give `JSXAttribute` and `JSXText` their own placement, so no attribute or text mutant ever climbs.

- **Attribute site.** `canPlace` accepts a `JSXAttribute` whose name is a `JSXIdentifier` not in `{key, ref, children, dangerouslySetInnerHTML}`. `place` converts the original attribute and each applied mutant (all `JSXAttribute`s) to a one-property object (`name=value` -> `{ name: value }`; bare -> `{ name: true }`; hyphenated names become string keys), chains the switch exactly as the expression placer does (`mutationCoverageSequenceExpression` around the original, then one `conditionalExpression(mutantTestExpression(id), mutated, previous)` per mutant), and replaces the attribute with a `JSXSpreadAttribute` of that expression. Attribute order is preserved, so later attributes still override earlier ones. Output from the spike [checked: `spikes/design-fable/out/Dialog.instrumented.tsx:109-121`]:

  ```tsx
  <button {...stryMutAct_9fa48("7") ? { type: "submit" } : (stryCov_9fa48("7"), { type: "button" })}
          {...stryMutAct_9fa48("8") ? { onClick: undefined } : (stryCov_9fa48("8"), { onClick: onClose })}
          {...stryMutAct_9fa48("9") ? { "aria-label": "" } : (stryCov_9fa48("9"), { "aria-label": "Close dialog" })}>
  ```

  `key` and `ref` are excluded because React 19 warns when `key` arrives through a spread, and neither is UI-observable.

- **Text site.** `canPlace` accepts a `JSXText` with a letter or digit. `place` converts the original text with Babel's own JSX whitespace cleaning (`types.react.buildChildren` on a synthetic element; Babel 8 keeps it [checked: nested `@babel/types/lib/index.js:8582-8618`]), chains the switch, and replaces the node with a `JSXExpressionContainer`. The spike's baseline render equals the original render for both prop sets, which covers the text nodes `Edit items`, `Save`, `x`, `Help`, `Docs`, `Secret`, `Opened`, `Saving...`, `Idle` [checked: spike output "baseline render identical to original: yes"].

- **Expression sites inside JSX** (`{open && <p/>}`, `{items.map(...)}`) already work with the built-in placer; operators 2 and 9 need nothing.

- **Not needed in v1:** the F.1 container wrap for an expression whose parent is a `JSXElement`. None of the ten operators places a mutant at an element, so the wrap is left out; `JsxTagSwap` would bring it back.

Code growth: 37 mutants turned 1,148 characters into 5,472 (117 per mutant, no subtree duplication) [checked: spike output]. The research F.1 run with element-level placement was 9,570-10,535 characters for 71 mutants with duplicated elements; the real saving is that growth is now linear in mutant count, not in element size.

Type checking: Stryker inserts `// @ts-nocheck` into instrumented files by default (`disableTypeChecks` [checked: `packages/api/schema/stryker-core.json:420-421`]), so `{ "aria-label": "" }` spreads and `onClick: undefined` never meet `tsc`. A project whose build type-checks (not Vite) and disables that option would see errors on the spreads; the plugin README says so.

### 3.4 Enabling and excluding operators

v1 adds **no configuration**. The two StrykerJS mechanisms already reach custom mutator names:

- `mutator: { excludedMutations: ['JsxTextEmpty', 'JsxButtonTypeSwap'] }` (name match in `babel-transformer.ts:275-283` [checked]).
- `// Stryker disable next-line JsxEventHandlerRemoval: parent handles it` and the `disable`/`restore` block forms (names are lower-cased for matching and unknown names warn, so a typo is visible [checked: `directive-bookkeeper.ts`]).

Why no `uiMutators` options object yet: `NodeMutator.mutate(path, context)` receives only `{ isExpressionContext }` [checked: `mutators/node-mutator.ts`], `instrument()` receives only `{ plugins, excludedMutations, ignorers }` and `mutator` is validated with `additionalProperties: false` [checked: schema `mutatorDescriptor`], so a plugin option has no supported path to the mutators. The module exports `strykerValidationSchema = { properties: {} }` so the loader does not warn that the module "did not contribute a StrykerJS plugin" [checked: `plugin-loader.ts:185` warns when neither export exists].

If per-project attribute tables are needed before the upstream change (for example a design system whose `<TextField label="...">` is its accessible name), the supported channel is an `Ignore` plugin exported by the same module: core creates ignorers right before `instrument()` with the full `StrykerOptions` injectable (`PluginContext` has `commonTokens.options` [checked: `packages/api/src/plugin/contexts.ts`]; creation in `2-mutant-instrumenter-executor.ts` [checked]), so a `UiMutatorsConfig` ignorer listed in `ignorers` can copy `options.uiMutators` into the registry before the first file is transformed. The schema then gains `uiMutators` (section 4). This is a v1.1 item, not v1.

### 3.5 How names show in reports

`mutatorName` is copied verbatim from the `NodeMutator.name` into the `Mutant` and into the API mutant (`mutant.ts:toApiMutant` [checked]), which core copies into the mutation-testing report; the HTML report's mutant drawer shows it and the per-mutator filter lists each distinct name, so `JsxEventHandlerRemoval` appears beside `StringLiteral` [inferred from the report format; the name path is checked]. The `replacement` column shows the generated code of the replacement node: `onClick={undefined}`, `aria-label=""`, `""` for text, `<p role="status">Opened</p>` for force-show, `items.slice(0, 1).map(...)` [checked: spike mutant list]. No report change is needed.

### 3.6 The upstream PR to propose later

Mirroring the weapon-regex split (research F.3): the external package owns the operator table (which attributes, which value shapes, which replacements), the instrumenter owns Babel, placement, ids and reporting.

1. `packages/instrumenter/src/mutant-placers/jsx-mutant-placer.ts`: the attribute and text placer from 3.3 as a fourth entry in `allMutantPlacers`, ahead of the expression placer. This is the part that cannot live outside the instrumenter and the only part that touches placement.
2. `packages/instrumenter/src/mutators/jsx-mutators.ts`: `import { jsxOperators } from '@stryker-mutator/jsx-mutators'` (the published operator package, as `weapon-regex` is a dependency in the instrumenter's `package.json`), spread into `allMutators` so each operator keeps its own `mutatorName`. Unlike `regex-mutator.ts`, which collapses weapon-regex's per-mutant names into `Regex` (research F.3), the operators are `NodeMutator`s themselves, so no schema change is needed to keep their names.
3. `ConditionalExpression`: stop yielding `true` for a `&&` whose right operand is JSX (React renders `true` as nothing, a duplicate of `false`), or yield the right operand instead. One-line change plus a snapshot.
4. `NodeMutatorContext` gains `options: MutatorOptions`, and `mutatorDescriptor` gains `jsx: { level, attributes }` so the operator tables are configurable the supported way. This replaces the Ignore-plugin channel of 3.4.
5. Default-on or default-off: the ten operators roughly double the mutant count of a JSX file (26 of 37 in the fixture). Propose them as a named group that is off unless `mutator.jsx` is set, so existing React users see no change; `excludedMutations` alone cannot express "off by default".

The plugin and the upstream version share the operator package unchanged; only `register.ts` and `placement.ts` are replaced by the instrumenter's own placer and import. That is the weapon-regex shape: the library is a pure table, the host owns the AST.

## 4. Data shapes

Erasable TypeScript only (no enums, namespaces, parameter properties). `NodePath` and `types` come from the instrumenter's nested Babel, typed through `@babel/core`.

```ts
import type { NodePath, types as t } from '@babel/core';

/** 1 = killed by locators and actions realistic suites already use; 2 = needs an explicit check of that aspect; 3 = visual or timing only. */
export type OperatorLevel = 1 | 2 | 3;

export type PlaywrightObservable =
  | 'getByRole' | 'getByLabel' | 'getByText' | 'getByAltText' | 'getByPlaceholder'
  | 'action' | 'toBeVisible' | 'toBeHidden' | 'toBeDisabled' | 'toBeEnabled'
  | 'toHaveText' | 'toHaveCount' | 'toHaveURL' | 'toHaveRole' | 'toHaveValue' | 'toMatchAriaSnapshot';

export type UiOperator = {
  /** Reported as mutatorName; letters only (Stryker directive syntax). */
  readonly name: `Jsx${string}`;
  readonly level: OperatorLevel;
  /** Documentation and the verification matrix in section 6, not runtime behaviour. */
  readonly observedBy: readonly PlaywrightObservable[];
  /** Which template syntaxes a port exists or is planned for. 'jsx' for all ten in v1. */
  readonly syntaxes: readonly ('jsx' | 'angular')[];
  /** Same contract as the instrumenter's NodeMutator.mutate, minus the context it never uses. */
  mutate(path: NodePath): Iterable<t.Node>;
};

/** Shape of an attribute value, so the attribute operators branch on a table instead of on node types. */
export type AttributeValueShape = 'bare' | 'string' | 'expression' | 'booleanLiteral' | 'negated' | 'stringExpression';

export type AttributeOperatorName =
  | 'JsxEventHandlerRemoval' | 'JsxAccessibleNameEmpty' | 'JsxDisabledFlip'
  | 'JsxHiddenFlip' | 'JsxRoleRemoval' | 'JsxNavigationTarget' | 'JsxButtonTypeSwap';

/** One row per attribute operator; `matches` and `replace` are the only code, the rest is data. */
export type AttributeRule = {
  readonly operator: AttributeOperatorName;
  readonly level: OperatorLevel;
  /** Attribute names this rule owns, or a predicate for open sets such as /^on[A-Z]/. */
  readonly attributes: ReadonlySet<string> | ((name: string) => boolean);
  /** Value shapes the rule mutates; shapes a built-in mutator already covers are left out here. */
  readonly shapes: ReadonlySet<AttributeValueShape>;
  /** Builds the replacement attributes for one matched attribute. */
  replace(attribute: t.JSXAttribute, shape: AttributeValueShape, value: string | t.Expression | null): Iterable<t.JSXAttribute>;
};

export type UiOperatorRegistry = {
  /** Catalog order = rank in section 2. */
  readonly all: readonly UiOperator[];
  byName(name: string): UiOperator | undefined;
  atLevel(level: OperatorLevel): readonly UiOperator[];
};

/** Reserved for v1.1 (Ignore-plugin channel) and the upstream `mutator.jsx` option. Unused in v1. */
export type UiMutatorsOptions = {
  readonly level?: OperatorLevel;
  /** Extra attribute names per operator, for design-system props (e.g. JsxAccessibleNameEmpty: ['label']). */
  readonly attributes?: Partial<Record<AttributeOperatorName, readonly string[]>>;
};

declare module '@stryker-mutator/api/core' {
  interface StrykerOptions {
    uiMutators?: UiMutatorsOptions;
  }
}
```

How the table drives the attribute operators: a single `attributeMutator(rule)` function turns an `AttributeRule` into a `UiOperator` whose `mutate` checks `path.isJSXAttribute()`, classifies the value into an `AttributeValueShape` once, looks the name up in `rule.attributes`, and calls `rule.replace` when the shape is in `rule.shapes`. The seven rules are seven table rows; the spike's `attributeOperators` array is the untyped version of this table [checked: `spike-jsx-placement.ts`]. Adding `JsxAriaStateFlip` later is one row with `attributes: new Set(['aria-expanded', ...])`, `shapes: {'string', 'expression'}`, and the flip helper operators 5 and 7 share.

## 5. Risks and spikes

Riskiest first. Each row says what a spike would settle; the first row's spike was run for this document.

### 5.1 Attribute- and text-level placement through the live instrumenter (settled by spike)

**Claim.** Wrapping the installed expression placer's `canPlace`/`place` so `JSXAttribute` and `JSXText` are placement sites yields valid TSX, no element duplication, and every mutant changes what React renders (or which handler props are bound) when activated through `globalThis.__stryker__.activeMutant`, while the baseline render equals the uninstrumented component.

**Spike.** `spikes/design-fable/spike-jsx-placement.ts`: pushes spike-sized versions of all ten operators into `allMutators` of the installed `@stryker-mutator/instrumenter@10.1.1` (resolved through `@stryker-mutator/core`'s location), wraps the placer, instruments `spikes/design-fable/Dialog.tsx`, compiles both the original and the instrumented TSX with the instrumenter's nested Babel 8 (`preset-typescript` + `preset-react` automatic runtime), imports both, and renders with `react-dom/server` (`renderToStaticMarkup`) under two prop sets. Handler removal is not visible in static markup, so a second probe walks the element tree returned by calling `Dialog(props)` (the fixture has no hooks) and lists `on*` props. The instrumented namespace object is created before import and only its `activeMutant` field is changed, because the header caches the namespace object on first call [checked: `util/syntax-helpers.ts` header, `retrieveNS`].

**Command and result** [checked]:

```
node D:/projects/sandbox/stryker-playwright-runner/spikes/design-fable/spike-jsx-placement.ts
```

```
mutants: 37 total, 26 from UI operators
  L22 JsxEventHandlerRemoval -> onSubmit={undefined}
  L23 JsxTextEmpty -> ""
  L24 JsxButtonTypeSwap -> type="submit"
  L24 JsxEventHandlerRemoval -> onClick={undefined}
  L24 JsxAccessibleNameEmpty -> aria-label=""
  L24 JsxTextEmpty -> ""
  L27 JsxButtonTypeSwap -> type="button"
  L27 JsxDisabledFlip -> disabled={!busy}
  L27 JsxTextEmpty -> ""
  L30 JsxAccessibleNameEmpty -> placeholder=""
  L30 JsxDisabledFlip -> readOnly={!busy}
  L31 JsxRoleRemoval -> role={undefined}
  L32 JsxConditionalRender -> <p role="status">Opened</p>
  L32 JsxRoleRemoval -> role={undefined}
  L32 JsxTextEmpty -> ""
  L33 JsxConditionalRender -> <span>Saving...</span>
  L33 JsxConditionalRender -> <span>Idle</span>
  L33 JsxTextEmpty -> ""
  L33 JsxTextEmpty -> ""
  L36 JsxListTruncate -> items.slice(0, 1).map(i => <li key={i}>{i}</li>)
  L40 JsxNavigationTarget -> to="#"
  L40 JsxTextEmpty -> ""
  L41 JsxNavigationTarget -> href="#"
  L41 JsxTextEmpty -> ""
  L42 JsxHiddenFlip -> hidden={false}
  L42 JsxTextEmpty -> ""
instrumented size 5472 chars (original 1148); contains JSXSpreadAttribute placement: true
baseline render identical to original: yes (both prop sets)
UI mutants that change the render or a handler prop when active: 26/26
spot checks: 10 DOM effects + onClick removal all as intended
```

Exit code 0; full output in `spikes/design-fable/spike-output.txt`. The spot checks assert the exact DOM per operator (`<h1></h1>`, `aria-label=""`, `disabled=""` on the submit button when `busy` is false, `<p>Secret</p>` shown, no `role="dialog"`, `href="#"` for both link forms, `type="button"` on Save, `role="status"` shown with `open` false, one `<li>`) and `button.onClick=undefined` in the element tree.

**What the spike also found.** The first run produced `hidden={!!open}` and `aria-hidden={!!open}` next to the built-in `BooleanLiteral` mutant `hidden={open}`; the flip operators now skip `!`-prefixed values (operator 5). The first run's compile also failed on Babel 8 removing `preset-typescript`'s `allExtensions`/`isTSX`; the file extension drives TSX parsing now. Neither affects the design.

**Not settled by this spike.** Rendering used Babel's JSX transform; the demo app builds with Vite 8 (oxc). Spread attributes are plain JSX, so the transform difference is not expected to matter [inferred], and 5.2 covers it.

### 5.2 Vite/oxc build of the instrumented TSX and runtime activation in a browser

**Risk.** The demo app's build (Vite 8.3.5, Nx 24) might reject or mis-compile the spread/conditional output, or React's dev-mode warnings (`key` in spread, unknown props) might fail a CT test. **Spike.** Run `stryker.ct.config.ts` with the plugin listed in `plugins` against `apps/demo-app` (`price-tag.tsx` already has 27 built-in mutants, VERDICT evidence table) and read the dry run: it must stay green with the new mutants present. One Stryker run; the runner already exists.

### 5.3 Duplicate or bundled instrumenter

**Risk.** A project with two instrumenter copies (hoisting conflict, pnpm) or a bundled Stryker registers the mutators on the wrong copy; silent zero custom mutants. **Mitigation in the design.** Resolve through core's location and run the import-time self-check (3.2 step 5), which turns the silent case into a load error. **Spike.** A workspace with `@stryker-mutator/instrumenter` installed at two versions (one nested under core) and the plugin resolving the nested one; assert the self-check passes and the top-level copy stays untouched. Half a day, synthetic workspace.

### 5.4 Mutant count and run time

**Risk.** Ten operators add about as many mutants as all built-ins on JSX-heavy files (26 vs 11 on the fixture). With about 2.7 s fixed cost per mutant run (VERDICT), a 300-mutant React app becomes a 600-mutant run. **Mitigation.** Per-test coverage from the runner limits each mutant to the tests that render the element; `JsxTextEmpty` is the volume driver and is the first candidate for `excludedMutations` or a level-2 demotion if it mostly produces trivially-killed mutants. **Spike.** The 5.2 run reports counts per operator and kill rate per operator; decide levels from that data, not from this document.

### 5.5 Equivalent-mutant rate per operator

**Risk.** Section 2 reasons about equivalence; the real rates come from running against a suite. Candidates for surprise: `JsxConditionalRender` on lists (empty `<ul>` invisible), `JsxEventHandlerRemoval` on components that ignore the prop, `JsxButtonTypeSwap` `reset -> button`. **Spike.** Same 5.2 run; triage every survivor by hand once (the demo app is small), tag equivalent vs. untested, and record the per-operator split in `VERDICT.md`-style evidence.

### 5.6 Instrumenter internals drift across StrykerJS releases

**Risk.** The three deep imports and two placer methods have no compatibility promise. StrykerJS shipped four majors between 2023-06 and 2026-08 (research 3.3). **Mitigation.** Exact-minor peer range, runtime version warning, and the self-check that fails loudly; the upstream PR (3.6) removes the risk for good. No spike: this is a maintenance policy.

### 5.7 Text cleaning edge cases

**Risk.** `JSXText` whitespace rules (multi-line text, entities like `&nbsp;`, text next to expression containers) could render differently from the original once converted to a string literal. **Mitigation.** The placer uses Babel's own `buildChildren` cleaning, i.e. the same function Babel's JSX transform applies; HTML entities are already decoded in `JSXText.value` by the parser. **Spike.** Extend the Node test in 6.1 with a fixture of multi-line text, entities and mixed children and assert baseline render equality; one hour.

## 6. Verification plan

Two test layers in `packages/stryker-ui-mutators/test/`, both `node --test` like `packages/stryker-playwright-runner/test/runner.test.ts` [checked: that file's structure: `before` instruments a fixture with `Instrumenter`, writes the instrumented file into `fixture/public`, starts the runner, then each `test` looks up a mutant by `(mutatorName, replacement)` and runs it with `testFilter: [testId(title)]` and asserts the `MutantRunStatus`].

### 6.1 Node only: the operators generate the intended mutants (fast, runs on every change)

`test/operators.test.ts`, the spike turned into assertions:

- `before`: import the plugin entry (`../src/index.ts`, which registers into the resolved instrumenter), instrument `test/fixture/src/Dialog.tsx` (the spike fixture plus the edge cases from 5.7 and one `// Stryker disable next-line JsxTextEmpty` line).
- `test('generates exactly the catalog mutants')`: compare `mutants.filter(ui).map(m => [m.mutatorName, line, m.replacement])` to a literal table in the test file (the 26 rows of the spike output, plus the edge-case rows). A changed operator must change the table: that is the review signal.
- `test('generates no mutant a built-in also generates')`: assert no two mutants share `(location, replacement)`.
- `test('honours excludedMutations and Stryker directives')`: instrument again with `excludedMutations: ['JsxTextEmpty']` and assert those mutants carry `status: 'Ignored'`; assert the directive line's mutant is ignored with the comment's reason.
- `test('baseline render equals the original')` and `test('every mutant changes the render or a handler prop')`: the spike's render loop over two prop sets, using the instrumenter's nested Babel to compile and `react-dom/server` to render.
- `test('self-check fails on a foreign instrumenter')`: call `register(resolvedDir)` with a directory holding a stub `mutate.js` whose array is not the one `Instrumenter` reads; assert it throws naming the path.

### 6.2 Browser: a Playwright test kills each operator's mutant through the runner

`test/playwright.test.ts`, the runner test pattern with a React fixture:

- Fixture app: `test/fixture/` with `src/Dialog.tsx` (as above), `src/main.tsx` mounting `<Dialog open busy={false} items={['a', 'b']} onClose=... onSave=...>` with the state transitions the tests need (a trigger button that sets `open`, a save handler that writes "Saved" and navigates to `/done`), `index.html`, and a `vite.config.ts`. `before` instruments `Dialog.tsx` with the plugin registered, writes the instrumented file into `src/`, runs `vite.build()` programmatically into `public/`, then serves `public/` with the runner fixture's `serve.ts` approach and starts `PlaywrightTestRunner` with `fixture/playwright.config.ts` (`timeoutMS` at least twice the expect timeout, VERDICT).
- Spec `tests/dialog.spec.ts`: one test per operator, titled after it, each using only the observable from section 2:

| Test title | Playwright steps | Kills |
|---|---|---|
| `JsxEventHandlerRemoval` | `getByRole('button', { name: 'Close dialog' }).click()`; `expect(getByRole('dialog')).toBeHidden()` | `onClick={undefined}` |
| `JsxConditionalRender` | `expect(getByRole('status')).toBeHidden()` before opening; `.toBeVisible()` after | `<p role="status">Opened</p>` and the ternary branches via `getByText('Idle')` |
| `JsxTextEmpty` | `expect(getByRole('heading', { name: 'Edit items' })).toBeVisible()` | `""` on the h1 |
| `JsxAccessibleNameEmpty` | `getByRole('button', { name: 'Close dialog' })` is found; `getByPlaceholder('Search').fill('x')` | `aria-label=""`, `placeholder=""` |
| `JsxDisabledFlip` | `getByRole('button', { name: 'Save' }).click()`; `expect(getByText('Saved')).toBeVisible()` | `disabled={!busy}` (click times out) |
| `JsxNavigationTarget` | `getByRole('link', { name: 'Help' }).click()`; `expect(page).toHaveURL(/\/help$/)` | `to="#"`, `href="#"` |
| `JsxHiddenFlip` | `expect(getByText('Secret')).toBeHidden()` | `hidden={false}` |
| `JsxRoleRemoval` | open, then `expect(getByRole('dialog')).toBeVisible()` | `role={undefined}` |
| `JsxListTruncate` | `expect(getByRole('listitem')).toHaveCount(2)` | `items.slice(0, 1).map(...)` |
| `JsxButtonTypeSwap` | Save click then `toHaveURL(/\/done$/)` | `type="button"` on Save (no submit) |

- Assertions per operator, in the runner test style: `mutantRun(mutant('JsxTextEmpty', '""'), { testFilter: [testId('JsxTextEmpty')] })` has `status === MutantRunStatus.Killed`; a control run of the same mutant with the `testFilter` set to an unrelated test (`JsxListTruncate`'s) is `Survived`, which proves the kill comes from the named observable and not from a crash. One dry-run test asserts all operator tests pass on the baseline and that `mutantCoverage.perTest` for each test includes its own mutant (the spread placement carries `stryCov` calls, 3.3).
- Budget: about 20 mutant runs at roughly 3-5 s each (VERDICT: 2.7 s fixed plus the test, kills wait out the expect timeout) is under two minutes; run in CI, not on every save.

### 6.3 Real project evidence (manual, once per release)

Add the plugin to `stryker.ct.config.ts` and `stryker.e2e.config.ts` and rerun the two VERDICT rows (`price-tag.tsx` CT, `cart.ts` e2e). Record per-operator counts, killed/survived/timeout, and the triage of survivors (5.5) in a new table in `VERDICT.md`. This is the number that decides operator levels for v1.1, not the fixture.
