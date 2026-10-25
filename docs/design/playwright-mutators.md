# Design: UI mutation operators that Playwright tests can kill

Status: chosen design, 2026-10-25, by Claude during an AFK run. Not built yet. Lars approved the
operator and mutation names in Names, without a namespace prefix, on 2026-10-25 ("2-3: Approve").

## Why

StrykerJS 10.1.1 mutates expressions. It leaves the parts of a component that Playwright tests look at
untouched: JSX text, plain attribute strings such as `aria-label`, `role`, `href`, and `data-testid`,
bare `hidden` and `disabled`, and event props that point at a named handler
(`docs/research/playwright-mutation-operators.md`, section 2). A suite that finds elements by role,
label, and text can be strong and still look weak, or weak and look strong, because Stryker never makes
those changes. These operators make them.

## How this design was chosen

Two designers worked independently from the same research and brief, on different models:
`docs/design/playwright-mutators-opus.md` and `docs/design/playwright-mutators-fable.md`. Both spikes
rerun clean from `spikes/` (commands below). They agree on the top operators and on the integration
route. Two independent designs that agree count for more than either draft alone. This design takes the
Opus draft as the base and grafts five parts of the Fable draft.

| Question | Opus draft | Fable draft | Taken |
|---|---|---|---|
| Attribute placement | switch inside the attribute value: `aria-label={c ? "" : "Close"}` | the attribute becomes a spread object `{...c ? {...} : {...}}` | Opus: smaller output, React sees the same props, no `key`/`ref` exception, handles `&amp;` |
| Emptied text | `null`, identical render to the original | `""` | Opus |
| Element-level mutants (tag swap) | yes, with the JSX child wrap | none in v1 | Opus (`ElementRole` can swap a tag) |
| Conditional with a comparison or logical test | no skip, so it repeats the built-in `ConditionalExpression` mutants | skips the test shapes that `ConditionalExpression` already forces (`builtInForcesTrue`) | Fable |
| Silent plugin failure | warning only | import-time self-check that throws | Fable, moved to an `Ignore` plugin factory (see Integration) |
| Version drift | peer pinned to `10.1.1` exactly | peer `~10.1.0` plus a runtime warning | Fable |
| Upstream fixes found | JSX comment directives are ignored for every mutator | built-in `ConditionalExpression` makes a duplicate `true` mutant for JSX `&&` | both |
| Names | framework-neutral (`TextContent`) | `Jsx` prefix | neither: renamed to the StrykerJS convention, still framework-neutral (see Names) |

## Operators in the first release

Ranked by how often realistic Playwright suites would kill them. Full patterns, examples and skip rules
are in the Opus draft, section 2. Where this list differs from the draft, this list wins.

1. `TextLiteral`: empties JSX text that has a letter or digit. Killed by `getByText`, `getByRole({ name })`, `toHaveText`.
2. `LabelAttribute`: empties `aria-label`, `aria-labelledby`, `alt`, `title`, `placeholder`, and `htmlFor`, whether the value is a string or a bound expression (`alt={username}`). A template literal is left to the built-in `StringLiteral`, which already empties it. Killed by `getByLabel`, `getByRole({ name })`, `getByPlaceholder`, `getByAltText`.
3. `EventHandler`: `onX={handler}` becomes `onX={undefined}` when the handler is not inline, so the operator never repeats the built-in `ArrowFunction` mutant. It also skips a handler that is a function declared in the same file (a function declaration, or a `const` whose initializer is a function or an arrow) when this attribute is the handler's only reference. Babel's scope binding gives that reference count. Killed by the assertion after a `click` or `fill`.
4. `ConditionalElement`: forces `x && <A/>` to render, and forces each branch of a JSX ternary. It skips a shape when the `&&` left operand, or the ternary test, is a `BinaryExpression` with `==`, `!=`, `===`, `!==`, `<`, `<=`, `>`, or `>=`, or a `LogicalExpression` with `&&` or `||`. For those shapes the built-in `ConditionalExpression` already makes the same mutants: `true` for the left operand of `&&`, which renders the element, and `true` and `false` for a ternary test, which force each branch. So `{open && <p/>}` and `{busy ? <A/> : <B/>}` get operator mutants, and `{off > 0 && <s/>}` and `{n > 1 ? <A/> : <B/>}` get none. Killed by `toBeVisible`, `toHaveCount(0)`.
5. `UrlAttribute`: `href`, `to`, and `action` become `""`, from a string or a bound expression; a template literal is left to `StringLiteral`, as for `LabelAttribute`. Killed by `toHaveURL`.
6. `DisabledAttribute`: forces `disabled`, `readOnly`, and `aria-disabled` off, and skips shapes that `BooleanLiteral` already flips. Killed by `toBeDisabled`, `toBeEditable`.
7. `HiddenAttribute`: forces `hidden` and `aria-hidden` off. It never forces an element hidden. Killed by `toBeVisible`, `getByRole` (hidden elements leave the tree).
8. `ElementRole`: removes `role`, or swaps a semantic tag for `span`: `button` always, and `a` only when it has an `href`. An `<a>` without `href` has no `link` role, so swapping it would be an equivalent mutant. Killed by `getByRole`.
9. `ChildExpression`: a `{value}` child becomes `null`. Killed by `toHaveText`.
10. `StateAttribute`: flips `aria-expanded`, `aria-pressed`, `aria-checked`, `aria-selected`. Killed by `toHaveAttribute` and role queries with state options.

Later: `ListExpression` (`.map` becomes `.slice(0, 1).map`, from the Fable draft), button `type` swap, Angular
templates, and CSS. Each waits for a reason given in the drafts' "later" sections.

## Names

Lars, 2026-10-25: "Align with names of 1st-party StrykerJS and weapon-regex mutation operators", and
"You may also seek inspiration in Stryker .NET and Scala". Claude read the names in the local clones:
StrykerJS `v10.1.1` (`packages/instrumenter/src/mutators/`), weapon-regex `v2.0.6`
(`core/src/main/scala/weaponregex/internal/mutator/`), Stryker.NET (`src/Stryker.Abstractions/Mutator.cs`)
and stryker4s (`modules/core/src/main/scala/stryker4s/mutation/`), both at their current heads.

- **Operator names follow StrykerJS.** A StrykerJS mutator name is the kind of syntax it changes, then
  the syntax category: `ArithmeticOperator`, `EqualityOperator`, `BooleanLiteral`, `StringLiteral`,
  `ConditionalExpression`, `BlockStatement`, `ArrowFunction`. stryker4s uses the same names, and
  Stryker.NET uses the short forms (`Equality`, `String`, `Statement`). The operator name is what users
  write in `mutator.excludedMutations` and `// Stryker disable`, and what reports show as `mutatorName`.
  The UI operators keep that shape with markup categories that fit JSX and Angular templates alike:
  `Literal` for static text, `Attribute`, `Element`, `Expression`, and `Handler`. StrykerJS groups one
  syntax by meaning (equality, logical and arithmetic operators are all binary expressions), so the
  attribute operators are grouped by what the attribute does.
- **Mutation names follow weapon-regex.** A weapon-regex mutation name is the construct, then the change:
  `QuantifierRemoval`, `CharClassNegation`, and `GroupToNCGroup` for "X to Y". StrykerJS reports only the
  operator name (the built-in `Regex` mutator reports weapon-regex's mutations as `Regex`), so these names
  appear in docs, tests and the operator table that upstreaming would add (see Upstream path), not in
  `mutatorName`.

| Operator | Mutations | Earlier name (drafts, spike) |
|---|---|---|
| `TextLiteral` | `TextRemoval` | `TextContent` |
| `LabelAttribute` | `LabelRemoval` | `AccessibleName` |
| `EventHandler` | `EventHandlerRemoval` | `EventHandler` |
| `ConditionalElement` | `ConditionalGuardRemoval` (`x && <A/>` to `<A/>`), `ConditionalToConsequent`, `ConditionalToAlternate` | `ConditionalRendering` |
| `UrlAttribute` | `UrlRemoval` | `NavigationTarget` |
| `DisabledAttribute` | `DisabledRemoval` | `DisabledState` |
| `HiddenAttribute` | `HiddenRemoval` | `HiddenState` |
| `ElementRole` | `RoleRemoval`, `ElementToSpan` | `Role` |
| `ChildExpression` | `ChildExpressionRemoval` | `ChildExpression` |
| `StateAttribute` | `StateNegation` | `AriaState` |
| `ListExpression` (later) | `ListTruncation` | `ListTruncate` |

Every name is letters only, because a `// Stryker disable` comment accepts only letters in mutator names,
and StrykerJS matches those names against every registered mutator ignoring case
(`directive-bookkeeper.ts:63` and `:73`). The names carry no namespace prefix, like the built-ins they
sit next to, and like the upstream route would need. The install therefore refuses an operator whose
name equals, ignoring case, a mutator that is already registered, so a future built-in with the same
name fails the run loudly instead of sharing a filter key.

Two names do not fit the pattern exactly, the way StrykerJS's `ConditionalExpression` also mutates `if`
tests and loops. `DisabledAttribute` also covers `readOnly`, and `ElementRole` changes either the `role`
attribute or the tag that gives an element its implicit role.

## Rules the synthetic cases settled

`spikes/ui-mutator-cases/` holds 93 synthetic cases: JSX versions of UI shapes in the repos the runner was
exercised on (RealWorld, ngx-yeti, Analog and hello-world at the commits `oss/README.md` names, and the demo
app), each with the exact UI mutants it must give. They run against the prototype. The design was silent on
these points; Claude settled them on 2026-10-25 from the prototype's behaviour and the Opus draft:

- `LabelAttribute` takes bound values, as the Opus draft's rule did (2.2); the earlier "plain-string"
  wording here narrowed it without a reason, and no built-in mutant empties a bound label.
- `HiddenAttribute` skips a boolean-literal value, as `DisabledAttribute` does, because `BooleanLiteral`
  already flips it.
- Forcing an attribute off removes a string or bare value (`disabled={undefined}`) and sets an expression to
  `{false}`; both give the same accessibility tree as `"false"`. `RoleRemoval` prints `role={undefined}`.
- `ChildExpression` empties an identifier, a member expression, an optional chain, or a call, and skips a
  string literal, a conditional (left to `ConditionalElement`), and a `.map`, `.filter` or `.flatMap` list,
  which the later `ListExpression` owns. Until then a rendered list gets no UI mutant of its own.
- `EventHandler` applies to an `onX` prop on a component as well as on an element.
- `ConditionalElement` forces branches of a ternary rendered as a JSX child only, not a ternary inside an
  attribute value (`href={last ? null : '/replay'}`).

The prototype also matches `formAction`, `inert`, `aria-current`, `aria-invalid` and `checked`, which this
design does not list; they stay out of the first release.

The Opus prototype (`spikes/design-opus/ui-mutators.ts`) and both drafts use the earlier names. The
prototype also predates four of the rules above: the `ConditionalElement` comparison and logical skip, the
`ConditionalElement` limit to JSX children, the `EventHandler` single-reference skip, and the `href`
condition on the `a` swap. The synthetic cases that test them run as `todo`. Its counts in `neutral-output.txt`
therefore include one `ConditionalRendering` (now `ConditionalElement`) mutant on
`price-tag.tsx` line 22 (`off > 0 && (...)`) that the skip removes. With the skip, the demo's
`price-tag.tsx` gets 2 UI mutants instead of 3, and `app.tsx` stays at 15. The verification plan's
must-not-generate rows (Opus draft, section 6.1) gain `n > 0 && <A/>`, `a === b ? <A/> : <B/>`, a
handler referenced once, and `<a>x</a>` without `href`.

## Equivalent mutants

Some operator mutants behave the same as a mutant StrykerJS or the source already gives. The skips above
remove the cases that are cheap to detect. These remain:

- `EventHandler` on a handler that the skip does not catch can still match the built-in `BlockStatement`
  mutant, which empties the handler's body. A click does nothing in both, and for `onSubmit` both let
  the native submit through. The two differ only when the handler is shared or a parent handler relies
  on the event bubbling. Examples are a handler imported from another file, or a handler passed in
  through props and emptied in the parent's file.
- `ConditionalElement` on an empty list renders an empty `<ul>`, which Playwright reports as not
  visible. The mutant is not equivalent, but `toBeHidden` does not kill it. `toHaveCount(0)` on the items
  does.

## Integration

- **Package.** `@layzeedk/stryker-ui-mutators`. The user lists it in `plugins` and lists its ignorer in
  `ignorers` (see "Fail loud"). No other options in v1. Users exclude operators with
  `mutator.excludedMutations` and with `// Stryker disable` comments, both of which already match custom
  mutator names.
- **Version range.** Peer dependency `@stryker-mutator/core` `~10.1.0`. At run time the plugin reads the
  version of the instrumenter it resolved. A version other than `10.1.1`, the tested one, logs a warning
  and the install goes on. The self-check, not the version, decides whether the run may continue. The
  prototype throws on any other version. The plugin will warn instead.
- **Registration without an upstream change.** On import, the plugin finds the instrumenter that
  `@stryker-mutator/core` will use (resolved from core's own folder), pushes its mutators into the live
  `allMutators` array, and wraps `expressionMutantPlacer.canPlace` and `place` so that `JSXAttribute` and
  `JSXText` become placement sites. Details: Opus draft, sections 3.2 and 3.3.
- **Fail loud.** Still at import, the plugin instruments a one-line JSX sample and checks that its
  mutants come back. Core turns a plugin import error into a warning and runs on without the mutators
  (`packages/core/src/di/plugin-loader.ts:193-209`), so throwing at import is not enough. The plugin
  therefore keeps any install or self-check error and exports an `Ignore` plugin named `ui-mutators`.
  Core creates every ignorer listed in `ignorers` right before `instrument()`
  (`2-mutant-instrumenter-executor.ts:67-69`), with no catch, so an error thrown from that factory stops
  the run. The factory throws the kept error, or an "install did not run" error when the install was
  skipped. Otherwise it returns an ignorer that ignores nothing. This route is not spiked yet.
- **The `ignorers` entry is required.** `ignorers` defaults to `[]`
  (`packages/api/schema/stryker-core.json:509-516`), and core creates only the listed names. The
  documented config therefore always has `ignorers: ['ui-mutators']` next to the `plugins` entry.
  Without it, a successful install still registers and runs every operator, because registration
  happens at import. A failed install falls back to core's warning
  `Error during loading "@layzeedk/stryker-ui-mutators" plugin`, and the run finishes without UI mutants. The
  plugin cannot detect the missing entry in that case, because the code that would check is the code
  that failed.
- **Options, later.** A plugin module can export `strykerValidationSchema`, so options such as extra
  accessible-name props validate against the Stryker config. Mutators still cannot read them at run
  time, because `NodeMutatorContext` carries only `isExpressionContext`. The `ui-mutators` ignorer
  factory receives the full options before `instrument()` and is the hook that can pass them on.
- **Process placement.** Exporting `strykerPlugins` puts the module into `pluginModulePaths`
  (`plugin-loader.ts:83-86`). Every test-runner and checker worker re-imports those modules
  (`child-process-proxy-worker.ts:97-100`, passed by both proxies in `child-process-proxy.ts:104,139`).
  Workers never instrument, so the plugin skips the install and the self-check when
  `STRYKER_MUTATOR_WORKER` is set, which core sets for every child process (`child-process-proxy.ts:83`).
  The module still exports the ignorer there, and core never calls its factory in a worker. Reason for
  this option: it keeps one module and one config entry and removes all worker cost, while a second
  module would add a `plugins` entry users can also forget. If Stryker itself runs inside a Stryker
  worker, for example a mutation run of a test that starts Stryker, the inner main process inherits the
  variable. The ignorer then throws the "install did not run" error, so the run stops instead of
  silently losing UI mutants.
- **Reports.** Each operator keeps its own `mutatorName`, so reports and filters show `TextLiteral` next
  to `StringLiteral`.

Claude read the call sites cited in this section in the StrykerJS `v10.1.1` tag
(`git show v10.1.1:<path>` in `D:/projects/github/stryker-mutator/stryker-js`).

## Upstream path

Three PRs to `@stryker-mutator/instrumenter`, smallest first, in the shape weapon-regex already set: the
instrumenter owns Babel, placement, ids and reports, and the operator rules live in a table.

1. Neutral fixes: a JSX placer for attributes and text, the JSX child wrap, `{/* Stryker disable */}`
   support inside JSX, and no `true` mutant for a JSX `&&`.
2. The operators, off by default, enabled by a new `mutator.includedMutations` option.
3. The operator table as its own package, when Angular template support starts.

## Risks that remain

Nothing in this design has gone through `stryker run` with a browser yet. The Opus spike is the only
evidence for the chosen placement: 61 mutants, 48 of them from UI operators, re-parse and render in
React like the hand-made mutation, with an equal baseline. The Fable spike shows that UI operators
change the render (26 of 26), but it used the rejected spread placement and a different operator set,
so it supports the operators and not the placement. Neither spike proves that Vite builds the
instrumented TSX or that a Playwright test kills its mutants. The first build step is the verification
plan in the Opus draft, section 6: a fixture per operator through
`packages/stryker-playwright-runner/test/runner.test.ts`, then the demo app.

The self-check instruments through the instrumenter the plugin resolved and imported itself. That is the
plugin's own module instance, so the check cannot see a mismatch with the instance that core imports.
It catches a broken install of the resolved copy, and it names a second copy only through the version
and path in its message. The gate is a real `stryker run` through core with `testRunner: 'command'` and
no browser, asserting that `mutation.json` lists the operator names (Opus draft, section 5, risk 3). Run
it before calling the self-check enough, and on every StrykerJS bump.

## Rerun the evidence

```sh
node spikes/design-opus/spike.ts
MODE=patched node spikes/design-opus/neutral.ts
MODE=ui node spikes/design-opus/neutral.ts
node spikes/design-opus/directive.ts
node spikes/design-fable/spike-jsx-placement.ts
node --test spikes/ui-mutator-cases/cases.test.ts
```

`MODE=patched` shows that the placer patch leaves built-in mutants unchanged, and `MODE=ui` prints the
per-operator counts. Compare both with the committed `neutral-output.txt`. Without `MODE`, `neutral.ts`
runs the stock instrumenter only and proves nothing about the patch.
