# Mined cases: ngx-yeti at 87d4377

Repo: `D:/projects/github/LayZeeDK/ngx-yeti` (Angular library, Playwright suites in `apps/yeti-app-e2e`,
`apps/yeti-analog-e2e`). Read through `git --git-dir ... show 87d4377:<path>` only. Design:
`docs/design/playwright-mutators.md`.

Conventions used in the table:

- Origin lines are file line numbers at 87d4377. Angular templates are inline in `*-fixture.ts`.
- `{null}` means the text node is replaced by `null` (design: "Emptied text: `null`"). `ElementToSpan` shows
  the tag swap only; other attributes are assumed to stay [inferred, design silent].
- `expect` lists every UI mutant, so a `button` case always lists `ElementToSpan` (design: "`button` always").
  Built-in StrykerJS mutants (`ArrowFunction`, `BooleanLiteral`, `StringLiteral`, `ConditionalExpression`) are
  out of scope and not listed.
- Directive attributes (`yetiButton`, `yetiButtonsItem`, `yetiCluster`, `yetiIcon`, `affix`, `emphasis`) are
  dropped from the JSX: they have no JSX meaning and no operator touches them. `i18n*` markers are dropped.
- `[checked]` = design rule applied to the snippet. `[inferred]` = design silent, judged.
- `killed by` is the Playwright assertion in the repo that would fail on the mutant; `-` = none found.

| id | origin | jsx | operator | expect | rule | killed by |
|---|---|---|---|---|---|---|
| ngx-yeti-1 | `apps/yeti-app/src/app/fixtures/button-fixture.ts:21-23` `<button type="button" [disabled]="!live()" (click)="live.set(false)">` / `Remove the live buttons` | `<button type="button" disabled={!live} onClick={() => setLive(false)}>Remove the live buttons</button>` | TextLiteral | TextLiteral `TextRemoval`: text -> `{null}` [checked]. DisabledAttribute `DisabledRemoval`: `disabled={false}` [inferred: `!live` is not a literal, and BooleanLiteral's `!live` -> `live` differs from forcing off]. ElementRole `ElementToSpan`: `<span ...>` [checked]. EventHandler: none [checked] | "`onX={handler}` ... when the handler is not inline"; `[disabled]="busy"` becomes `disabled={busy}` | text: `button.spec.ts:307` (`getByRole('button', { name: 'Remove the live buttons' })`); disabled: `-`; span: `button.spec.ts:307` |
| ngx-yeti-2 | `button-fixture.ts:26-27` `@if (live()) {` / `<form id="button-form">` | `{live && <form id="button-form"></form>}` | ConditionalElement | ConditionalElement `ConditionalGuardRemoval`: `<form id="button-form"></form>` [checked] | "forces `x && <A/>` to render"; left operand is an identifier, no skip | `button.spec.ts:309` (`#button-form` `toHaveCount(0)` after the remove click) |
| ngx-yeti-3 | `apps/yeti-app/src/app/fixtures/fragment-links-fixture.ts:38-39` `@if (page !== null) {` / `<a routerLink="../two">Open page two</a>` | `{page !== null && <a href="../two">Open page two</a>}` | none | ConditionalElement: none [checked]. Other operators still fire: UrlAttribute `UrlRemoval` `href=""` [checked]; TextLiteral `{null}` [checked]; ElementRole `ElementToSpan` `<span href="../two">` [checked, `a` has `href`] | skip: "`&&` left operand ... is a `BinaryExpression` with ... `!==`"; `routerLink` becomes `href` on an `a` | `-` |
| ngx-yeti-4 | `button-fixture.ts:68` `<a id="previous" yetiButton disabled>Previous</a>` | `<a id="previous" disabled>Previous</a>` | DisabledAttribute | DisabledAttribute `DisabledRemoval`: bare `disabled` forced off [checked, bare form is invisible to StrykerJS; exact text [inferred]]. TextLiteral `{null}` [checked]. ElementRole: none [checked] | bare `disabled`; skip: "An `<a>` without `href` has no `link` role, so swapping it would be an equivalent mutant" | disabled: `button.spec.ts:143-145` (`#previous` `aria-disabled` is `true`, no `href`) |
| ngx-yeti-5 | `button-fixture.ts:61-66` `<a id="next" yetiButton [disabled]="last()" [routerLink]="last() ? null : '/replay'">Next</a>` | `<a id="next" disabled={last} href={last ? null : "/replay"}>Next</a>` | UrlAttribute | UrlAttribute `UrlRemoval`: `href=""` [inferred: design lists `href` without saying a non-string value is skipped]. DisabledAttribute `DisabledRemoval`: `disabled={false}` [inferred]. TextLiteral `{null}` [checked]. ElementRole `ElementToSpan` [inferred: an `href` attribute exists though its value can be `null`] | `routerLink` becomes `href`; unclear whether `UrlAttribute` needs a plain string | `button.spec.ts:143-145` (`#next` has `aria-disabled` `true` and no `href`, so the span swap and `href=""` are not distinguished from it; `disabled` removal `-`) |
| ngx-yeti-6 | `button-fixture.ts:24` `<a routerLink="/replay">Leave for a page without buttons</a>` | `<a href="/replay">Leave for a page without buttons</a>` | UrlAttribute | UrlAttribute `UrlRemoval`: `href=""` [checked]. TextLiteral `{null}` [checked]. ElementRole `ElementToSpan`: `<span href="/replay">` [checked] | "`href`, `to`, and `action` become `\"\"`"; `routerLink="/x"` becomes `href="/x"` on an `a` | `button.spec.ts:171-174` (`getByRole('link', { name })` click, then `toHaveURL(/\/replay$/)`) |
| ngx-yeti-7 | `button-fixture.ts:92` `<a id="contact-link" yetiButton href="#contact">Contact us</a>` | `<a id="contact-link" href="#contact">Contact us</a>` | UrlAttribute | UrlAttribute `UrlRemoval`: `href=""` [checked]. TextLiteral `{null}` [checked]. ElementRole `ElementToSpan` [checked] | plain `href` on an `a` | `button.spec.ts:392-394` (click `#contact-link`, `toHaveURL` ends `#contact`) |
| ngx-yeti-8 | `apps/yeti-app/src/app/fixtures/buttons-fixture.ts:50` `<div yetiButtons affix aria-label="Text style">` | `<div aria-label="Text style"></div>` | LabelAttribute | LabelAttribute `LabelRemoval`: `aria-label=""` [checked]. ElementRole: none (`div` is not a swapped tag, no `role`) [checked] | "empties plain-string `aria-label`" | `buttons.spec.ts:140-141` (served `aria-label` list starts `'Text style'`) |
| ngx-yeti-9 | `apps/yeti-app/src/app/fixtures/icon-fixture.ts:36-41` `<svg role="img" aria-label="Warning" i18n-aria-label viewBox="0 0 24 24">` | `<svg role="img" aria-label="Warning" viewBox="0 0 24 24"></svg>` | LabelAttribute | LabelAttribute `LabelRemoval`: `aria-label=""` [checked]. ElementRole `RoleRemoval`: drops `role="img"` [checked] | "empties plain-string `aria-label`"; "removes `role`" | both: `icon.spec.ts:214` (`getByRole('img', { name: 'Warning', exact: true })` `toBeVisible`) |
| ngx-yeti-10 | `apps/yeti-app/src/app/fixtures/spinner-fixture.ts:23-28` `<span id="loading-spinner" yetiSpinner role="status" aria-label="Loading" i18n-aria-label></span>` | `<span id="loading-spinner" role="status" aria-label="Loading"></span>` | LabelAttribute | LabelAttribute `LabelRemoval`: `aria-label=""` [checked]. ElementRole `RoleRemoval` [checked] | same as ngx-yeti-9 | both: `spinner.spec.ts:309-310` (`getByRole('status', { name: 'Loading' ...`) |
| ngx-yeti-11 | `apps/yeti-app/src/app/fixtures/card-fixture.ts:36-41` `<img ngSrc="trail.svg" width="1600" height="900" alt="A mountain trail at dawn" />` | `<img src="trail.svg" width="1600" height="900" alt="A mountain trail at dawn" />` | LabelAttribute | LabelAttribute `LabelRemoval`: `alt=""` [checked] | "empties plain-string ... `alt`" | `-` (no `getByAltText` or `getByRole('img')` in the card, overlay, frame or breakout specs) |
| ngx-yeti-12 | `apps/yeti-app/src/app/fixtures/frame-fixture.ts:44-47` `<iframe title="Trail notes" srcdoc='...'></iframe>` | `<iframe title="Trail notes" srcDoc="<p>Six miles and one summit.</p>"></iframe>` | LabelAttribute | LabelAttribute `LabelRemoval`: `title=""` [checked] | "empties plain-string ... `title`" | `-` |
| ngx-yeti-13 | `apps/yeti-app/src/app/fixtures/fragment-links-fixture.ts:48` `<svg aria-labelledby="svg-link-text" height="24" width="160">` | `<svg aria-labelledby="svg-link-text" height="24" width="160"></svg>` | LabelAttribute | LabelAttribute `LabelRemoval`: `aria-labelledby=""` [checked] | "empties plain-string ... `aria-labelledby`" | `-` |
| ngx-yeti-14 | `button-fixture.ts:82` `<svg aria-hidden="true" viewBox="0 0 24 24">` | `<svg aria-hidden="true" viewBox="0 0 24 24"></svg>` | HiddenAttribute | HiddenAttribute `HiddenRemoval`: `aria-hidden="false"` [inferred: design says "forces `aria-hidden` off", exact text not given; removing the attribute is the other reading] | "forces `hidden` and `aria-hidden` off. It never forces an element hidden" | `-` (the icon, button and card links are found by role and name only, and the svg has no text) |
| ngx-yeti-15 | `button-fixture.ts:29-38` `<button id="bold" ... [attr.aria-pressed]="bold()" (click)="pressBold()">Bold</button>`, `pressBold(): void` at `:141-144`, referenced once | `const pressBold = () => { setBold((b) => !b); }; ... <button id="bold" type="button" aria-pressed={bold} onClick={pressBold}>Bold</button>` | StateAttribute | StateAttribute `StateNegation`: `aria-pressed={!bold}` [checked]. EventHandler: none [checked, `const` arrow referenced once, here in the attribute]. TextLiteral `{null}` [checked]. ElementRole `ElementToSpan` [checked] | skip: "a `const` whose initializer is a function or an arrow ... when this attribute is the handler's only reference"; `[attr.aria-pressed]` becomes `aria-pressed` | state: `button.spec.ts:225,237` (`aria-pressed` `false` before, `true` after the click); handler is skipped; text `-` (the button is found by `#bold`) |
| ngx-yeti-16 | same origin as 15, with a second reference added | `const pressBold = () => { ... }; ... <button id="bold" type="button" onClick={pressBold}>Bold</button> ... <button id="bold-key" type="button" onClick={pressBold}>Bold</button>` | EventHandler | EventHandler `EventHandlerRemoval`: `onClick={undefined}` on each button (2 mutants) [checked]. TextLiteral `{null}` x2, `ElementToSpan` x2 [checked] | "when the handler is not inline"; the skip no longer holds because the handler has two references. VARIANT: no handler in the repo has a second reference, so the case is built from ngx-yeti-15 | `button.spec.ts:238` (`#bold-presses` text `1`) for the first button |
| ngx-yeti-17 | `button-fixture.ts:39` `<output id="bold-presses">{{ presses() }}</output>` | `<output id="bold-presses">{presses}</output>` | ChildExpression | ChildExpression `ChildExpressionRemoval`: `{null}` [checked]. ElementRole: none (`output` is not swapped) [checked] | "a `{value}` child becomes `null`" | `button.spec.ts:226,238` (`presses` `toHaveText('0')`, then `'1'`) |
| ngx-yeti-18 | `button-fixture.ts:69-77` `<button id="busy" yetiButton type="button" [attr.aria-busy]="waiting()" [attr.aria-disabled]="waiting()">Saving</button>` | `<button id="busy" type="button" aria-busy={waiting} aria-disabled={waiting}>Saving</button>` | DisabledAttribute | DisabledAttribute `DisabledRemoval`: `aria-disabled={false}` [checked]. TextLiteral `{null}` [checked]. ElementRole `ElementToSpan` [checked]. No operator on `aria-busy` [checked: not in the list] | "forces `disabled`, `readOnly`, and `aria-disabled` off" | `-` (`button.spec.ts:424-428` reads `aria-busy` and the ring only) |
| ngx-yeti-19 | `apps/yeti-app/src/app/fixtures/cluster-fixture.ts:24-28` `<ul id="tags-cluster" yetiCluster gap="xs" role="list">` with `<li>layout</li>`, `<li>intrinsic</li>` | `<ul id="tags-cluster" role="list"><li>layout</li><li>intrinsic</li></ul>` | ElementRole | ElementRole `RoleRemoval`: drops `role="list"` [checked]. TextLiteral `{null}` on each `li` text, 2 mutants [checked]. ElementToSpan: none (`ul`, `li`) [checked] | "removes `role`" | role: `cluster.spec.ts:197` (`toHaveAttribute('role', 'list')`); text: `-` |
| ngx-yeti-20 | `apps/yeti-app/src/app/fixtures/button-fixture.ts:28` `<button id="save" yetiButton type="button">Save</button>` | `<button id="save" type="button">Save</button>` | ElementRole | ElementRole `ElementToSpan`: `<span id="save" type="button">Save</span>` [checked]. TextLiteral `{null}` [checked] | "`button` always" | `-` (`#save` is found by id, `button.spec.ts:230`) |

## No JSX equivalent

- `@defer (hydrate never) { ... }`, `@defer (on interaction) { ... } @placeholder { ... }`: Angular deferral
  blocks, `button-fixture.ts:97,119,123`. Wait for Angular template support.
- Host metadata bindings: `'[attr.aria-labelledby]': 'appIdRefs()'` in `generated-ids-fixture.ts:27` (also
  `aria-controls`, `aria-describedby`). A `@Component` `host` object, not markup.
- `[routerLink]="last() ? null : '/replay'"` (`button-fixture.ts:65`) is kept in ngx-yeti-5 as an `href`
  expression, but `null` removes the attribute in Angular, which JSX also does for `href={null}`: faithful.
- Angular-only attributes with no JSX meaning: `i18n`, `i18n-aria-label`, `i18n-alt`, `ngSrc`, `fill`,
  `trackBy` via `@for (... track ...)`.
- `@for (trail of trails; track trail) { <a [href]="'#' + trail">{{ trail }}</a> }` (`cluster-fixture.ts:31-33`)
  would be `trails.map(...)`. That is `ListExpression`, later and not in the first release.

## Not covered

- JSX ternary (`ConditionalToConsequent`, `ConditionalToAlternate`): ngx-yeti has no `@if ... @else` and no
  ternary that picks between two elements, so no mined case. The repo uses `@if` as `x && <A/>` only.
- `StateAttribute` on `aria-expanded`, `aria-checked`, `aria-selected`: only `aria-pressed` appears in
  fixtures (`button-fixture.ts:34`, `buttons-fixture.ts:56,66,125,196,206`). Tab `aria-selected` is set by the
  library, not written in a template.
- `readOnly`, `action`, `to`, `placeholder`, `htmlFor`: absent from the templates.
- Bare `hidden`: absent from templates (only `aria-hidden="true"` on decorative svgs).
- Skip of a handler imported from another file or passed as a prop: no template uses one.

## Open questions in the design

1. `UrlAttribute` on a non-string value (`href={x ? null : "/replay"}`): the design lists the attributes
   but not whether an expression is skipped (ngx-yeti-5).
2. `DisabledAttribute` on `disabled={!live}`: the design skips "shapes that `BooleanLiteral` already flips";
   `!live` becomes `live` there, which is a different mutant from forcing `false`, so this file generates
   (ngx-yeti-1, 5).
3. `HiddenAttribute` on `aria-hidden="true"`: the replacement text (`"false"` or an absent attribute) is not
   written (ngx-yeti-14). Same for a bare `disabled` (ngx-yeti-4).
4. `ElementToSpan` on an `a` whose `href` is an expression that can be `null` (ngx-yeti-5), and whether the
   swapped `span` keeps `href` and `type` (ngx-yeti-3, 6, 7, 20).
5. Whether the single-reference `EventHandler` skip counts a handler used inside `useEffect` or another
   handler as a second reference; only the attribute-plus-attribute shape (ngx-yeti-16) is certain.
