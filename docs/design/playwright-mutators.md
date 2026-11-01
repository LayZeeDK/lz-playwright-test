# Design: UI mutation operators that Playwright tests can kill

Status: chosen design, 2026-10-25, by Claude during an AFK run. Built on 2026-10-26 as
`packages/lz-stryker-ui-mutators`. Lars approved the operator and mutation names in Names, without a
namespace prefix, on 2026-10-25 ("2-3: Approve").

## Why

StrykerJS 10.1.1 mutates expressions. It leaves the parts of a component that Playwright tests look at
untouched: JSX text, plain attribute strings such as `aria-label`, `role`, and `href`, bare `hidden`
and `disabled`, and event props that point at a named handler
(`docs/research/playwright-mutation-operators.md`, section 2). A suite that finds elements by role,
label, and text can be strong and still look weak, or weak and look strong, because Stryker never makes
those changes. These operators make them. They never change `className`, `style`, `data-testid`, or
`key`. A changed `data-testid` tests the test's own hook, not the app (the research's "Candidate
operator inventory", row 22).

## How this design was chosen

Two designers worked independently from the same research and brief, on different models:
`docs/design/playwright-mutators-opus.md` and `docs/design/playwright-mutators-fable.md`. Both spikes
rerun clean from `spikes/` (commands below). They agree on the top operators and on the integration
route. Two independent designs that agree count for more than either draft alone. This design takes the
Opus draft as the base. From the Fable draft it takes the three rows marked Fable below and its upstream
fix, and it keeps the Fable `ListExpression` for Later.

| Question                                      | Opus draft                                                          | Fable draft                                                                             | Taken                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Attribute placement                           | switch inside the attribute value: `aria-label={c ? "" : "Close"}`  | the attribute becomes a spread object `{...c ? {...} : {...}}`                          | Opus: smaller output, React sees the same props, no `key`/`ref` exception, handles `&amp;` |
| Emptied text                                  | `null`, identical render to the original                            | `""`                                                                                    | Opus                                                                                       |
| Element-level mutants (tag swap)              | yes, with the JSX child wrap                                        | none in v1                                                                              | Opus (`LzElementRole` can swap a tag)                                                      |
| Conditional with a comparison or logical test | no skip, so it repeats the built-in `ConditionalExpression` mutants | skips the test shapes that `ConditionalExpression` already forces (`builtInForcesTrue`) | Fable                                                                                      |
| Silent plugin failure                         | warning only                                                        | import-time self-check that throws                                                      | Fable, moved to an `Ignore` plugin factory (see Integration)                               |
| Version drift                                 | peer pinned to `10.1.1` exactly                                     | peer `~10.1.0` plus a runtime warning                                                   | Fable                                                                                      |
| Upstream fixes found                          | JSX comment directives are ignored for every mutator                | built-in `ConditionalExpression` makes a duplicate `true` mutant for JSX `&&`           | both                                                                                       |
| Names                                         | framework-neutral (`TextContent`)                                   | `Jsx` prefix                                                                            | neither: renamed to the StrykerJS convention, still framework-neutral (see Names)          |

## Operators in the first release

Ranked by how often realistic Playwright suites would kill them. Full patterns, examples and skip rules
are in the Opus draft, section 2. Where this list differs from the draft, this list wins.

1. `LzTextLiteral`: empties JSX text that has a letter or digit. Killed by `getByText`, `getByRole({ name })`, `toHaveText`.
2. `LzLabelAttribute`: empties `aria-label`, `aria-labelledby`, `alt`, `title`, `placeholder`, and `htmlFor`, whether the value is a string or a bound expression (`alt={username}`). A template literal is left to the built-in `StringLiteral`, which already empties it. Killed by `getByLabel`, `getByRole({ name })`, `getByPlaceholder`, `getByAltText`.
3. `LzEventHandler`: `onX={handler}` becomes `onX={undefined}` when the handler is not inline, so the operator never repeats the built-in `ArrowFunction` mutant. It also skips a handler that is a function declared in the same file (a function declaration, or a `const` whose initializer is a function or an arrow) when this attribute is the handler's only reference. Babel's scope binding gives that reference count. Killed by the assertion after a `click` or `fill`.
4. `LzConditionalElement`: forces `x && <A/>` to render, and forces each branch of a JSX ternary. It skips a shape when the `&&` left operand, or the ternary test, is a `BinaryExpression` with `==`, `!=`, `===`, `!==`, `<`, `<=`, `>`, or `>=`, or a `LogicalExpression` with `&&` or `||`. For those shapes the built-in `ConditionalExpression` already makes the same mutants: `true` for the left operand of `&&`, which renders the element, and `true` and `false` for a ternary test, which force each branch. So `{open && <p/>}` and `{busy ? <A/> : <B/>}` get operator mutants, and `{off > 0 && <s/>}` and `{n > 1 ? <A/> : <B/>}` get none. Killed by `toBeVisible`, `toHaveCount(0)`.
5. `LzUrlAttribute`: `href`, `to`, and `action` become `""`, from a string or a bound expression; a template literal is left to `StringLiteral`, as for `LzLabelAttribute`. Killed by `toHaveURL`.
6. `LzDisabledAttribute`: forces `disabled`, `readOnly`, and `aria-disabled` off, and skips boolean-literal values (`disabled={true}`), which `BooleanLiteral` already flips. It also skips a value that is a comparison or a `&&`/`||` expression, the shapes `LzConditionalElement` skips, because the built-in `ConditionalExpression` already sets it to `false`: `disabled={form.invalid || form.pending}` and `readOnly={n > 0}` get no operator mutant. Killed by `toBeDisabled`, `toBeEditable`.
7. `LzHiddenAttribute`: forces `hidden` and `aria-hidden` off. It never forces an element hidden. Like `LzDisabledAttribute`, it skips a comparison or `&&`/`||` value (`hidden={a !== b}`), which the built-in `ConditionalExpression` already sets to `false`. It skips `aria-hidden` on `svg`, `img`, and `i`, as the Opus draft did (2.7): those are decorative icons, and exposing one changes nothing a role, label, or text query sees. Killed by `toBeVisible`, `getByRole` (hidden elements leave the tree).
8. `LzElementRole`: removes `role`, or swaps a tag for `span` when Playwright's role table gives it the role `button` or `link`: `button` always, and `a` and `area` only when they have an `href`. An `<a>` without `href` has no `link` role, so swapping it would be an equivalent mutant. The `span` drops every attribute of `a`, `area`, and `button` that a `span` cannot take, such as `href`, `type`, `disabled`, and `alt` (see "Rules the synthetic cases settled"). Killed by `getByRole`.
9. `LzChildExpression`: a `{value}` child becomes `null`. Killed by `toHaveText`.
10. `LzStateAttribute`: flips `aria-expanded`, `aria-pressed`, `aria-checked`, `aria-selected`. A string value flips between `"true"` and `"false"`, and an expression is negated, except where negating would give a constant: a ternary flips each branch instead, and a `String()` or `.toString()` call gets no mutant (see "Rules the synthetic cases settled"). A comparison gets no negation, because the built-in `EqualityOperator` already gives it (`tab === current` becomes `tab !== current`). A `!x` value is negated to `!!x`: the built-in `BooleanLiteral` mutant `x` renders the same state only when `x` is a boolean. With `count` 3, `aria-checked={!count}` renders `"false"`; the built-in mutant `aria-checked={count}` renders `"3"`, which Playwright also reads as not checked, while `!!count` renders `"true"`. A mutator sees no types, so it skips `!x` only when `x` is a boolean by its syntax alone: a comparison, a `!` expression, a boolean literal, or a `&&`/`||` whose two sides are each one of these. `aria-pressed={!(a === b)}` and `aria-checked={!true}` get no mutant; `aria-expanded={!open}` and `aria-pressed={!(a && b)}` do. A `&&`/`||` value is negated: `!(a && b)` differs from each built-in mutant there. Killed by `toHaveAttribute` and role queries with state options.

Later: `ListExpression` (`.map` becomes `.slice(0, 1).map`, from the Fable draft), button `type` swap, Angular
templates, and CSS. Each waits for a reason given in the drafts' "later" sections.

Tag swaps beyond `button` and `a` also wait: a heading for a `p`, a list, landmark, or `label` for a
`div`, and a `th` for a `td`. Ma11y injects two of them, the heading and the `th` swaps, as F2 and F91
(`docs/research/playwright-mutation-operators.md`, section 1.1), and `getByRole('heading')` or a table
role query would kill them. A tag swap copies the element's whole subtree once per mutant, and headings,
lists, and landmarks wrap far larger subtrees than buttons and links. The first release measures that
cost on `button` and `a` first.

Deleting an element has no operator. It is the first of the four JSX operators proposed in StrykerJS
issue #4375 (`docs/research/jsx-prior-art.md`, section 1.1), and `LzConditionalElement` covers it only
where a condition already guards the element.

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
  The UI operators keep that shape, behind an `Lz` prefix, with markup categories that fit JSX and Angular templates alike:
  `Literal` for static text, `Attribute`, `Element`, `Expression`, and `Handler`. StrykerJS groups one
  syntax by meaning (equality, logical and arithmetic operators are all binary expressions), so the
  attribute operators are grouped by what the attribute does.
- **Mutation names follow weapon-regex.** A weapon-regex mutation name is the construct, then the change:
  `QuantifierRemoval`, `CharClassNegation`, and `GroupToNCGroup` for "X to Y". StrykerJS reports only the
  operator name (the built-in `Regex` mutator reports weapon-regex's mutations as `Regex`), so these names
  appear in docs, tests and the operator table that upstreaming would add (see Upstream path), not in
  `mutatorName`.

| Operator                 | Mutations                                                                                              | Earlier name (drafts, spike) |
| ------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------- |
| `LzTextLiteral`          | `TextRemoval`                                                                                          | `TextContent`                |
| `LzLabelAttribute`       | `LabelRemoval`                                                                                         | `AccessibleName`             |
| `LzEventHandler`         | `EventHandlerRemoval`                                                                                  | `EventHandler`               |
| `LzConditionalElement`   | `ConditionalGuardRemoval` (`x && <A/>` to `<A/>`), `ConditionalToConsequent`, `ConditionalToAlternate` | `ConditionalRendering`       |
| `LzUrlAttribute`         | `UrlRemoval`                                                                                           | `NavigationTarget`           |
| `LzDisabledAttribute`    | `DisabledRemoval`                                                                                      | `DisabledState`              |
| `LzHiddenAttribute`      | `HiddenRemoval`                                                                                        | `HiddenState`                |
| `LzElementRole`          | `RoleRemoval`, `ElementToSpan`                                                                         | `Role`                       |
| `LzChildExpression`      | `ChildExpressionRemoval`                                                                               | `ChildExpression`            |
| `LzStateAttribute`       | `StateNegation`                                                                                        | `AriaState`                  |
| `ListExpression` (later) | `ListTruncation`                                                                                       | `ListTruncate`               |

Every name is letters only, because a `// Stryker disable` comment accepts only letters in mutator names,
and StrykerJS matches those names against every registered mutator ignoring case
(`directive-bookkeeper.ts:63` and `:73`). Each name carries the `Lz` prefix, because Lars ruled on
2026-10-26 that this repository's public names use an `Lz`, `lz` or `lz-` prefix; the "Earlier name" column
and the dated drafts use the names from before that rule. The upstream route would drop the prefix to sit with
the built-ins. Because StrykerJS matches the names ignoring case, the install checks every name before it
changes `allMutators`. It refuses a name that equals, ignoring case, another of its own operators or a
mutator that other code registered, and then registers nothing. A future built-in with the same name thus
fails the run loudly instead of sharing a filter key. `mutator.excludedMutations` does not ignore case:
StrykerJS matches it with `includes` (`babel-transformer.ts:278`), so users write those names exactly as
the table spells them.

Two names do not fit the pattern exactly, the way StrykerJS's `ConditionalExpression` also mutates `if`
tests and loops. `LzDisabledAttribute` also covers `readOnly`, and `LzElementRole` changes either the `role`
attribute or the tag that gives an element its implicit role.

## Rules the synthetic cases settled

`packages/lz-stryker-ui-mutators/test/cases.ts` holds 144 synthetic cases: JSX versions of UI shapes in the repos
the runner was exercised on (RealWorld, ngx-yeti, Analog and hello-world at the commits `oss/README.md` names,
and the demo app), each with the exact UI mutants it must give. `spikes/ui-mutator-cases/` keeps the mined rows
they came from. The cases first ran against the prototype and now run against the package. The design was silent on
these points; Claude settled them on 2026-10-25 from the prototype's behaviour and the Opus draft:

- `LzLabelAttribute` takes bound values, as the Opus draft's rule did (2.2); the earlier "plain-string"
  wording here narrowed it without a reason, and no built-in mutant empties a bound label.
- `LzHiddenAttribute` skips a boolean-literal value, as `LzDisabledAttribute` does, because `BooleanLiteral`
  already flips it.
- Forcing an attribute off removes a string or bare value (`disabled={undefined}`) and sets an expression to
  `{false}`; both give the same accessibility tree as `"false"`, except for `aria-disabled="false"`
  inside an element with `aria-disabled="true"`: the explicit `"false"` keeps the element enabled for
  Playwright, and removing it does not. So `aria-hidden="false"` gets no removal, `aria-disabled="false"`
  does, and no attribute already bound to `{undefined}` does.
  `RoleRemoval` prints `role={undefined}`.
- `LzChildExpression` empties an identifier, a member expression, an optional chain, or a call, and skips a
  string literal, a conditional (left to `LzConditionalElement`), and a `.map`, `.filter` or `.flatMap` list,
  which the later `ListExpression` owns. Until then a rendered list gets no UI mutant of its own.
- `LzEventHandler` applies to an `onX` prop on a component as well as on an element.
- `LzConditionalElement` forces branches of a ternary rendered as a JSX child only, not a ternary inside an
  attribute value (`href={last ? null : '/replay'}`).
- An attribute whose value is already empty (`alt=""`, `href=""`) gets no mutant, because emptying it
  changes nothing. The built-in `StringLiteral` skips the same no-op, and the Opus draft's common rule
  states it.
- A negated or other non-literal expression is still forced off: `disabled={!live}` and
  `hidden={!canModify}` become `{false}`. The built-in `BooleanLiteral` mutant `disabled={live}` also
  disables an enabled button, so any test that clicks it kills that mutant. `{false}` changes the element
  only while it is disabled, so only a test that checks the disabled state kills it. The operator
  mutant is the stronger one, and the Fable draft's skip of `!` is not taken. A comparison or a `&&`/`||`
  expression is not forced off: the built-in `ConditionalExpression` already replaces it with `false`, so
  `{false}` would repeat that mutant (cases realworld-12+13, realworld-14, design-50).
- `LzStateAttribute` negates a value that renders a boolean (`aria-expanded={open}` becomes
  `{!open}`), but not one that renders a string, because a non-empty string negates to a constant
  `false`. tldraw (12921f6d3) writes `aria-pressed={isSelected ? 'true' : 'false'}` at five of its six state
  sites; `!(...)` there is equivalent whenever the item is not selected. A ternary therefore keeps its test
  and flips each branch: a string branch as a string value flips, a boolean branch to the other boolean,
  any other expression to `!(expr)`, and an `undefined` or other literal branch stays. So
  `isSelected === undefined ? undefined : isSelected ? 'true' : 'false'` keeps its `undefined` branch and
  swaps the strings. A `String()` or `.toString()` call, optional (`s?.toString()`) or not, gets no
  mutant; a template literal never reaches the operator. These rules look through an `as`, `satisfies` or
  `!` wrapper, and a flipped value drops it: `(s ? 'true' : 'false') as 'true' | 'false'` becomes
  `s ? "false" : "true"`, while a negated one keeps it (`!(flag as boolean)`). Cases tldraw-1, tldraw-2,
  design-15, design-16 and design-43 to design-45 cover this.
- `ElementToSpan` drops from the `span` every attribute that `@types/react` 19.3.0 declares on `a`, `area`,
  or `button` but not in `HTMLAttributes`: `alt`, `coords`, `disabled`, `download`, `form`, `formAction`,
  `formEncType`, `formMethod`, `formNoValidate`, `formTarget`, `href`, `hrefLang`, `media`, `name`, `ping`,
  `referrerPolicy`, `shape`, `target`, `type`, and `value`. React's types do not allow them on a `span`, so a
  swap that kept them fails to compile under Stryker's TypeScript checker and reports CompileError, not a
  test result. A `span` ignores them at run time, so dropping them keeps the same role change. Claude
  measured the compile errors with `npx tsc --jsx react-jsx --strict` on `<span href="/a">`,
  `<span type="submit">`, `<span disabled>`, `<span alt="A">`, and `<span media="print">`: each gives
  TS2322. Other attributes a `span` accepts, such as `className`, `id`, `rel`, `aria-*`, and handlers,
  stay. Case design-47 covers the list.
- Three skips from the Opus draft (section 2) hold here too. `LzLabelAttribute` skips `htmlFor` on a
  `label` that also wraps its control, because nesting keeps the association. `LzTextLiteral` skips text
  inside `style` and `script`, which is CSS or code, not rendered text. This design adds `noscript`,
  which a browser with scripts on never renders (case design-51); only a test that sets Playwright's
  `javaScriptEnabled: false` sees that text, and it loses those mutants. `LzElementRole` skips a `role` equal
  to the element's implicit role, such as `<button role="button">`, because removing it changes nothing.
  The implicit roles come from Playwright's own table, `kImplicitRoleByTagName` in
  `playwright-core/lib/coreBundle.js`, which `getImplicitAriaRole` reads for `getByRole`. The operator
  takes every tag whose role there is fixed, plus `a` and `area` with `href` (`link`). It reads the table
  of the consumer's `playwright-core` when the plugin loads, and falls back to a table generated from
  `playwright-core` when the package is built, as the package README describes. A table that lacks the
  entry for `a`, `area` or `button`, or gives one of them a role other than the one the span swap reads
  (`link` for `a` and `area`, `button` for `button`), counts as unreadable. When the plugin loads, it then uses the bundled
  table and prints a warning. When the package is built, the generator fails. The span swap reads the
  same table. In 1.64.1 the tags with a fixed role are `article`, `aside`, `blockquote`, `button`, `caption`,
  `code`, `datalist`, `dd`, `del`, `details`, `dfn`, `dialog`, `dt`, `em`, `fieldset`, `figure`, `h1` to
  `h6`, `hr`, `html`, `ins`, `li`, `main`, `mark`, `math`, `menu`, `meter`, `nav`, `ol`, `optgroup`,
  `option`, `output`, `p`, `progress`, `search`, `strong`, `sub`, `sup`, `svg`, `table`, `tbody`,
  `textarea`, `tfoot`, `thead`, `time`, `tr`, and `ul`. So `LzElementRole` makes no removal mutant for
  `<output role="status">` or `<svg role="img">`, and both keep their `role`. `area` without `href`,
  `footer`, `form`, `header`, `img`, `input`, `section`, `select`, `td`, and `th` get their role from
  attributes or context, so removing an explicit one can change what `getByRole` finds, and the skip leaves them out. `dd`, `dt`, `li`, `tbody`, `tfoot`,
  `thead`, and `tr` lose their implicit role under a parent with `role="none"` or `role="presentation"`;
  that shape is rare, and the skip keeps them. Cases design-7 and design-14 cover the role skip.

The prototype also matches `formAction`, `inert`, `aria-current`, `aria-invalid` and `checked`, which this
design does not list; they stay out of the first release.

The Opus prototype (`spikes/design-opus/ui-mutators.ts`) and both drafts use the earlier names. The
prototype also predates ten of the rules in this design: the `LzConditionalElement` comparison and logical skip, the
same skip for `LzDisabledAttribute` and `LzHiddenAttribute`, the `LzStateAttribute` skip of a comparison, the
`LzTextLiteral` skip of `noscript` text, the
`LzConditionalElement` limit to JSX children, the `LzEventHandler` single-reference skip, the `href`
condition on the `a` swap, the skip of an empty value, the attributes that `ElementToSpan` drops, and the
`LzHiddenAttribute` skip of `aria-hidden` on `svg`, `img`, and `i`. The package implements them, and the
synthetic cases that test them pass. Two more prototype behaviours differ from this design. The prototype skips, without a word, an operator whose name is already registered
(a case-sensitive `Set.has`), and wraps the placer only when it added every operator, where the design
refuses the name. It also removes a string state value, so `aria-pressed="true"` becomes
`aria-pressed={undefined}`, where `LzStateAttribute` flips it. Its counts in `neutral-output.txt`
therefore include one `ConditionalRendering` (now `LzConditionalElement`) mutant on
`price-tag.tsx` line 22 (`off > 0 && (...)`) that the skip removes. With the skip, the demo's
`price-tag.tsx` gets 2 UI mutants instead of 3, and `app.tsx` stays at 15. The verification plan's
must-not-generate rows (Opus draft, section 6.1) gain `n > 0 && <A/>`, `a === b ? <A/> : <B/>`, a
handler referenced once, and `<a>x</a>` without `href`.

## Equivalent mutants

Some operator mutants behave the same as a mutant StrykerJS or the source already gives. The skips above
remove the cases that are cheap to detect. Each operator's match rule holds its skips. StrykerJS's
`NodeMutator.filter` hook (`node-mutator.ts:14`) cannot hold them: it sees only the mutants of the node
and its subtree, without the ones that carry an ignore reason (`babel-transformer.ts:122-153`). A skip
written as a filter would then change with the user's `excludedMutations`, and the `LzEventHandler`
single-reference skip needs the handler's binding, which is outside the attribute's subtree. These
remain:

- `LzEventHandler` on a handler that the skip does not catch can still match the built-in `BlockStatement`
  mutant, which empties the handler's body. A click does nothing in both, and for `onSubmit` both let
  the native submit through. The two differ only when the handler is shared or a parent handler relies
  on the event bubbling. Examples are a handler imported from another file, or a handler passed in
  through props and emptied in the parent's file.
- `LzConditionalElement` on an empty list renders an empty `<ul>`, which Playwright reports as not
  visible. The mutant is not equivalent, but `toBeHidden` does not kill it. `toHaveCount(0)` on the items
  does.

Mutants that a lint rule would reject stay, unlabelled. Claude decided this on 2026-10-26. With all 36
`eslint-plugin-jsx-a11y` rules at `error`, 88 of the 224 UI mutants of the synthetic cases, the demo app,
the UI fixture and the corpus add a finding the original did not have: an emptied heading, label or link
text (`LzTextLiteral`, `LzLabelAttribute`), an empty `href` (`LzUrlAttribute`), or a `span` that keeps a click
handler (`ElementToSpan`). Claude measured this at 63d0209 by applying each UI mutant's replacement at
its location and linting the original and the mutant. They are kept because:

- an operator cannot know a project's lint config, and a skip keyed to jsx-a11y would drop 39 percent of
  the UI mutants, including the ones a role, label or text locator kills most often. A surviving one says
  that no test looks at the element by name, which lint cannot tell;
- StrykerJS cannot label them. Its checker API has two outcomes, `Passed` and `CompileError`
  (`@stryker-mutator/api/dist/src/check/check-status.d.ts`), so an ESLint checker would report them as
  compile errors and take them out of the score, and the package's ignorer works per AST node, so it
  would also hide the built-in mutants at that node.

The cost is a small score lift in projects whose lint already blocks these shapes, as they are easy to
kill. The demo app takes the other side of this: it runs jsx-a11y's `strict` set at `error`, so these
shapes cannot ship there, and the operators measure what lint cannot see.

## Integration

- **Package.** `@layzee/lz-stryker-ui-mutators`. The user lists it in `plugins` and lists its ignorer in
  `ignorers`, or imports it from a JavaScript or TypeScript config (see "Fail loud"). No other options in v1. Users exclude operators with
  `mutator.excludedMutations` and with `// Stryker disable` comments, both of which already match custom
  mutator names.
- **Version range.** Peer dependency `@stryker-mutator/core` `~10.1.0`. At run time the plugin reads the
  version of the instrumenter it resolved. A version other than `10.1.1`, the tested one, logs a warning
  and the install goes on. The self-check, not the version, decides whether the run may continue. The
  Opus prototype throws on any other version.
- **Registration without an upstream change.** On import, the plugin finds the instrumenter that the
  running `@stryker-mutator/core` uses. When `process.argv[1]`, after `realpath`, is core's
  `bin/stryker.js`, the plugin resolves the instrumenter from that core's folder, so a global or
  differently hoisted `stryker` gets the operators too. Otherwise, as when a program calls Stryker's API,
  it resolves core from its own folder. The thermos plugin's Node operators resolve core the same way
  (`LayZeeDK/thermos-claude-plugin`, `tools/stryker-node-mutators/install.ts`). The plugin then pushes its
  mutators into the live `allMutators` array, and wraps `expressionMutantPlacer.canPlace` and `place` so that `JSXAttribute` and
  `JSXText` become placement sites. Details: Opus draft, sections 3.2 and 3.3.
- **Fail loud.** Still at import, the plugin instruments one JSX sample per operator and checks that
  each sample gives a mutant of its operator. The error names every operator whose sample gave none, so
  one operator that a StrykerJS change breaks cannot hide behind the others. An install or self-check
  error rejects the module's import. Core turns a plugin import error into a warning and runs on without
  the mutators (`packages/core/src/di/plugin-loader.ts:193-209`), so the module also exports an `Ignore`
  plugin named `lz-stryker-ui-mutators`. Core creates every ignorer listed in `ignorers` right before `instrument()`
  (`2-mutant-instrumenter-executor.ts:67-69`), with no catch. After a failed install the module exported
  nothing, so core throws `Cannot find Ignore plugin "lz-stryker-ui-mutators"` there (`plugin-creator.ts:57-64`), and
  the install error is in the warning above it. After a skipped install (see "Process placement") the
  factory throws "install did not run". Otherwise it returns an ignorer that ignores nothing.
  `spikes/ignorer-route/` measured on StrykerJS 10.1.1 that a factory that throws makes `stryker run` exit
  1 with the error's message, and `spikes/fail-loud/` measured that a failed install exits 1 on both
  routes with the failing operator's name. An earlier version of this
  design kept the error and threw it from the factory. That cannot hold together with the config import
  below: a module that keeps its error loads without one, so a config that imports it would not stop.
- **The `ignorers` entry is required.** `ignorers` defaults to `[]`
  (`packages/api/schema/stryker-core.json:509-516`), and core creates only the listed names. A
  documented config that lists the plugin in `plugins` therefore always has `ignorers: ['lz-stryker-ui-mutators']`
  next to it.
  Without it, a successful install still registers and runs every operator, because registration
  happens at import. A failed install falls back to core's warning
  `Error during loading "@layzee/lz-stryker-ui-mutators" plugin`, and the run finishes without UI mutants. The
  plugin cannot detect the missing entry in that case, because its import has already failed.
- **A config import fails loud with one entry.** A config written as a JavaScript or TypeScript module
  can `import '@layzee/lz-stryker-ui-mutators'` on its first line instead. The module installs with a
  top-level `await`, so an install or self-check error rejects the config import, and the run stops
  before it starts, with no `ignorers` entry. The thermos plugin's Node operators use this route
  (`stryker.config.mjs:1`). A JSON config cannot import, so it keeps `plugins` and `ignorers`. The same
  spike measured this route: a config that imports a module whose top-level `await` rejects makes
  `stryker run` exit 1 with `Invalid config file` and the error's message.
- **A second install adds nothing.** A config that both imports the module and lists it in `plugins`
  installs twice in one process. The second install skips the operators that the first one registered,
  the name check does not count them as collisions, and the placer is wrapped once.
- **Options, later.** A plugin module can export `strykerValidationSchema`, so options such as extra
  accessible-name props validate against the Stryker config. Mutators still cannot read them at run
  time, because `NodeMutatorContext` carries only `isExpressionContext`. The `lz-stryker-ui-mutators` ignorer
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
- **Reports.** Each operator keeps its own `mutatorName`, so reports and filters show `LzTextLiteral` next
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

The upstream record shapes this order (`docs/research/jsx-prior-art.md`, section 1.1). StrykerJS issue
#4375 asked for JSX text mutation in 2023, and a maintainer declined it on scope ("Stryker for
Javascript and not Stryker for HTML"), not on mechanism. PR 2 therefore ships the operators off, and its
text cites #4375 as the user demand. Issue #701 (2018) added the `JSXAttribute` skip to `StringLiteral`
after `class="row"` became `class=""`. These operators change attributes by what they mean to a user, so
PR 2 says why they do not bring that mutant back. Issue #4141 complained about too many JSX mutants, and
the answer was Ignore plugins, the plugin kind that "Fail loud" uses. For Angular templates, the nearest
precedent is `azat-io/mootant`, which mutates Svelte and Vue template expressions but not static markup
(section 1.2).

StrykerJS has no mutation level or family per mutator. The `mutator` option takes only `plugins` and
`excludedMutations` (`packages/api/schema/stryker-core.json:186-212`), and the built-in `Regex` mutator
pins weapon-regex to `mutationLevels: [1]` (`regex-mutator.ts:31`). Stryker.NET gates each mutator on a
`MutationLevel` (`MutatorBase.cs:23-27`), and weapon-regex groups its mutations by level
(`BuiltinMutators.scala:46-70`). PR 2 could ask for a level option instead of `includedMutations`. A
level is a new concept in the StrykerJS schema that every built-in would need a value for, while
`includedMutations` names operators the way `excludedMutations` already does. The design asks for
`includedMutations` and leaves levels to the maintainers. The names in Names stay either way.

## Risks that remain

The built package has gone through `stryker run` with a browser on the demo app and on a copy of
epic-stack, and a Playwright test kills a mutant of every operator in
`packages/lz-stryker-playwright-runner/test/browser/ui-mutators.test.ts`. `docs/VERDICT.md` (Evidence)
has the counts. Two risks remain from those runs. On a server-rendered app the runner activates the
mutant in the browser only, so a text or element mutant breaks hydration and is killed by an
unrelated step, and an attribute mutant never reaches the DOM (VERDICT, Limits). And three operators,
`LzEventHandler`, `LzHiddenAttribute`, and `LzStateAttribute`, have had no site in a real app yet, only in
the test fixture.

The self-check instruments through the instrumenter the plugin resolved and imported itself. That is the
plugin's own module instance, so the check cannot see a mismatch with the instance that core imports.
It catches a broken install of the resolved copy, and it names a second copy only through the version
and path in its message. The gate is a real `stryker run` through core with `testRunner: 'command'` and
no browser, asserting that `mutation.json` lists the operator names (Opus draft, section 5, risk 3). Run
it before calling the self-check enough, and on every StrykerJS bump. `spikes/fail-loud/` is that gate and
the negative control below: on StrykerJS 10.1.1 both routes report 12 UI mutants from seven operators, and
with one broken sample both exit 1 with that operator's name.

The `ElementToSpan` rule rests on `tsc` output for three hand-written elements and on one Stryker run:
on epic-stack, with `@stryker-mutator/typescript-checker`, its one mutant (`<a href>` to a `<span>`
without the `href`) compiled, and no UI mutant reported CompileError. One mutant is thin evidence for
the `button` swap, which no real app run has produced yet.

## What the verification plan adds

The Opus draft's section 6 says what to run. These steps add the checks that can fail and the bar that
decides each operator.

1. **Corpus diff.** Instrument the demo app with the operators off and on, and diff the two sorted lists
   of `line:col mutator replacement`. A built-in mutant that is in one list and not in the other means
   that an operator suppressed or moved it. `spikes/design-opus/neutral.ts` prints counts only today, so
   this diff runs on the built package, not the prototype.
2. **Negative control for fail loud.** Break the install on purpose: give one operator a sample that it
   cannot mutate. Then assert that `stryker run` exits non-zero with that operator's name in the error,
   once through the `ignorers` entry and once through the config import. Without this control, a green
   gate cannot tell a working fail-loud route from an install that never failed.
3. **The bar per operator.** An operator stays in the first release only when all of these hold on the
   demo app and the fixtures. An operator that misses one moves to Later, with its counts recorded.
   - The corpus diff shows that its mutants differ from every built-in mutant at the same site.
   - Each of its mutants is classified by hand as killed, survived with a test gap, equivalent, or error
     (CompileError, Timeout). Equivalent and error mutants together are at most one in ten. This limit
     is a starting value, not a measured one. Tune it against the real ratios once the first operators
     have been classified by hand.
   - A Playwright test written for the behaviour kills at least one of its mutants.

   Measured on 2026-10-26 (`docs/VERDICT.md`, Evidence): every operator meets the bar. The corpus diff
   is the placement test in `packages/lz-stryker-ui-mutators/test/`. On the demo app, with
   `actionTimeout` set, none of the 17 UI mutants is equivalent or an error, and without it 3 kills
   show as Timeout. In `packages/lz-stryker-playwright-runner/test/browser/ui-mutators.test.ts` a
   written test kills a mutant of each operator. A copy of epic-stack, outside the bar's scope, adds
   the first real ratios: 1 equivalent and 0 errors among 45 UI mutants, the equivalent one a
   `LzConditionalElement` (1 of 8 for that operator). Three operators have had no site in a real app yet, so the limit stays
   a starting value.

## Rerun the evidence

```sh
node spikes/design-opus/spike.ts
MODE=patched node spikes/design-opus/neutral.ts
MODE=ui node spikes/design-opus/neutral.ts
node spikes/design-opus/directive.ts
node spikes/design-fable/spike-jsx-placement.ts
node --test packages/lz-stryker-ui-mutators/test/cases.test.ts
```

`MODE=patched` shows that the placer patch leaves built-in mutants unchanged, and `MODE=ui` prints the
per-operator counts. Compare both with the committed `neutral-output.txt`. Without `MODE`, `neutral.ts`
runs the stock instrumenter only and proves nothing about the patch.
