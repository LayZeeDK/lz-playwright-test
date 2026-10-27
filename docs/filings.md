# Filing ledger

Drafts of upstream issues found while validating the runner. Lars files from here when he chooses;
nothing in this file has been filed.

## LayZeeDK/lz-engineering-claude-plugins: lz-tdd findings from first real use

Status: open ledger, nothing filed (started 2026-10-26, last updated 2026-10-27). Plugin: `lz-tdd` 0.0.3
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

**O14. `lz-refactor` has no route for a public rename the owner already approved.** Asked to apply Rename across
both packages after Lars ruled on the new names, `lz-refactor` routed to Fowler's Rename / Change Function
Declaration, and step 5 says to pause and ask before changing an exported or public-API symbol whose consumers the
local tests do not cover. The owner's ruling is that ask answered; the skill has no case for it, so the worker went
ahead on the ruling. Evidence: `lz-refactor` SKILL.md step 5; `.audit/prod/rename/progress.md` (local, gitignored).

O8 gained one more case on a Linux-only bug (a port check that read a live server as down): `lz-red` step 5's
"a test that passes on its first run while driving new behavior is a false green" ruled out a real-socket test,
which passes on Windows before the fix, in favour of a test through the injected `connect` seam that fails on every
OS with an AssertionError on the value.

**O15. `lz-tpp`'s list says nothing useful about a boundary guard.** A worker turned on typescript-eslint's
`no-unsafe-*` rules and added runtime checks in six places, each test-first (2026-10-27). Every green step was
"(unconditional -> if)" plus a parse of an `unknown` value, so naming the transformation added nothing. The list
ranks ways to grow an algorithm, and a guard at a trust boundary is not one. Evidence:
`.audit/types/step3-notes.md` (local, gitignored), "lz-tdd friction".

**O16. Neither skill covers a guard whose mutants the type checker rejects.** With Stryker's TypeScript checker
on, mutating a narrowing check on an `unknown` value often yields a compile error, which does not count against the
score. Where it compiles, a test must kill it. This decided which tests the worker wrote in the same run, and
neither `lz-red` nor `lz-tpp` mentions it. Evidence: the same notes file, which names the test meant to kill each
compiling mutant.

**O17. Neither skill says how many reds a multi-field parser needs.** A worker replaced two casts with parsers
that check several fields each and throw on the first bad one (2026-10-27). `lz-tpp` sees one "(unconditional ->
if)" step for the whole parser. Under a 100% mutation score each field's check needs its own failing test, since
one red per parser leaves every other field's condition mutant alive. Neither skill says to split the reds by
field. Evidence: `.audit/types/step4-notes.md` (local, gitignored), "lz-tdd friction".

O3 and O4 held again in the same run: both skills said to coach and not to write or run the code, against the
brief, and `lz-red`'s mechanics leaf is still Vitest-only in a `node:test` repo.

**O18. A test list generated from a table breaks the one-red-at-a-time loop.** A worker replaced a check of one
Babel member with a check of 38 (2026-10-27). Following O17, it generated one red per member from the member list,
which gave about 60 failing tests at once, and turned them green in one step. The list had to exist in production
code before its reds could be generated, which runs against the first of the Three Laws. Under Node's type
stripping, tests that used the not-yet-written API failed as TypeErrors at the point of use, which `lz-red` counts
as a valid but blunter red. Evidence: `.audit/types/step3b-notes.md` (local, gitignored), "lz-tdd friction".

**O19. `lz-refactor` step 4 has no line for mutation cost.** In a code smell review of both packages (2026-10-27),
every reviewer counted mutants added and removed outside the skill, because in this repo the mutation score decides
whether a refactoring pays. Step 4 counts classes, types, files and indirection only. Two fixes showed costs the
count misses. Merging three consistent `toLowerCase` calls into one helper turned a killed mutant into a survivor,
because the tests had relied on the copies disagreeing. The cost of a narrowing helper depended on how many of its
mutants the TypeScript checker turns into compile errors. Evidence: `.audit/refactor/round1-synthesis.md`, item 1;
the "lz-tdd friction" sections of `chunk-a.md` to `chunk-e.md`, `chunk-f1.md`, `chunk-f4.md`, `fixF2-notes.md` and
`fixTF2-notes.md` in the same folder (local, gitignored).

**O20. `lz-refactor` has no read-only survey mode.** The review briefs asked for suggestions across whole files and
forbade running tests, nx or Stryker. The coach procedure assumes one smell, a developer waiting to apply it, and a
coach that may run the tests. The whole-package sweep applies its changes. Four reviewers borrowed coach mode one
smell at a time, and the skill gave them no way to mark each effect as unverified. The step-5 loop audit is framed
around code the skill refactored, so in this mode it had nothing to compare against and ran on the files as read.
Evidence: `round1-synthesis.md`, items 2 and 4; `chunk-a.md` to `chunk-d.md` (local, gitignored).

**O21. "Run the tests after each step" does not fit steps that compile only together.** Two fix workers moved a
function whose old export and about 30 callers had to change at once. Splitting the move would have meant a
temporary shim export. A unit-test run goes through `nx run-many` and takes about 30 seconds, so both workers ran
the full check once after all steps. A third worker could not run the browser tests while another session held the
machine lock, and checked each step by type-check and lint only. `lz-refactor` step 5 has no case for any of these.
Evidence: `fixTF1a-notes.md`, `fixTF1b-notes.md`, `fixTF5-notes.md` (local, gitignored).

**O22. Step 4's count cannot rank or break ties, and it misses costs outside the structure.** Nearly every Extract
Function "adds 1 function", so the verdict turns on how a reviewer weighs a duplicated rule against a function. The
procedure does not define that weight. "Obscurity clarified" counts as a removal with no unit. Several APPLY
verdicts in one review had no order. The tie rule declined one-for-one extractions that would have made a
`try`/`finally` clearer. For a mechanical Extract Function over test duplication, the verdict is always APPLY and
says little. Fix workers that got already-triaged verdicts used only the apply mechanics. The count also has no
place for churn (a move that rewrites about 50 tests to `async` still scores APPLY), for a lost one-to-one trace
from test rows to their source rows, or for parameter defaults that the extraction makes dead. For Remove Flag
Argument against Inline Function, the skill gave no tie-break when the wrapper carries a default that differs from
the factory's. Evidence: `round1-synthesis.md`, items 3 and 11; `chunk-a.md`, `chunk-b.md`, `chunk-e.md`,
`chunk-f2.md`, `chunk-f3.md`, `chunk-f5.md`, `fixF1-notes.md`, `fixF5-notes.md`, `fixTF2-notes.md`,
`fixTF4-notes.md` (local, gitignored).

**O23. The loop audit ignores the project's own rules and settings.** Step 5's loop audit marks a loop with a side
effect "no" and leaves `for...of` in place. The house rule in this repo asks for `forEach` there. Test files are
full of such loops, because registering one test per row is a side effect. Reviewers split the verdict in two, and
fix workers followed the house rule against the audit. The audit's only exemption is a measured hot path. It has no
outcome for a path that is probably hot but never measured, or for a loop the lead kept by ruling. Its pipeline
targets skip the project's `lib` setting (`Map.groupBy` needs ES2024, and the repo has `lib: ["es2022"]`). They
also skip the type checker. The review synthesis proposed a `.filter(...).forEach(...)` that does not narrow the
destructured `coverage`. On an audit-only pass, the skill does not say whether the audit covers every loop in scope.
Evidence: `round1-synthesis.md`, item 4; `chunk-b.md`, `chunk-c.md`, `chunk-e.md`, `chunk-f2.md` to `chunk-f5.md`,
`fixF3-notes.md`, `fixF4-notes.md`, `fixTF3-notes.md`, `fixTF4-notes.md`, `fixTF6-notes.md` (local, gitignored).

**O24. The smell index misses several production-code cases.** No entry fits a helper whose name promises an
invariant that its callers enforce. Inline code next to a helper that already does the same work lands under
Duplicated Code, whose leaf leads to Extract Function and not to Replace Inline Code with Function Call. In one fix,
the step that removed the most code reused an existing helper (`tempTree`) as the target of Move Statements into
Function, and no entry covers that reuse. The catalogs are value-level and say nothing about type-level
duplication. The Decompose Conditional leaf assumes `if`/`else` and has no note on a generator with `yield*`
delegation as the extracted function. Evidence: `round1-synthesis.md`, item 5; `chunk-a.md`, `chunk-d.md`,
`chunk-e.md`, `fixF4-notes.md`, `fixTF4-notes.md` (local, gitignored).

**O25. `lz-refactor` treats the tests as a fixed oracle, which fails when the refactoring touches them.** For test
code, the only check that a refactoring keeps the tests' killing power is the mutation run (the test-code score and
the `src` score). The skill does not say so. Workers kept assertions identical or compared assertion counts
instead. Three test refactorings left the skill silent. A Substitute Algorithm on a test replaced its assertions. A
refactoring changed the fixture a test runs in (a hand-built page without `sessionStorage` became the shared one)
and kept the oracle. A behaviour-preserving Move Function turned a structural test red that pins the module graph,
and the skill does not say whether a refactor step may edit such a test. In a test, a copied literal can be the
oracle (the `OWN` symbol key), yet Duplicated Code leads straight to Extract Variable, which would weaken the test.
How the Stryker test runner assigns coverage from hooks decided one move from a hook to per-test setup, and the
skill leaves it out. Evidence: `round1-synthesis.md`, items 9 and 10; `chunk-f1.md`, `chunk-f3.md`, `chunk-f4.md`,
`chunk-f5.md`, `fixF1-notes.md`, `fixTF1a-notes.md`, `fixTF3-notes.md`, `fixTF5-notes.md` (local, gitignored).

**O26. Step 5's public-API pause does not separate module exports from package exports.** It speaks of exported
symbols. In this repo the line that matters is the package entry point, `src/index.ts`. Evidence:
`round1-synthesis.md`, item 6; `chunk-c.md` (local, gitignored).

**O27. No skill covers a change that undoes an earlier behaviour change.** A fix restored behaviour that an earlier
refactoring had changed. `lz-refactor` says to write a characterization test that passes on the old code first, but
this pinning test had to fail on the current code. The change is neither a green step for `lz-tpp` nor a pure
refactoring. Evidence: `fixF5-notes.md`, A2b (local, gitignored).

**O28. A data-driven first test admits no small transformation.** A worker built a parser whose first test reads 53
entries from three real fixtures. All three parse to the same table, so a hard-coded constant table would pass. The
worker took the whole parser as one `lz-tpp` step and pinned its regex details with synthetic inputs instead of
triangulating them one at a time. A second worker took a script in one step for the same reason. A stub that writes
a constant file would pass its success case only by copying the fixture's table. That case's red was the import of
a missing output file inside the test body. `lz-red` accepts that red, and a sharper one needs a stub that writes a
wrong file, which is code written only to fail. Evidence: `fixF7a-notes.md`, `fixF7b-notes.md` (local, gitignored).

O1 held again in the same two fixes. Most mutant-killing tests were pins that passed on their first run, because a
larger green step had already brought their behaviour. `lz-red` calls a first-run pass on new behaviour a false
green. The workers showed each red by applying the mutant by hand. Evidence: `fixF7a-notes.md`, `fixF7b-notes.md`.

O3 held again. `lz-red` and `lz-tpp` both defaulted to coaching only, and the brief overrode them. The skills allow
writing on an explicit command but phrase it as "write the failing test and then stop". Evidence: `fixF7a-notes.md`.

O4 held again on `node:test` mechanics. An extraction that moved a `t.after` registration needed a separate check of
the `node:test` hook order, and the skills do not cover cleanup order. Evidence: `fixTF1b-notes.md`.

O5 held again for test code, in more detail. The catalog has no test smells. Shared fixture state in a hook, a
missing per-test setup, a hand-built double that bypasses the shared one, Mystery Guest, assertion idioms that hide
the failure, and duplicate test rows were filed under Global Data, Mutable Data, Duplicated Code or Oddball
Solution. Meszaros's names (General Fixture, Obscure Test, Test Code Duplication, Mystery Guest) fit better. The
move from a hook to per-test setup with `t.after` cleanup has no named refactoring and borrowed Move Statements into
Function. Evidence: `round1-synthesis.md`, items 7 and 8; `chunk-f1.md` to `chunk-f5.md`.

O6 held again for test data. Removing a twin test row borrowed Remove Dead Code, though a twin is redundant
coverage and not unreachable code. Evidence: `chunk-f5.md`.

O17 held again for a Substitute Algorithm. The new condition joins two operands with `&&`, and one operand had no
test that fails when only that operand is wrong. `lz-refactor`'s advice to write characterization tests does not ask
for one test per operand. Evidence: `fixF2-notes.md`, D6.

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

**S13 (from O14).** In `lz-refactor` step 5, say that an owner's recorded approval of the public change (a ruling,
an issue, a brief that quotes it) answers the pause, and that the refactoring then proceeds with the consumers'
breakage stated in the commit.

**S14 (from O15).** Give `lz-tpp` a short case for a guard at a trust boundary: the green step is the check plus
its error, and the choice that matters is where the parse happens, not which transformation it is.

**S15 (from O16).** In `lz-red`, for a repo with a mutation score and a type checker, say to write a test for each
guard mutant that compiles and to leave out the ones the checker rejects, and say how to tell the two apart.

**S16 (from O17).** In `lz-red`'s test-selection leaf, say that a parser or guard that checks several fields gets
one failing test per field, each with only that field wrong, and that this is the test list a mutation score
asks for.

**S17 (from O18).** Give `lz-red` a case for a table-driven test list: write the table as test data first, run its
reds as one batch, and say whether the table belongs in the test or in the code under test.

**S18 (from O19).** Add an optional mutation line to step 4's count for repos with a mutation-score gate: mutants
removed, mutants added, and tests that must change. Warn that merging copies of a rule into one site can let a
mutant survive that the copies' disagreement used to kill. Say that a type checker turns some added mutants into
compile errors, which do not count.

**S19 (from O20).** Add a survey mode to `lz-refactor`. It lists smells and verdicts across files, applies nothing,
runs nothing, and marks each effect as unverified. Say whether the loop audit runs on the code as read in that mode.

**S20 (from O21).** In step 5, allow a step to be a group of edits that compile only together. Allow one test run
after a group of steps when a run is slow or not available, and have the record name the check used instead
(type-check, lint).

**S21 (from O22).** Give step 4 a tie-break and an order. Say how to weigh a duplicated rule against a new function,
give "obscurity clarified" a unit or drop it, and say how to rank several APPLY verdicts. Count churn (call sites
touched) and lost traceability on the added side, and defaults the extraction makes dead on the removed side. Allow
a short form for mechanical Extract Function and for refactorings that arrive already triaged.

**S22 (from O23).** Let the loop audit defer to a stated house rule (`forEach` for side-effect loops, test
registration included) and to an owner's ruling, and add "probably hot, not measured" as its own outcome. Check each
proposed pipeline against the project's `lib` setting and the type checker before suggesting it. Say that an
audit-only pass covers every loop in scope.

**S23 (from O24).** Add smell index entries for a helper whose name promises an invariant its callers enforce, for
inline code next to a helper that does the same work (Replace Inline Code with Function Call, with an existing
helper as a possible move target), and for type-level duplication. Add a generator note to Decompose Conditional.

**S24 (from O25).** Add a section on refactoring tests. The check is the mutation run on the test code and on
`src`, or unchanged assertions when that run is not available. Say when a changed fixture or a replaced assertion
still counts as behaviour-preserving, and whether a refactor step may edit a structural test. Warn that a
duplicated literal in a test can be the oracle. Note that how the mutation tool's test runner assigns coverage from
hooks can decide a setup move.

**S25 (from O26).** In step 5, separate module exports from package exports, and tie the pause to what the package
entry point exposes.

**S26 (from O27).** Add a case for a change that restores earlier behaviour. Its pinning test fails on the current
code, so it runs as a red-green fix with `lz-red` and `lz-tpp`, not as a refactoring.

**S27 (from O28).** Give `lz-tpp` a case for a first test that only the whole implementation passes, such as
fixtures that parse to one table. Take that step whole, then pin the details with synthetic inputs. In `lz-red`,
say whether a stub written only to sharpen a red is worth its code.

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

**Context.** `@layzee/lz-stryker-ui-mutators` in this repo adds that force-show mutant as
`LzConditionalElement`, and skips a `&&` whose left operand is a comparison or a `&&` or `||` expression,
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
