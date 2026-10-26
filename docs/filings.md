# Filing ledger

Drafts of upstream issues found while validating the runner. Lars files from here when he chooses;
nothing in this file has been filed.

## LayZeeDK/lz-engineering-claude-plugins: lz-tdd findings from first real use

Status: open ledger, nothing filed (started 2026-10-26, last updated 2026-10-26). Plugin: `lz-tdd` 0.0.3
(`lz-red`, `lz-tpp`, `lz-refactor`), in its first real use outside its evals: the production hardening of
`@layzee/stryker-playwright-runner` and `@layzee/stryker-ui-mutators` by four agent workers (Opus 5.5), each
following an implementation brief. Workers record findings in their progress files
(`.audit/prod/mutation/*-progress.md`, `.audit/prod/arch/impl-progress.md`; local, gitignored); Claude sorts them
into the three lists below. A finding is a bug report only when it comes with a minimal reproducible example: the
skill, its version, the exact prompt or invocation, the input files, what the skill did, and what it should have
done. Without one it stays an observation.

### Bug reports

None so far. No skill gave advice that was wrong for the case in front of it.

### Observations

**O1. Guard tests have no red in `lz-red`.** Asked to drive tests that kill surviving mutants (ui-mutators worker)
or that fail when an existing feature is removed (runner units A and B), `lz-red` step 5 offered two kinds: a
driver, whose red is missing behaviour, and a characterization pin, "green by construction". Both kinds of guard
test are neither: they pass on the current code, and their red comes from applying the mutant or reverting the
feature by hand. The workers treated them as pins and showed red by hand. Cost: one gate test first passed against
the broken gate (an `eval` thread has no entry argv); only the hand revert exposed it. Evidence: `lz-red` SKILL.md
"Coach decision procedure" step 5; runner progress file, unit B log.

**O2. One red test at a time.** The runner refactor worker had a test list fixed up front by an agreed design (7 to
13 tests per contract), wrote it in one go and showed the tests red together. `lz-red` coaches one test per step
(step 2, "one small step"), and `lz-tpp` step 1 requires "Exactly one new failing (red) test", so neither gives an
order across several red tests. Evidence: `lz-red` step 2 and `references/three-laws-and-test-selection.md`;
`lz-tpp` "Coach decision procedure" step 1.

**O3. Coach-only defaults conflict with an implementation brief.** `lz-tpp` step 7 says "Never edit the developer's
code or run the tests" unless asked, and `lz-red` step 5 says "do not run the suite unprompted". An agent whose
brief tells it to implement and verify was not asked in the skill's invocation arguments, so by the skills' own
rules it should only coach. The workers followed their briefs. `lz-refactor` step 5's "commit only when asked" has
the same gap: a brief that requires one commit per fix is that ask (round 2 fix worker). Evidence: `lz-tpp` step 7;
`lz-red` step 5; `lz-refactor` step 5.

**O4. Unit-test scope.** `lz-red` is about "the next FAILING (red) unit test"; two of the three feature tests unit A
sharpened are browser integration tests (real Playwright and Chromium), and the skill has nothing on them. Its
red-bar mechanics reference is Vitest-only (`references/vitest-typescript-mechanics.md`); this repository uses
`node:test`, and step 3's "match the house idiom" covered the difference each time.

**O5. `lz-refactor`'s catalogue is about production code.** It handled moving top-level test setup into `before`
hooks, and declaration annotations that replace `as` expressions so Stryker mutates the code inside (StrykerJS
10.1.1 mutates nothing inside `expr as Type`), without wrong advice. Neither has a catalogue entry: no test-fixture
setup, no "fails at load versus fails in a test", no refactoring around a tool's blind spot. On a plain Extract
Class its APPLY/DECLINE count, defined for patterns, had to be improvised. In the review round the same count did
fit a test-file split (removes 7 duplicated double builders > adds 3 support files) and a Replace Derived Variable
with Query (removes 2 derivations > adds 1 local), so the gap is in the catalogue, not the count. Moving a harness
to a shared module while each test keeps its own `before()` dynamic import had no entry either.

**O6. A mutation-driven batch routes around the skills.** The worker that took the runner's source mutation run
from 92.56% to 100% loaded no lz-tdd skill: 49 surviving or uncovered mutants, one test each, checked by the next
Stryker run (about 6 minutes per run, inside one lock window). With no guard-test red (O1) and one red per step
(O2), it had no route for the batch. Its one refactor commit, six deletions of code that runs but cannot change
an outcome, was then reviewed with `lz-refactor` after the fact: it routed the commit to Fowler's Remove Dead Code,
whose "Use when" is "code is no longer executed or referenced", which does not cover executed-but-redundant code.
Evidence: runner progress file, unit B continuation; `references/fowler-catalog/remove-dead-code.md`.

**O7. A review-fix list does not trigger the skills, even when the brief names them.** In the review round on
2026-10-26, the brief for the fix workers quoted "Use the lz-tdd plugin where applicable" and said "A bug fix
starts with its failing test (lz-red); a behaviour-preserving change is a refactor (lz-refactor)". The ui-mutators
worker fixed three bugs test-first and made eight refactors, and loaded no lz-tdd skill: it showed each red by
hand, and the unchanged case tables guarded the refactors. Unit C of the runner (test-code mutation at 100% on the
first run) had nothing to write, so it is no evidence either way. The descriptions trigger on a developer's coaching
questions ("what test should I write next?", "anything you'd refactor?"); a worker that holds a list of fixes asks
none of them. After Claude told the runner's two fix workers to load the skills with the Skill tool, naming the
skill per row, both did: `lz-red` before the reds of two bug fixes, `lz-refactor` as a command for seven
refactors. Naming the tool call was enough. Evidence: `.audit/prod/review/fix-brief.md`, `fix-U-progress.md`,
`fix-R-progress.md`, `fix-R2-progress.md` (local, gitignored); the three skills' `description` fields.

**O8. What worked.** `lz-refactor` step 1 caught a behaviour change inside a refactor commit (a lock release on a
failed init). `lz-red` step 5's "a not-implemented throw ... is a valid but blunter red" let 13 new tests go red
without a module-load failure, and its "the failure must originate in the code under test" kept a child-process
test's red on the hook's own TypeError rather than on a spawn failure. Step 3's message-matrix route fitted a shell
whose outgoing calls are what to assert. Step 4's "assert observable behaviour" fitted the cases-table style. On a
fail-loud fix, step 5 had the red run first and got `AssertionError: Missing expected exception` from the code under
test, and step 3's house idiom picked `assert.throws` with a message pattern.

**O9. No route for growing a test double.** A Node-coverage bug's red needed a state the fake `test.info()` could
not express (which hook or fixture is running). `lz-red` step 3 (house idiom) and "listen to the tests" both apply,
but neither says whether adding a field to the double is the normal move or design feedback. Here it was the normal
move. Evidence: `fix-R-progress.md`, R1.

**O10. `lz-refactor` has no smell for a type assertion.** Three of the five refactor rows in round 2 removed casts
(`as`, `as unknown as`, `{} as never` in test doubles and a module's private state). Each went through a
neighbouring smell with an improvised step-4 count. Evidence: `fix-R2-progress.md`, A1, A3, A7.

**O11. Primitive Obsession's candidates are class-shaped.** For a string slot type matched against string sets,
the candidates were Replace Primitive with Object and Replace Type Code with Subclasses; step 4 declined both, and
the fallback "a discriminated union" (here a string-literal union parsed at the boundary) was the right answer.
The decision came from the fallback, not from a listed candidate. Evidence: `fix-R2-progress.md`, A1.

**O12. `lz-refactor` has no route for a preparatory refactoring.** In the security fix round, a worker extracted
a test's setup into a helper before writing the two tests that would repeat it. Step 1 wants passing code that has
a smell now, and step 4 counts what the refactoring removes now; here the two copies it removes did not exist yet,
so the worker counted future copies. Beck's "make the change easy, then make the easy change" has no entry.
Evidence: `lz-refactor` SKILL.md steps 1, 2 and 4; `.audit/prod/review/fix-S-progress.md`, S3 (local,
gitignored).

**O13. A mutation-score rule shapes the green step, and the skills say nothing about it.** Under "Mutation score:
100%", the same worker wrote each green so it leaves no equivalent mutant: it moved a file read into an existing
`try` instead of adding a `catch { return undefined }`, and used a symbol as its own mark value instead of `true`,
so no boolean-literal mutant could survive. `lz-tpp` picks transformations by priority only, and `lz-red` does not
mention tests written to kill a mutant that other tests cannot reach. Evidence: `fix-S-progress.md`, S1 and S3.

O3 held again in that round: each invocation said the worker writes and runs the test itself, and the skills'
text still says not to run the suite unprompted. O8 gained one more case: `lz-red` step 5's "an import failure is
a prerequisite to clear, not the red" made the worker export a constant before running the red, so the red came
from the function under test and not from ESM linking.

### Suggestions

**S1 (from O1).** Give `lz-red` step 5 a third kind beside driver and pin, a guard test: it passes on the current
code, and its red is shown by applying the mutant or reverting the feature, running it, and reverting back.
Mutation testing is the common source of such tests.

**S2 (from O2).** Say what to do with a test list a design fixes up front: either order the reds and hand them
forward one at a time, or allow a batch with the reason stated.

**S3 (from O3).** State that an explicit instruction to implement and run tests, in the invocation or in the brief
the agent works under, counts as being asked.

**S4 (from O4).** Either say the skills are unit-test scoped and what to do for integration tests, or add an
integration-test note; add a `node:test` mechanics leaf beside the Vitest one.

**S5 (from O5).** Add `lz-refactor` entries for test-setup refactors and for refactoring so a tool (a mutation
tester, a coverage tool) can see the code.

**S6 (from O6).** Widen Remove Dead Code, or add a sibling entry, for code that runs but that no input can
observe, which a surviving mutant often exposes: what proof it needs (why no input tells the two versions apart),
and that deleting it beats a `// Stryker disable` comment. S1's guard-test kind could point there for a survivor
no test can kill.

**S7 (from O7).** Add trigger phrases for an agent's own work, not only a developer's questions: "fix this
finding test-first", "write the regression test for this bug", "refactor this without changing behaviour". Or
state in each description that an implementation brief naming the skill is an invocation.

**S8 (from O9).** In `lz-red` step 3, say that a test double gaining the one field a bug's input needs is the
ordinary move, and when it is instead a sign that the seam is wrong.

**S9 (from O10).** Add a "Type assertion" smell with candidates and a step-4 count for each: narrow at the boundary
with a type guard, `implements` on a fake, a typed test double, `satisfies`, a narrower parameter type
(`Pick<T, 'used'>`).

**S10 (from O11).** For TypeScript, list a string-literal or discriminated union as the first candidate for
Primitive Obsession, before the class-shaped ones.

**S11 (from O12).** Add a preparatory-refactoring route to `lz-refactor`: a refactoring done so that the next test
or change is easy, with a step-4 count over the change about to be made, and the rule that it lands green before
the next red.

**S12 (from O13).** Add a short note to `lz-tpp`: when a project gates on mutation score, prefer the
transformation that leaves no equivalent mutant, and say which shapes create them (a separate `catch` that returns
a default, a boolean literal used only as a mark).

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
`ConditionalElement`, and skips a `&&` whose left operand is a comparison or a `&&` or `||` expression,
because there the built-in `true` already exists. An upstream fix would make that skip need revisiting.

## stryker-mutator/stryker-js: no mutants inside an `as` expression (already reported)

Status: no draft needed (2026-10-26). Reported upstream as
[#6208](https://github.com/stryker-mutator/stryker-js/issues/6208) and
[#6227](https://github.com/stryker-mutator/stryker-js/issues/6227), with a fix proposed in
[#6228](https://github.com/stryker-mutator/stryker-js/pull/6228), all open on 2026-10-26.

**What it cost here.** `@stryker-mutator/instrumenter` 10.1.1 lists `TSAsExpression` among its type nodes
(`dist/src/util/syntax-helpers.js:140`), so it makes no mutant anywhere inside `expr as Type`. Measured on
2026-10-26: `export const a = [1 + 1] as const;` gives none, while the same line with `satisfies number[]`
or with no suffix gives ArrayDeclaration and ArithmeticOperator. The UI operators' table was written as
`[...] as const satisfies ...`, so a mutation run scored 100% with no mutant in any rule body; the
package now builds the table through a helper with a `const` type parameter, and the run then found 15
survivors. Worth a comment on #6208 if Lars wants one: a `const` assertion is the common case, and it
hides the most code.
