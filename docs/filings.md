# Filing ledger

Drafts of upstream issues found while validating the runner. Lars files from here when he chooses;
nothing in this file has been filed.

## LayZeeDK/lz-engineering-claude-plugins: lz-tdd findings from first real use

Status: open ledger, nothing filed (started 2026-10-26). The `lz-tdd` plugin (0.0.3; skills `lz-red`, `lz-tpp`,
`lz-refactor`) runs here for the first time outside its evals, in the production hardening of both packages. Each
entry gets the skill and version, what it was asked, what it did, what was expected, and the transcript or file
that shows it. No defects so far; four gaps, all about agentic use.

**1. `lz-red` gives no guidance for tests driven by mutation testing.** The ui-mutators worker asked `lz-red` to
drive tests that kill surviving mutants. Step 5 of its procedure calls a test that passes on its first run while it
drives new behaviour a false green, and exempts only characterization tests. A test written to kill a mutant passes
on the original code by design; its red is the mutant. Expected: a case for "the red is the mutant", for example
"apply the mutant, see the test fail, revert". Evidence: `lz-red` SKILL.md step 5, which never names mutation
testing; the worker's red for each such test was the next Stryker run's `killedBy`.

**2. `lz-red` and `lz-tpp` assume one red test at a time.** The runner worker had a test list fixed up front by an
agreed design (7 to 13 tests per contract) and wrote it in one go, then showed the tests red together. `lz-red`
coaches one test per step (Law 2, "one small step"), and `lz-tpp` step 1 requires "exactly one new failing (red)
test", so it gives no order across several red tests. Expected: a batch mode for a test list a design fixes, or an
explicit note that batching is a reasoned deviation. Evidence: `lz-red` SKILL.md step 2 and its Three Laws leaf;
`lz-tpp` SKILL.md "Coach decision procedure" step 1.

**3. `lz-tpp` step 7 conflicts with an implementation brief.** Step 7 says "never edit the developer's code or run
the tests unless explicitly asked". An agent whose brief tells it to implement was not "asked" in the invocation
arguments, so by the skill's own rule it should only coach. Expected: a note that an explicit implementation brief
counts as being asked. Evidence: `lz-tpp` SKILL.md "Coach decision procedure" step 7.

**4. The catalogues are about production code.** `lz-refactor` handled moving top-level test setup into `before`
hooks without wrong advice, but has no entry for test fixture setup or for "fails at load versus fails in a
test", which was the point of that change. On a plain Extract Class, its APPLY/DECLINE count (defined for
patterns) had to be improvised. `lz-red`'s mechanics reference is Vitest-only
(`references/vitest-typescript-mechanics.md`), and this repository uses `node:test`; its "match the house idiom"
step covered the difference.

What worked: `lz-refactor`'s step-1 classification caught a behaviour change inside a refactor commit; `lz-red`'s
"a not-implemented stub is a valid red, an import failure is not" rule made 13 new tests red without a load
failure; its "assert observable behaviour" step fit the cases-table test style.

## stefanoslig/angular-ngrx-nx-realworld-example-app: "View article's author" e2e test always fails

Status: draft, not filed (2026-10-25).

**Versions.** Commit bc7158d (2026-05-09, "chore: migrate to the latest version of nx"),
Playwright 1.64.1, Chromium, Windows 11 arm64, Node 24.22.0. The backend was this repo's local
RealWorld API double (`oss/realworld-api/server.ts`), not the public API.

**Reproduction.**

1. Start the app and a RealWorld backend, then run
   `npx playwright test -c apps/conduit-e2e/playwright.config.ts --project=chromium`.
2. `article-list.spec.ts:19` "View article's author" fails; the other 6 tests pass.

```
Error: expect(locator).toHaveText(expected) failed
Locator:  getByTestId('article-author-profile')
Expected: ""
Received: " anne "
```

**What the test does.** It reads `textContent()` of the first `getByTestId('article-author')`, clicks
it, and expects the profile heading to have that text. In
`libs/articles/feature-article/src/article-meta/article-meta.component.html` that test id is on the
link that holds only the avatar (`<cdt-avatar>`, an `<img>` before 7659b69), so its text is empty or the
avatar's initials, never the username. The `a.author` link next to it holds the username.

**Possible fix.** Read the name from the `a.author` link, or move `data-testid="article-author"` to it.

**Evidence.** The failure without Stryker: the plain Playwright run above, 2026-10-25, 1 failed and 6
passed. The same failure in a Stryker dry run is in a log that later runs overwrote, so the plain
Playwright run above is the reproduction to rely on.

**Same suite: `auth.spec.ts` fails on one worker.** The spec makes `userId` once at module level and
registers it in `test.beforeEach`, so the second test in a worker registers the same user again and
fails with `{"errors":{"email":["has already been taken"],...}}`. Reproduce with `--workers=1`
(2026-10-25: 1 failed, 1 skipped, 5 passed). With several workers each test can land in its own worker,
which hides it. Possible fix: register in `test.beforeAll`, or make the id per test.

**Also noticed.** `apps/conduit-e2e/playwright.config.ts` starts `npx nx run frontend:serve-static`,
but the workspace has no `frontend` project (`nx show project frontend`: "Could not find project
frontend"), so the suite works only next to a dev server someone already started on port 4200.

## stryker-mutator/stryker-js: a `// Stryker disable` directive written as a JSX comment is ignored

Status: draft, not filed (2026-10-26). A search of the repo's issues for "JSX comment disable",
"Stryker disable jsx" and "jsx directive" found no existing report on 2026-10-26.

**Versions.** `@stryker-mutator/instrumenter` 10.1.1, Node 24.22.0, Windows 11 arm64. Built-in
mutators only, no plugin.

**Reproduction.** Instrument this TSX with the stock `Instrumenter` and list the `StringLiteral`
mutants and their status:

```tsx
export function A({ open }: { open: boolean }) {
  return (
    <div>
      {/* Stryker disable next-line StringLiteral */}
      <p title={'one'}>x</p>
      {
        // Stryker disable next-line StringLiteral
        <p title={'two'}>y</p>
      }
      <p title={'three'}>z</p>
    </div>
  );
}
```

Result (2026-10-26): line 5 `'one'` is placed, line 8 `'two'` is `Ignored` ("Ignored using a
comment"), line 10 `'three'` is placed. The JSX comment form on line 4 has no effect and gives no
warning. Inside JSX children, a `{/* ... */}` comment is the only comment form that does not need an
extra pair of braces around the element, so React users reach for it first.

**Cause (read, not debugged).** The directive bookkeeper reads `leadingComments`
(`packages/instrumenter/src/transformers/directive-bookkeeper.ts:76` at v10.1.1). Babel stores a JSX
comment as an inner comment of the `JSXEmptyExpression` in its own `JSXExpressionContainer`, so no
node carries it as a leading comment.

**Possible fix.** When a `JSXExpressionContainer` holds only a `JSXEmptyExpression` with a directive
in its `innerComments`, apply the directive to the next JSX sibling, the way a leading comment applies
to the next statement.

## stryker-mutator/stryker-js: `ConditionalExpression` gives two mutants that render the same for a JSX `&&`

Status: draft, not filed (2026-10-26). A search of the repo's issues for "ConditionalExpression jsx
&&", "equivalent mutant react" and "react true false render" found no existing report on 2026-10-26.

**Versions.** `@stryker-mutator/instrumenter` 10.1.1, built-in mutators only.

**Reproduction.** Instrument this TSX with the stock `Instrumenter`:

```tsx
export function B({ open }: { open: boolean }) {
  return <div>{open && <p>Details</p>}</div>;
}
```

Result (2026-10-26): `ConditionalExpression` gives `true` and `false` for `open && <p>Details</p>`,
and `LogicalOperator` gives `open || <p>Details</p>`. React renders `true` and `false` children as
nothing (React docs, "Conditional rendering"), so the `true` mutant and the `false` mutant both hide
the element: two mutants with the same behaviour, and none that forces the element to show. A test
that checks the element is visible kills both; a test that checks it is hidden kills neither.

**Possible fix.** For a `&&` whose right operand is a JSX element or fragment and that is a JSX child,
replace the `true` mutant with the right operand (`<p>Details</p>`), which forces the element to show
and is the mutant `true` stands for in plain JavaScript. A smaller fix drops the `true` mutant there.

**Context.** `@layzee/stryker-ui-mutators` in this repo adds that force-show mutant as
`ConditionalElement`, and skips a `&&` whose left operand is a comparison or a logical expression,
because there the built-in `true` already exists. An upstream fix would make that skip need revisiting.
