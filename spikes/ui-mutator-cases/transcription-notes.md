# Transcription notes: mined rows to `cases.ts`

The 95 rows in `mined-*.md` became 93 cases in `cases.ts`. The other 2 are skipped (see Skipped rows). A later
review added ngx-yeti-21 (see Gaps). Run `node --test spikes/ui-mutator-cases/cases.test.ts`: 94 tests, 61 pass,
33 todo, 0 fail, exit 0. Each todo
case fails only on the mutant that its `gap` names. Every expectation was taken from a run of the design
spike's prototype (`spikes/design-opus/ui-mutators.ts`) on StrykerJS 10.1.1. Claude then changed it by hand
only where the design's written rules disagree with the prototype (Gaps).

## Skipped rows

- `analog-22` and `analog-23` come from `apps/analog-app/src/stories/Configure.mdx:47` and `:53`. They are
  `.mdx` files, and the operators read `.tsx` only.
- The mined files have no "No JSX equivalent" rows in their case tables. Those shapes are listed under their
  own headings in each file and never got an id, so nothing else is skipped.

## Gaps (cases run as todo)

The design names three rules that the prototype does not implement. Eleven cases test them:

| Rule | Cases | The prototype also gives |
|---|---|---|
| `ConditionalElement` skips a comparison or logical guard | realworld-9, ngx-yeti-3, analog-8, demo-14 | the guard-removal mutant |
| `EventHandler` skips a same-file handler that is referenced once | realworld-6, ngx-yeti-15, analog-5, analog-7, analog-11 | `onX={undefined}` |
| `ElementRole` swaps an `a` for a `span` only when the `a` has an `href` | realworld-22, ngx-yeti-4 | the `span` swap |

The prototype misses two more written rules that are not among the three the design names. Claude kept the
design's expectation and marked these cases as gaps too. Claude should confirm that they belong in the
design's "predates" list:

| Rule (design wording) | Cases | The prototype also gives |
|---|---|---|
| `LabelAttribute` "empties plain-string" values | realworld-21 (`alt={username}`), analog-3 (`title={product.name + ' details'}`) | `alt=""`, `title=""`: its `onExpression` empties bound values too |
| `ConditionalElement` forces each branch "of a JSX ternary" | ngx-yeti-5 (`href={last ? null : '/replay'}`) | `null` and `'/replay'`: `isJsxBranch` counts a `null` branch as JSX, so a ternary inside an attribute value qualifies |

A later review added two rules to the design. They put 20 more cases in todo. Five of the cases below were
already todo for a rule above, and their `gap` names both rules.

| Rule | Cases | The prototype also gives |
|---|---|---|
| An attribute whose value is already empty gets no mutant | ngx-yeti-21 (`alt=""`) | `alt=""` |
| `ElementToSpan` drops `href`, `type` and `disabled`, which a `span` cannot take | realworld-10, -11, -12, -13, -20; ngx-yeti-1, -3, -5, -6, -7, -15, -16, -18, -20; analog-1, -2, -3, -5, -6, -8, -9, -15, -19, -24 | the `span` with those attributes kept |
| `HiddenAttribute` skips `aria-hidden` on `svg`, `img` and `i` (added 2026-10-26) | ngx-yeti-14 | `aria-hidden={undefined}` |

## Design clarifications for Claude to settle

Settled on 2026-10-25 in `docs/design/playwright-mutators.md`, "Rules the synthetic cases settled". One
change from the table above: `LabelAttribute` takes bound values, so realworld-21 and analog-3 are no
longer gaps and expect `alt=""` and `title=""`.

The design says nothing about these points. Each expectation keeps the prototype's behaviour, which differs
from what the mined row guessed.

1. **`HiddenAttribute` on a boolean literal** (realworld-16, `aria-hidden={true}`): the prototype gives no
   mutant, because it skips every literal value for all attribute operators. The design states the
   `BooleanLiteral` skip for `DisabledAttribute` only. The skip seems right, because `BooleanLiteral` already
   makes `aria-hidden={false}`. The design should say that `HiddenAttribute` skips it too.
2. **How "forced off" is printed** (ngx-yeti-14 `aria-hidden="true"`, ngx-yeti-4 bare `disabled`): the
   prototype removes the attribute and prints `aria-hidden={undefined}` and `disabled={undefined}`. The mined
   row guessed `aria-hidden="false"`. A forced-off expression prints `{false}` (realworld-12, -14, -15;
   ngx-yeti-1, -18). Removal seems right, because it gives the same accessibility tree as `"false"` and also
   works for bare `disabled`. `RoleRemoval` uses the same form and prints `role={undefined}` (ngx-yeti-9, -10,
   -19).
3. **`UrlAttribute` on a non-literal value**: the prototype empties a concatenation (realworld-10,
   `href={'/profile/' + username}` becomes `href=""`) and an expression (ngx-yeti-5). It skips a template
   literal (analog-3, ``href={`/products/${product.id}`}``), because a template literal counts as a Babel
   `Literal`. The mined analog-3 row expected `href=""`. Skipping the template literal seems right, since the
   built-in `StringLiteral` already empties it. The design should still state the rule, and say whether
   `LabelAttribute` (plain strings only) and `UrlAttribute` (any value) are meant to differ.
4. **`ChildExpression` on a `.map(...)` child** (analog-20, demo-13): the prototype skips `map`, `filter` and
   `flatMap` calls and leaves them to the later `ListExpression`. The mined rows guessed `{null}`. This seems
   right for the first release, since it avoids an overlap once `ListExpression` exists. But
   `ChildExpressionRemoval` on a list is a cheap, strong mutant, and the design should choose one of the two.
   Other expression kinds: the prototype empties an identifier, a member expression, an optional chain and a
   call (analog-9, analog-10, demo-10). It skips a string literal (demo-17) and a conditional (demo-15).
5. **`EventHandler` on a component prop** (analog-7, `<ProductAlerts onNotify={onNotify} />`): the prototype
   matches `/^on[A-Z]/` on any element, components included. In this case the single-reference skip hides
   that. The other component cases (demo-3, demo-4 `<Link to>`) generate, and the mined rows expected them to.
   Applying the operator to components seems right for React, where `onX` props are almost always handlers.

The prototype also covers attributes that the design does not list: `formAction`, `inert`, `aria-current`,
`aria-invalid` and `checked`. No mined case uses them, so the cases leave the question open.

## Mined expectations corrected

- **A `button` always gets `ElementToSpan`**. realworld-1 and realworld-6 left it out.
- **A case lists every UI mutant of its snippet, because the harness compares the full set.** Some row pairs
  share one snippet and each row named only one of its mutants: realworld-12 and realworld-13, hello-2 and
  hello-3, hello-4 and hello-5. Both cases in each pair now carry the same full set.
- **demo-12**: the snippet's `<input aria-label="x" />` also gives `LabelAttribute` `aria-label=""`.
- **The printed `TextLiteral` replacement is the empty `JSXText` (`''`), not `{null}` or `<h1></h1>`.** The
  placer turns it into `null` when it places the mutant, but `replacement` reports the empty text.
  `ElementRole` `ElementToSpan` prints the whole swapped element. The prototype's `span` keeps every
  attribute. The design's `span` drops `href`, `type` and `disabled` (see Gaps).

## Transcription choices

- **Origins** are written `<repo>@<commit>:<path>:<line>`. A line range keeps its first line. The repo names
  are `realworld`, `ngx-yeti`, `analog`, `stryker-playwright-hello-world`, and `stryker-playwright-runner` for
  the demo app.
- **`...` contents** in a mined `jsx` became empty children (realworld-3, -5, -10; analog-11, -12, -20). Real
  content would add text mutants that the row did not intend.
- **`&&` and ternary shapes** are wrapped in a host element (`<div>`, `<nav>`, `<main>`, `<section>`,
  `<header>`), because the harness returns the JSX directly and the `&&` operator needs a JSX expression
  container.
- **realworld-19** puts the `&nbsp;&nbsp;` between two `<i />` elements, not two buttons, so that only the
  entity text is under test. Babel decodes the entities, so the text has no letter and gives no mutant, as the
  mined row expected.
- **demo-16** is not JSX. The ternary moved to `setup`, and the `jsx` is `<s data-off={off} />`.
- **demo-19** keeps the element `<PriceTag cents={12_00} />` without the story arrow around it.
- **analog-6** imports its handler in `setup` (`import { share } from './share';`).
