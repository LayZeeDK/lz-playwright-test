# Design: UI mutation operators that Playwright tests can kill

Status: chosen design, 2026-10-25, by Claude during an AFK run. Not built yet. Operator names are a
proposal for Lars (public vocabulary).

## Why

StrykerJS 10.1.1 mutates expressions. It leaves the parts of a component that Playwright tests look at
untouched: JSX text, plain attribute strings such as `aria-label`, `role`, `href` and `data-testid`, bare
`hidden` and `disabled`, and event props that point at a named handler
(`docs/research/playwright-mutation-operators.md`, section 2). A suite that finds elements by role, label
and text can be strong and still look weak, or weak and look strong, because none of those changes are
ever made. These operators make them.

## How this design was chosen

Two designers worked independently from the same research and brief, on different models:
`docs/design/playwright-mutators-opus.md` and `docs/design/playwright-mutators-fable.md`. Both spikes
rerun clean from `spikes/` (commands below). They agree on the top operators and on the integration
route, which is the strongest signal in the comparison. This design takes the Opus draft as the base and
grafts four parts of the Fable draft.

| Question | Opus draft | Fable draft | Taken |
|---|---|---|---|
| Attribute placement | switch inside the attribute value: `aria-label={c ? "" : "Close"}` | the attribute becomes a spread object `{...c ? {...} : {...}}` | Opus: smaller output, React sees the same props, no `key`/`ref` exception, handles `&amp;` |
| Emptied text | `null`, identical render to the original | `""` | Opus |
| Element-level mutants (tag swap) | yes, with the JSX child wrap | none in v1 | Opus (`Role` can swap a tag) |
| Silent plugin failure | warning only | import-time self-check that throws | Fable |
| Version drift | pinned peer | pinned peer plus runtime warning | Fable |
| Upstream fixes found | JSX comment directives are ignored for every mutator | built-in `ConditionalExpression` makes a duplicate `true` mutant for JSX `&&` | both |
| Names | framework-neutral (`TextContent`) | `Jsx` prefix | Opus, because Angular templates come later |

## Operators in the first release

Ranked by how often realistic Playwright suites would kill them. Full patterns, examples and skip rules
are in the Opus draft, section 2.

1. `TextContent`: empties JSX text that has a letter or digit. Killed by `getByText`, `getByRole({ name })`, `toHaveText`.
2. `AccessibleName`: empties plain-string `aria-label`, `alt`, `placeholder`, `title`, `htmlFor`, `label`. Killed by `getByLabel`, `getByRole({ name })`, `getByPlaceholder`, `getByAltText`.
3. `EventHandler`: `onX={handler}` becomes `onX={undefined}` when the handler is not inline, so it never repeats the built-in `ArrowFunction` mutant. Killed by the assertion after a `click` or `fill`.
4. `ConditionalRendering`: forces `x && <A/>` to render, and forces each branch of a JSX ternary. Killed by `toBeVisible`, `toHaveCount(0)`.
5. `NavigationTarget`: `href`, `to` and `action` become `""`. Killed by `toHaveURL`.
6. `DisabledState`: forces `disabled`, `readOnly` and `aria-disabled` off, skipping shapes `BooleanLiteral` already flips. Killed by `toBeDisabled`, `toBeEditable`.
7. `HiddenState`: flips `hidden` and `aria-hidden`. Killed by `toBeVisible`, `getByRole` (hidden elements leave the tree).
8. `Role`: removes `role`, or swaps a semantic tag (`button` to `span`). Killed by `getByRole`.
9. `ChildExpression`: a `{value}` child becomes `null`. Killed by `toHaveText`.
10. `AriaState`: flips `aria-expanded`, `aria-pressed`, `aria-checked`, `aria-selected`. Killed by `toHaveAttribute` and role queries with state options.

Later: `ListTruncate` (`.map` becomes `.slice(0, 1).map`, from the Fable draft), button `type` swap, Angular
templates, and CSS. Each waits for a reason given in the drafts' "later" sections.

## Integration

- **Package.** `@spr/stryker-ui-mutators`, listed in `plugins`. No new options in v1. Users exclude
  operators with `mutator.excludedMutations` and with `// Stryker disable` comments, both of which already
  match custom mutator names.
- **Registration without an upstream change.** On import, the plugin finds the instrumenter that
  `@stryker-mutator/core` will use (resolved from core's own folder), pushes its mutators into the live
  `allMutators` array, and wraps `expressionMutantPlacer.canPlace` and `place` so that `JSXAttribute` and
  `JSXText` become placement sites. Details: Opus draft, sections 3.2 and 3.3.
- **Fail loud.** Still at import, the plugin instruments a one-line JSX sample and throws if its mutants
  are missing. That catches a duplicate or bundled instrumenter, which would otherwise drop every UI
  mutant without a word. A version outside the tested range logs a warning.
- **Reports.** Each operator keeps its own `mutatorName`, so reports and filters show `TextContent` next
  to `StringLiteral`.

## Upstream path

Three PRs to `@stryker-mutator/instrumenter`, smallest first, in the shape weapon-regex already set: the
instrumenter owns Babel, placement, ids and reports, and the operator rules live in a table.

1. Neutral fixes: a JSX placer for attributes and text, the JSX child wrap, `{/* Stryker disable */}`
   support inside JSX, and no `true` mutant for a JSX `&&`.
2. The operators, off by default, enabled by a new `mutator.includedMutations` option.
3. The operator table as its own package, when Angular template support starts.

## Risks that remain

None of this has gone through `stryker run` with a browser yet. The spikes prove the instrumented TSX
re-parses and renders like the hand-made mutation in React (61 mutants in the Opus spike, 26 of 26 UI
mutants change the render in the Fable spike). They do not prove Vite builds it or that a Playwright test
kills it. The first build step is the verification plan in the Opus draft, section 6: a fixture per
operator through `packages/stryker-playwright-runner/test/runner.test.ts`, then the demo app.

## Rerun the evidence

```sh
node spikes/design-opus/spike.ts
node spikes/design-opus/neutral.ts
node spikes/design-opus/directive.ts
node spikes/design-fable/spike-jsx-placement.ts
```
