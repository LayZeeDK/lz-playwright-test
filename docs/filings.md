# Filing ledger

Drafts of upstream issues found while validating the runner. Lars files from here when he chooses;
nothing in this file has been filed.

## LayZeeDK/lz-engineering-claude-plugins: lz-tdd findings from first real use

Status: open ledger, nothing filed (started 2026-10-26, last updated 2026-11-07). The plugin is a prerelease.
Lars, 2026-11-07: it "failed to verify its lz-refactor worth with evals in the PR branch we're currently running
as the lz-tdd plugin"; he asked that its use go on and that this ledger record experiences and issues, including
cases where `lz-tpp` is not a good fit for the green step. Plugin: `lz-tdd` 0.0.3
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

**O29. `lz-refactor` has no step for checking an earlier refactoring.** Every procedure starts from recognizing a
smell and treats each smell as found fresh. In round 2 of the code smell review (2026-10-30), several findings were
smells that round-1 fixes had created, after step 4 had counted those fixes as APPLY. The skill had no way to call
such a cost a regression of an earlier fix. Reviewers of already-triaged items built their "considered and not
raised" lists outside the skill, because it has no notion of a decline that still stands. In round 3 (2026-10-31),
most of the audit confirmed that 29 earlier refactorings held, and the result table sat outside the skill. One
implementer rightly chose another shape than a triage ruling asked for. Step 4 can say DECLINE but not "amend the
ruling". Two round-3 findings were smells the change had moved elsewhere, such as duplication swapped for diverging
semantics, and no smell leaf matched. Evidence: `round2-synthesis.md`, "lz-tdd friction", item 3; the same sections
of `r2-runner-src-closed.md`, `r2-runner-test-b-closed.md`, `r2-ui-test-closed.md`, `r3-closed.md` and
`r3-neutral.md` (local, gitignored).

**O30. Step 4 compares unlike units.** A dependency edge, a drift risk and a test-only export are not duplication
sites or obscurity. In round 2, one reviewer had to invent a count of "modules loaded for nothing" to set a module
that imports from the wrong neighbour against "adds 1 file". Another needed prose to justify APPLY for the same
items. A shared test double that drags modules in at import had the same problem. In a round-2 fix, step 5's
public-API guard covered consumers but not the Nx module boundary rule, which a behaviour-preserving move can break.
Evidence: `round2-synthesis.md`, "lz-tdd friction", item 6; the same sections of `r2-ui-src-closed.md`,
`r2-ui-src-neutral.md`, `r2-runner-test-b-closed.md` and `fixU2-B-notes.md` (local, gitignored).

**O31. No guidance for an arrange step that shares code with the subject under test.** In round 2, a test built its
environment with `stubEnv`, a helper that calls `setEnv`, which is the code under test. Replace Inline Code with
Function Call scored APPLY. Test independence argued the other way, and step 4 had no place for that argument.
Evidence: `round2-synthesis.md`, "lz-tdd friction", item 10; `r2-runner-test-b-closed.md`, item 3 (local,
gitignored).

**O32. Step 4 cannot say that a duplicate is weaker than its original.** In round 2, a copied lookup in a test
dropped the existence assert of the original. The duplication was one rule against one added member, so the count
forced a DECLINE. The count had no way to record that the copy is less safe, which was the reason to fix it.
Evidence: `round2-synthesis.md`, "lz-tdd friction", item 11; `r2-runner-test-a1-neutral.md` (local, gitignored).

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

O5 held again in round 2. Duplicated arrange blocks, hand-rolled teardown beside a shared fixture helper, a helper
called for a result it discards, table-driven test lists and fixture literals shared across files were mapped by
hand to Duplicated Code and Fowler moves. Evidence: `round2-synthesis.md`, "lz-tdd friction", item 8.

O19 held again in all twelve round-2 reviews and in round 3. Each stated mutant effects outside the verdict line.
Round 2 added that for test code under an assertion-only Stryker config, the cost is assertions added, merged or
removed. A round-2 fix found that a guard that never runs leaves an uncovered mutant, which only the reviews had
said. Evidence: `round2-synthesis.md`, "lz-tdd friction", item 1; `r3-closed.md`; `fixU2-C-notes.md`.

O20 held again in round 2. The skill has no notion of a review scope since a base, of a smell present at the base,
or of a smell the change already removed, which was most of every diff. Scope came from the briefs alone. Evidence:
`round2-synthesis.md`, "lz-tdd friction", item 2.

O21 held again. A round-2 fix could not run the browser tests, so it checked four items together by type-check and
lint. Evidence: `fixR2-C-notes.md`.

O22 held again in rounds 2 and 3. A one-for-one Extract Function had no verdict for "only if a house rule wants one
home". The skill does not name folding test copies into an existing table (Parameterize Function over rows) as the
way out of the tie, nor count reuse of a file's own idiom as adding nothing. Rename, Remove Middle Man, Slide
Statements and Replace Inline Code with Function Call always score "removes N > adds 0", which misses churn of 21
call-site edits. The skill does not say whether a moved function counts as added. Fix workers again found that the
count adds nothing to pre-triaged items. Evidence: `round2-synthesis.md`, "lz-tdd friction", items 4 and 5;
`r3-neutral.md`; `fixU2-A-notes.md`, `fixU2-B-notes.md`, `fixU2-C-notes.md`.

O23 held again in rounds 2 and 3. The house rule asked for `forEach` where the audit marks a side-effect loop "no".
The audit's scope, "the code you refactored", is undefined in a diff audit, and in round 3 it ran over loops a
previous round had already converted. It has no answer for iteration that a library owns, such as a Babel visitor
callback. A short form for "every loop has a side effect" would save the per-loop listing. Evidence:
`round2-synthesis.md`, "lz-tdd friction", item 9; `r3-closed.md`; `r3-neutral.md`.

O24 held again in rounds 2 and 3, with new gaps. The index has no entry for two clear-looking names that mean
different things in one module, for a comment made false by a behaviour-preserving refactoring or one that restates
configuration, for a shadowed name, for production code that exists only for tests, or for a lookalike Unicode
literal. It has no Replace Magic Literal leaf and no name for turning a callback into a return value. Insider
Trading fits a misplaced shared helper only loosely. The skill does not ask whether a repo tool may import package
source, which depends on the build graph. Round 3 added a constant returned from a parameterized helper. Evidence:
`round2-synthesis.md`, "lz-tdd friction", item 7; `r3-closed.md`, item 3; `fixU2-C-notes.md`.

O26 held again. A round-2 fix judged its public-API pause by `src/index.ts` and not by module exports. The skill
does not say to do that. Evidence: `fixU2-A-notes.md`.

The entries from O33 on come from the server support work (2026-11-04 to 2026-11-07): about 100 cycles by
workers and by Claude, each logged as red, green and refactor in a cycle log (`step5-u*-cycles.log`,
`step5-mutation*-cycles.log`, `bug-arrival-cycles.log` in the session scratchpad, local). O33 to O38 are cases
where `lz-tpp` did not fit the green step.

**O33 (lz-tpp fit). The green step picked a platform hook, not a code shape.** Tagging a server's outgoing requests
with the test id went through three mechanisms: a `globalThis.fetch` wrapper, then a `diagnostics_channel`
subscriber on `undici:request:create`, then a patch of `http.Agent.prototype.addRequest`. Each swap came from
`lz-tpp`'s impasse check, which ended in "the low-priority swap" because no simpler test existed. What decided each
step was which Node.js hook sees every redirect hop and every port, a fact settled by running the test, and the
list has no entry for swapping one hook for another. Evidence: `step5-u9-cycles.log`, cycles 3 and 7.

**O34 (lz-tpp fit). Behaviour about how, not what.** An atomic write (temp file plus rename) was the behaviour
under test, so the worker skipped `(nil -> constant)` and wrote the statements whole, and logged that as a
deviation. Picking a free port by binding port 0 was labelled `(expression -> function)` with "OS behaviour, no
simpler transformation passes". The list ranks ways to compute a value; when the test pins a side effect's
mechanism, the first and only passing change is the mechanism. Evidence: `step5-u3-cycles.log`;
`step5-u4-cycles.log`.

**O35 (lz-tpp fit). Timing and order have no transformation.** A 250 ms poll of ports raced against Playwright's
global setup was logged as `(if -> while)`, though the loop waits for time to pass and does not iterate toward a
result. A window that a getter opens and `queueMicrotask` closes was logged as `(unconditional -> if)` plus
`(variable -> assignment)`. One fix only moved a statement earlier (a deadline computed before the server start)
and was logged as "statement reorder (no construct added; closest (statement -> statements))". Evidence:
`step5-u4-cycles.log`; `step5-u1-cycles.log`, cycle 1; `step5-u11-cycles.log`.

**O36 (lz-tpp fit). Literal-only changes got an invented label.** New advice text in an error message and new
entries in a list of patched prototypes were logged as `(constant -> constant')` five times, a label that is not on
the canonical list. Changing a message is neither more nor less generic. Evidence: `step5-u6-cycles.log`,
`step5-u8-cycles.log`.

**O37 (lz-tpp fit). Removing a condition has no entry.** Three greens dropped a clause from a guard so it covered
more cases, logged as `(specific -> generic)` or "constant -> generic condition". That is the most common way
code gets more generic, and the list names only additions. Evidence: `step5-u12-cycles.log`, cycles 2 and 4;
`step5-mutation2-cycles.log`.

**O38 (lz-tpp fit). O15 held again for option parsing.** Thirteen cycles built the `webServer` option and its
checks, and eight of their greens were `(unconditional -> if)`: one guard per bad input. Across the logs, 56 of 106
greens name `(unconditional -> if)`. The label was right each time and never changed the choice.
Evidence: `step5-u2-cycles.log`, `step5-u4-cycles.log`.

**O39. What worked in `lz-tpp`.** The impasse check worked as written three times. Twice it backtracked: the test
needed several parts at once, so the worker skipped it and passed a simpler test first. Once it routed to a
refactoring with the test skipped, then a small green. Choosing by priority also caught two wrong first attempts.
An unconditional `(nil -> constant)` turned seven other tests red and was undone to `(unconditional -> if)`. An
unconditional extra start failed ten tests and was undone to `(constant -> scalar)`. Evidence:
`bug-arrival-cycles.log`, cycle 1; `step5-u5-cycles.log`, cycles 2 and 5; `step5-u6-cycles.log`, last cycle;
`step5-u2-cycles.log`; `step5-u11-cycles.log`.

**O40. Nothing marks an `lz-tpp` call made after the code.** In one cycle the source edit came before the `lz-tpp`
call, and the worker noted the order itself. The procedure has no check that the transformation was chosen before
the edit, so a log can name a transformation picked after the fact. Evidence: `step5-u12-cycles.log`, line 4.

**O41. Step 4's DECLINE often rested on reasons outside the count.** Workers declined or deferred refactorings
because the next cycle would reshape the code, because another worker was editing the same file, or because a
module may import only from a guarded list. Step 4 counts structure only and has no outcome for "defer to cycle
N", which workers then tracked by hand and closed in a later cycle. Evidence: `step5-u4-cycles.log`;
`step5-u3-cycles.log`; `step5-u5-cycles.log`.

**O42 (lz-tpp fit). The simplest transformation was an unbounded loop over I/O.** A fix that waits for a stopped
server's port to close took `(if -> while)` first, leaving its bound for the next test, as the priority order asks.
The loop made the new test green and hung three existing tests, whose doubles answered "up" forever. `node:test`'s
timeout could not stop the dangling loop, and the run hung past 10 minutes. `lz-tpp`'s advice for a red spec is to
undo and ask again, but the transformation was right and the old doubles were wrong about Playwright. For a loop
over I/O, a hang costs more than a red, so the bound belongs in the first green. Evidence: W7 `notes.md`, "lz-tdd
friction" (session scratchpad, local); commit `ca165ff`.

**O43. `lz-red` has nothing on a red that would hang.** The next test, a server that never stops answering, did not
fail against the unbounded loop. It hung. The worker shaped the double to stop after 200 probes, so the red became
`Missing expected rejection`. Step 5 asks that the red has run and failed, and says nothing on a test that cannot
end. Evidence: the same notes.

**O44 (lz-tpp fit). Splitting text at a marker has no transformation.** A green that cut an instrumented file at the
first probe statement (`slice(0, search(...))`) mapped to no entry cleanly. Logged as `(expression -> function)`,
it then tripped the impasse check, which asked for a simpler test that did not exist. The list's examples are numbers
and collections, and string processing falls between them. Evidence: W9 `notes.md`, cycle 3 (session scratchpad,
local); commit `83f4081`.

**O45 (lz-tpp fit). O34 held again for a boundary adapter.** A green that resolves a module, imports it, constructs
a class, calls it and parses the result is one `(expression -> function)` bundle. Its three parse guards (no export,
no method, no file) came in with it and no red drove them; the worker left them to the mutation run. Passing a value
through existing plumbing (a parameter into a settings literal, then init to session to run plan) was logged as
`(nil -> scalar)` twice: the label fits and decides nothing. Evidence: W9 `notes.md`, cycles 5, 9 and 11.

**O46. `lz-red` does not say whether a filtered red run counts.** The runner's test file takes about 40 s, so the
worker ran each red with `--test-name-pattern` and the full file only at green. The skill asks that every earlier
test passes and does not say when to check that. Evidence: W9 `notes.md`, cycle 11.

O19 and O22 held again: the worker applied Replace Magic Literal for a probe name although step 4's count said
DECLINE (removes 1 duplicate, adds 1 constant), because the gain is drift risk, which the count does not see; and it
declined Introduce Parameter Object for a five-parameter function on churn (about a dozen test calls), which the count
does not see either. Evidence: W9 `notes.md`, cycles 5 and 9.

**O47 (lz-tpp fit). A table lookup needs two transformations at once.** The `lz-telemetry` ignorer's first vendor
test looks a dotted callee name up in a table. Its green needed `(constant -> scalar)` for the name and `(scalar ->
array)` for the table together, and reading `a.b.c` took recursion, which the TypeScript overlay ranks below a loop.
A single-member test first would have produced code thrown away one cycle later. The worker took the recursive form
the sibling styling ignorer already uses. The overlay's tail-call concern does not apply at AST depth (three levels
here). Evidence: W8 `notes.md`, cycles 3 and 9 (session scratchpad, local); commit `31d7180`.

**O48. One behaviour change can turn existing tests red, not one new test.** The package entry's three install tests
share one expected schema, so adding an ignorer's option turned all three red. The test-first rule "exactly one new
test fails" has no case for a changed shared expectation. Evidence: W8 `notes.md`, cycle 13 and console C7.

**O49. `lz-refactor` has no "right refactoring, file busy" outcome.** Two APPLY refactorings had to wait because a
comment reviewer was still working on the same files (one writer per file). The worker logged them as deferred and
applied them after the earlier commit. Evidence: W8 `notes.md`, console C1 and C2.

O2 and O18 held again: the package's house idiom registers one `it` per table entry, so one vendor-table test went
red as 27 cases at once, and the worker logged it as one cycle. O12 held again: a helper had to move into test
support before the next red could use it, and the cycle shape had no slot for that preparatory refactoring. What
worked: in cycle 8 the highest-priority move (two bare names added to the table) passed, and the import check came
only when cycle 9's triangulating test asked for it, as the priority order intends. Evidence: W8 `notes.md`, cycles 3,
8, 9 and 12.

**O50. `lz-red` has no "red against a mutant".** A mutation pass writes tests that kill surviving mutants. Against
the unmutated source each is green on its first run, which step 5 calls a false green unless it is a
characterization test, and these are neither. The worker checked the right reason outside the skill: it applied
each mutant by hand and ran a no-op edit as a control that had to stay Survived. Evidence: mutation pass 4
`step5-mutation4-notes.md` and `step5-mutation4-cycles.log`.

**O51. `lz-red`'s test-selection moves do not name "one more row".** Both packages register data-driven tables
(`[...].forEach((x) => it(...))`) under `node:test`, and the best move for most survivors was one more row in an
existing table. The worked example and the mechanics leaf are Vitest-only. Evidence: mutation pass 4, the lz-console
and lz-telemetry rows.

**O52. `lz-red` does not hand off to `lz-refactor` when the test needs a seam first.** Three guards in
`loadPageHelpers` could not be reached because the function imported the installed instrumenter itself. The seams
leaf points the right way, but reaching a seam needs a behaviour-preserving Extract Function first, and step 1 only
routes away from `lz-red`, not to `lz-refactor` and back. The refactor went in as its own commit before the reds.
Evidence: commits "refactor(runner): build the page helpers from a given instrumenter module" and the two test
commits after it.

`lz-tpp` had nothing to choose in this pass: a test-after pass has no green step, and an equivalent mutant ends in a
Stryker disable comment, not a transformation. This is not an lz-tpp misfit, since the skill was never asked to
pick.

**O53. `lz-refactor` has no route for a refactoring driven by packaging, not by a smell.** Moving the instrumenter
access into its own module, so another package can copy it byte for byte, answers no smell, so steps 2 to 4 gave no
guidance. The step that mattered, keeping `resolveFromCore` async so that a throwing default still rejects instead
of throwing, is not one its checklist prompts for. The mandatory loop audit then cost a read with nothing to audit,
since no loop moved. Evidence: step 6 chunk 0, commit "refactor(stryker-jsx-mutators): move instrumenter access into
instrumenter.ts", `step6-chunk0-notes.md`.

**O54. `lz-tpp` has no transformation for widening or narrowing an existing condition.** Four greens in step 6 chunk
1 passed by editing a guard that already existed: "a key holding undefined counts as absent", "an unknown name inside
experimental" (a clause dropped), "an array as options is rejected" (`|| Array.isArray(options)` added), and the
`selectMutators` guard ported from the JSX package. The 14-item list has no row for it, and the nearest names,
`(unconditional -> if)` and `(scalar -> array)`, misdescribe a condition edit. Evidence: step 6 chunk 1 parts b2, c
and d, `step6-chunk1-cycles.log` cycles 3, 13 and 18.

**O55. `lz-tpp` ranks behaviour only, not where the change lands.** For "a value other than true is rejected", the top
choice `(unconditional -> if)` lands inside a `filter` predicate and puts a throw in a pipeline; a lower-ranked loop
over the entries was the right green. For a range condition ("some built-ins but not all are missing"), a single
`(unconditional -> if)` can only name one side, so the first green also fired when none were present and needed a
second cycle. For a data-driven message, the impasse check pushed through `(case)` before the table that came in the
next refactor. Evidence: part c cycles 6 and 11, part d cycles 22 and 23.

**O56. `lz-refactor` has no case for duplication that is visible but not yet equal in behaviour.** It rightly declined
to merge the outer and inner name checks in part c cycle 12, because merging would have changed behaviour before a
test asked for it; the extraction had to wait a cycle. Its loop audit also pulls toward a filter pipeline for a
backwards `splice` loop over Stryker's live mutator array, where replacing the array would break the install; it
said "mark no" for the right reason (external mutation), but only because that criterion exists. Evidence: part c
cycles 12 and 13, part d cycle 21.

**O57. A move across packages leaves the moved code's tests behind, and no lz-tdd skill notices.** The tests that
cover the install core stayed in the JSX package and reached the new package through the workspace link, which
resolves outside Stryker's sandbox, so the first mutation run showed all 68 mutants of the moved `install.ts` as
NoCoverage. `lz-refactor` says moved code takes its tests with it but gives no check; the tests written afterwards
were characterization tests with no red and no green to coach, and `lz-red` has no step for a test written after the
code to close a mutation gap (S44 covers the red against a mutant, not the placement). It also has no step for a
change whose whole content is a string a test already pins. Evidence: part e, `.audit/step6-chunk1/run1.json`.

**O58. Each skill call re-injects the whole skill text.** One cycle through `lz-red`, `lz-tpp` and `lz-refactor` costs
about 9k tokens of skill text before any code, so on trivial steps the green and refactor calls carried no decision,
and a ruled list of 15 small reds did not fit one worker under a 150k-token cap. Step 6 chunk 1 took 24 cycles across
four workers. Evidence: part b2 and part c reports, `step6-chunk1-cycles.log`.

**O59. `lz-tpp` has no step for a green whose content is data or a message template.** In step 6 chunk P1 the green
for "the negative sample makes a mutant of each of the 17 built-ins" was a source string found by experiment: the
failure output named the built-ins still missing, and two edits closed it. No transformation ranks "find the text
that makes these mutators fire", so the cycle log calls it `(constant -> constant)`. The start-line test pins a whole
sentence, and the smallest pass is the whole template. Evidence: `step6-p1-notes.md`, commits ea2da5c and 3e86a22.

**O60. A rejection test against a stub that resolves gives a red that names no value.** `assert.rejects` on a stub
that returns reports only "Missing expected rejection". `lz-red` step 5 accepts a not-implemented throw as a valid red
but does not say that, for a test of a rejection, a throwing stub reads better than one that resolves. Evidence:
`step6-p1-notes.md`.

**O61. The cost in O58 makes workers drop skill calls.** The P1 worker called all three skills in cycle 1 only and ran
cycles 4 to 12 without a fresh call "to save context", then wrote three start-line tests in one edit. Several tests
passed on their first run because the shared install function already did the work, and were logged as test-after.
Evidence: `step6-p1-cycles.log`, `step6-p1-notes.md`.

**O62. A case table does not fit one test per cycle.** Chunk 2a's 49 rows (one per Playwright method and form, plus
skip positions) each count as a test. At about 7k tokens of skill text per call, a full loop does not fit one worker,
so the worker ran 3 cycles and then one batched red (36 of 49 failing) and one green. It also wrote each test before
calling `lz-red`, so the coaching arrived after the run. Evidence: `step6-p2a-cycles.log`, `step6-p2a-notes.md`.

**O63. `lz-tpp`'s starter step fails when half the oracle is global.** The starter case asked for one mutant and no
other in a spec file. A constant green over-generated, since every spec holds other expression statements (the
`test(...)` wrapper), and it broke an older no-mutant test; the first green had to bring the `await` check at once.
Evidence: `step6-p2a-notes.md` item 2.

**O64. A type-level change has no runtime red.** Deriving the options type from the roster changes only types; the
check is the type-checker, which `lz-red` does not name as a red. It was logged as test-after. The same chunk's fix
for keyboard and mouse calls was another condition edit with no TPP name (O54). Evidence: `step6-p2a-notes.md`
item 5; commit 699a1ee.

**O65. `lz-tpp` cannot split a structural search into smaller greens.** Chunk 2b's fixture check walks up the parent
paths to the nearest test, hook or fixture function and reads its first parameter's destructuring. The list names it
one `(unconditional -> if)` with a large body and gives no way to cut it into reds of its own. The cut that mattered
(do not stop at a `test.step` callback, which gets no fixtures) was missed and found in review. Evidence:
`step6-p2b-notes.md`; commit 9760292.

**O66. Under type stripping a signature change reds only at the type-checker.** Adding the `settings` parameter went
red as an assertion on the removed fixtures, not as a compile error, because `node --test` strips types; the
type-level part showed up only under `typecheck`. This adds to O64. Evidence: `step6-p2b-notes.md`.

**O67. `lz-tpp` has no step for reusing a predicate the codebase already holds.** In chunk 2c the smallest green for
"a top-level test call" by the list was "any top-level call is true", but an existing `isTestCallee` already carried
the stopping conditions. Reusing it made the next rows (nested call, `foo.test()`, `describe()`, `expect()`) pass on
their first run, so they were logged as test-after. A first green that deliberately over-warns (every `Program`) and
is narrowed by later tests also fits `(nil -> constant)` only loosely. The reused predicate's own gap (one member
level, so `test.describe.serial` missed) surfaced in review. Evidence: `step6-p2c-notes.md`; commit 544c4df.

**O68. The first green of a new plugin has no transformation smaller than the whole engine.** Chunk 4's first test
asked for one Locator swap through the real instrumenter. Between "no mutator in the roster" and a working mutator
there was a roster entry, a site reader, a per-file index and the swap itself; `(nil -> constant)` could not stand in,
because a hard-coded mutant would make the self-check sample pass for the wrong reason. This adds to O28, where the
first test was data-driven; here the first test needed a component. Evidence: `step6-c4-notes.md`; commit 7571ca8.

**O69. `lz-tpp`'s list has no step for collection operations such as "deduplicate" or "find the nearest other".**
Chunk 4's second and third cycles made the swap skip equal values and keep one mutant when both neighbours agree.
The worker fitted them to `(unconditional -> if)` and `(scalar -> array)` only by stretching; the actual changes were a
`filter` by first index and a `findLast`/`find` with a predicate. Evidence: `step6-c4-notes.md`.

**O70. The impasse step points at a simpler test that is already green.** In chunk 4's fourth cycle the only green
for three literal kinds (string, expression-free template, regex) was a `switch`, the low-priority `(case)`.
`lz-tpp` step 6 says to pose a simpler test first, but the simpler tests (strings only) had passed in earlier cycles,
and the three kinds are the domain, not an accident of the test order. Evidence: `step6-c4-notes.md`.

**O71. An expected value written by hand can fail on its spelling, not on the behaviour.** In chunk 5's third cycle
the expected replacement used single quotes, while Babel's generator prints the replacement in its own quote style. The
red was right (no mutant yet), but the first green still failed, on the text. `lz-red` says to confirm the red fails
for the right reason; it says nothing about checking that the expected value is written the way the subject prints it.
Evidence: `step6-c5-notes.md`.

**O72. A red raised in a shared setup hook stays "one failing test" only while the file has one test.** In chunk 6
the second cycle's red came from the install's self-check in a `before` hook: a new mutator whose sample made no mutant.
`node:test` reported it against the one case in the new file. With more rows the same hook error fails every row at
once, which reads as many reds for one missing behaviour. Evidence: `step6-c6-notes.md`.

**O73. A sample that holds other mutants lets a constant green pass for the wrong reason.** Chunk 7's first test
asked that every mutant of `page.evaluate(() => ...);` carry the ignorer's reason. The `(nil -> constant)` green
ignored the whole file, so it passed, although the statement also carried Stryker's statement-removal mutant outside
the callback. The first real condition turned the earlier test red, and the fix was in the sample, not the code.
`lz-red` has no prompt to check that the test input exercises only the node under test. Evidence:
`step6-c7-notes.md`.

**O74. A red for a guard needs an input chosen from the parser's node shapes.** For "a computed member is not
matched", `page['evaluate']` and a bare `evaluate(...)` passed before the guard existed, because their nodes lack the
field the code reads; only `page[evaluate]` made the guard's test red. `lz-red` does not say that picking a red input for
a guard means knowing which shapes the guard is the only thing excluding. Evidence: `step6-c7-notes.md`.

**O75. Porting a working prototype onto a shared engine leaves few drivers.** In chunk 8a, once the site reader used
the engine from chunk 4, eight of the prototype's documented limits passed on their first run and were logged as
test-after pins; four cycles drove new behaviour. The last green took the prototype's whole path-suffix rule in one
step, because the prototype, not the transformation list, decided how much of the rule to write. Evidence:
`step6-c8a-notes.md`.

**O76. A green can force an edit to an earlier test's expectation.** In chunk 8b the case runner compares every
mutant of a file. When the second mutator went green, an existing row that expected no URL mutant (`data-method-get`)
now had one, and the green had to change that row as well. `lz-tpp` says to apply only the one transformation; it
does not say what to do when a correct green changes what an older test must expect. Evidence: `step6-c8b-notes.md`,
cycle U1.

**O77. Widening a guard with an alternative has no transformation (lz-tpp misfit).** For "a template that starts
with an expression is a site", the smallest change was a disjunction added to the emptiness check
(`text !== '' || hasExpressions`). None of the 14 transformations names it. The worker logged it as
`(unconditional -> if)`, which describes the first guard, not this change. Evidence: `step6-c8b-notes.md`, cycle U14.

**O78. A second kind of site arrives as one large step (lz-tpp misfit).** The rule that a `for...of` loop over an array
literal makes its elements sites is a new kind of site, not a generalisation of the first. It arrived as one
`(expression -> function)` with four structural checks. One red per check would have needed code that no other test
asks for, so the stop conditions became test-after pins, and one check that no pin could tell apart was deleted. The
transformation list offers no smaller step for adding a second, parallel rule. Evidence: `step6-c8b-notes.md`, cycle
U15.

**O79. One red can need two transformations in two functions.** In the 8b fix round, the row for an optional clock
receiver stayed red after the receiver check was widened: the awaited-call and awaited-method checks also rejected
optional nodes. `lz-tpp` picks one transformation per red and does not say what to do when a rerun shows the same test
failing for a second, unrelated reason. The worker applied a second transformation and logged both. Evidence:
`step6-c8b-fix-notes.md`, cycle 1.

**O80. A test that pins a document has no green transformation (lz-tpp misfit).** Chunk 12's test fails when the
README's tier tables differ from the roster. Its red was the stale README, and the change that made it green was prose
and three Markdown tables. None of the 14 transformations describes that, so the cycle was logged as "green: none on
the list". Evidence: `step6-c12-notes.md`.

**O81. A formatter run after green can change what the test reads.** After the README went green, Prettier padded the
table cells, and the test's pattern, which expected a single space before a cell's closing `|`, no longer matched
(inferred from the padded row; the test was not run between the format and the fix). The cycle has no step that
formats the changed files and runs the tests again before the refactor step. Evidence: `step6-c12-notes.md`.

**O82. The loop audit has no outcome for a walk whose next step depends on the branch taken.** In the R6 refactor wave,
`inPayload` climbs out of an object value by skipping the property path, but climbs out of an array element by one
step. No collection pipeline expresses that, none of `lz-refactor`'s "mark no" criteria fits, and the catalog has no
Replace Loop with Recursion target. The worker chose a recursion with one case per node kind. Evidence:
`step6-r6-wave1-notes.md`.

**O83. A refactoring that differs only on inputs the parser never produces has no name.** Code typed `unknown` over a
Babel tree let the worker merge `functionTypes.includes(type)` into a regex test, and `String(type)` into a `typeof`
check. The two forms differ only on node shapes Babel never builds. `lz-refactor` treats any difference as a behaviour
change and routes it to `lz-tpp`, with no way to record the argument that the difference cannot be reached. This is
the converse of O56. Evidence: `step6-r6-wave1-notes.md`.

**O84. A test that kills a mutant is red only with the mutant applied, and `lz-red` does not say how to show that.**
Step 5 asks for a red that ran and failed in the code under test. A test written for a Stryker survivor passes on the
real code by construction, so its red exists only in the mutated code. Chunk 10's worker applied each mutant by hand
in a scratch copy of the package. That copy needed its own `node_modules` junction, and batching several mutants in
one copy was safe only when each new test reached exactly one of them, which took three batches for one file. A
script that applies one mutant at a time replaced the batches. Evidence: `c10/notes.md`.

**O85. A red can be one that no production change can turn green.** In R6 wave 2, the row for a payload inside `as`
failed with `actual: []`, exactly like its `satisfies` and `!` siblings, and looked like the same missing behaviour.
No change to the mutator could pass it: Stryker 10.1.1's instrumenter never visits a `TSAsExpression` subtree, so the
mutator never sees the payload. Only reading the instrumenter's source told the rows apart, after a green attempt
failed. `lz-red`'s step 5 checks that the failure comes from the code under test, but not that the code under test can
reach the input at all. The row now pins "no mutant", and the README states the limit. Evidence:
`step6-r6-wave2-notes.md`, cycles 14 and 15.

**O86. A test that names two behaviours, only one of them missing, gets half a red.** The R6 round 2 brief asked for
one test that a non-enumerable own option key is "neither validated nor read". Only "read" failed at the base, so the
red covered that half; after the green, the worker widened the same test with the "validated" half, which never
failed. The cycle log needed two lines for one test. The brief caused this: Lars's user-scope test-first rule already
says a list item that names two behaviours is two tests, one cycle each, and the brief did not follow it. What remains
for the plugin is that `lz-red` itself does not say it, nor what to do with a half that already holds. Evidence:
`step6-r6-round2-notes.md`.

**O87. A refactoring can make an equivalent mutant killable, and `lz-refactor` has no motive for it.** In step 6's
final mutation run, the literal `'mount'` keyed MountStory's sites, and replacing it with `''` changed no outcome: each
swap mutator compares keys only among its own sites. No check could be deleted. Extract Variable
(`const key = 'mount'`, used for both the receiver match and the key) made the literal decide the match, and `''`
there now fails 47 tests. `lz-refactor` names the move, but none of its motives (a smell, duplication, readability)
covers "share a literal with code a test reaches". O83 covers versions that differ only on inputs the parser never
builds; here they differ on no input at all. Evidence: `final-stryker/notes.md`.

**O88. A test-after pass that trusts Stryker's "detected" misses survivors hidden as Timeouts.** In the same run,
Stryker counted a Timeout as detected, but under load its default timeout fired on mutants no test kills: one applied
by hand failed no test. A rerun of every line with a Timeout at a 30 s `timeoutMS` had no Timeout and showed three
real survivors. Nothing in the lz-tdd flow treats a Timeout as worth a look. Evidence: `final-stryker/notes.md`, slots
P6 and P7.

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

**S28 (from O29).** Add a verify mode to `lz-refactor`. For each earlier refactoring it reports whether the fix held,
diverged from its ruling, or created a new smell. Let a decline stand with its reason, let step 4 propose amending a
ruling, and add a case for a smell the change moved elsewhere.

**S29 (from O30).** Let step 4 name costs that are not counts, such as dependency direction, drift risk and a
test-only export, and weigh them in words. In step 5, check the project's module boundary rules beside the public
API.

**S30 (from O31).** In `lz-refactor`'s test-code guidance, say that an arrange helper built on the code under test
couples the test to its subject. Prefer arrange code that does not call the subject, even when a shared helper
exists.

**S31 (from O32).** Let step 4 record that a duplicate is weaker than its original, for example a dropped assert, and
treat restoring the lost check as reason enough to apply.

**S32 (from O33, O34).** Give `lz-tpp` a case for a green step whose test pins a mechanism: a platform hook, an
atomic write, an OS call. Say that the choice is between mechanisms, made by running the test against each, and
that the transformation label adds nothing there.

**S33 (from O35).** Add a note on timing and order: a poll loop is not `(if -> while)` iteration, and moving a
statement is a valid green with no transformation. Say how to log both.

**S34 (from O36, O37).** Either add entries for changing a literal's text and for removing a condition, or say
that these are outside the list and how to log them.

**S35 (from O38, O15).** Let `lz-tpp` skip the naming step for a run of guards at a boundary, logged once, so
the name is given where it can change the choice.

**S36 (from O40).** Ask the cycle log to record the transformation before the green edit, and say what to do when
the edit came first.

**S37 (from O41).** Give step 4 a "defer" outcome that names the cycle or change that will settle it, and count
an edit conflict with a parallel worker or a module import rule as a stated reason.

**S38 (from O42).** In `lz-tpp`, say that a loop that waits on I/O or time gets its bound in the same green as the
loop, ahead of the priority order, because an unbounded wait hangs the suite instead of failing a test.

**S39 (from O43).** In `lz-red` step 5, say how to make a red that would hang end as a failure: bound the double or
the test, so the red is an assertion and not a timeout.

**S40 (from O44, O45).** Give `lz-tpp` a short case for text processing and for boundary adapters: say the choice is
the split or parse step itself, and that guards a boundary needs get their own reds or a named mutation check.

**S41 (from O46).** In `lz-red` step 5, allow a filtered run for the red when the file is slow, with the full file
run at green, and say so in the cycle log.

**S42 (from O48).** Let a cycle's red be a changed shared expectation in existing tests, named as such in the log,
when one behaviour change is pinned by a fixture several tests share.

**S43 (from O49).** Give step 4 a "deferred: file busy" outcome that names what it waits for, beside APPLY and
DECLINE.

**S44 (from O50).** Add a mutation-testing route to `lz-red` step 5: the red is against the applied mutant, with a
no-op control that must stay green, and the test is green against the unmutated source by design.

**S45 (from O51).** Name "add a row to an existing table" as a test-selection move, and give the mechanics leaf a
`node:test` with `assert` variant beside Vitest.

**S46 (from O52).** When the next test needs a seam the code lacks, have `lz-red` hand off to `lz-refactor` for the
seam and come back for the red.

**S47 (from O53).** Give `lz-refactor` an entry for a structural need with no smell (a module split for packaging
or reuse) that asks what callers observe, such as sync against async failure, and skip the loop audit when the
change moves no loop.

**S48 (from O54).** Add a "(condition -> refined condition)" entry, or a note in the canonical list, for a green that
widens or narrows an existing guard.

**S49 (from O55).** In the coach procedure, after picking a transformation, ask where it lands (inside a pipeline
callback, on one side of a range) and allow a lower-ranked one with that reason.

**S50 (from O56).** Give `lz-refactor` a "duplication not yet behaviour-equal: wait for the test" case, and name
in-place mutation of a shared array as a "mark no" example in the loop audit.

**S51 (from O57).** Give `lz-refactor`'s Move Function and Move Module mechanics a step "move or add the tests in the
destination package and run them there", and give `lz-red` a test-after route for closing a mutation gap and for a
pinned-string change.

**S52 (from O58).** Offer a short form of each skill for repeat calls in the same cycle loop, or let one call cover
the three steps of a trivial cycle.

**S53 (from O59).** Name a data or template green in the reference list: the test's failure output drives the edits,
and the cycle is recorded as such, not forced onto a transformation.

**S54 (from O60).** In `lz-red` step 5, say that a test of a throw or a rejection gets a stub that throws a
not-implemented error, so the red names what was expected.

**S55 (from O61).** Let one skill call cover a run of cycles a test list fixes up front, with the transformation
named per cycle in the log, so that skipping calls is no longer the cheaper path (see S52).

**S56 (from O62).** Let a case-table family (rows that differ only in data) count as one cycle: one red over the new
rows, one green, with the row count in the log.

**S57 (from O63).** In the starter-case guidance, say that when the test also asserts absence elsewhere in the input,
the first green may need the discriminating condition, and name that as an accepted lower-priority step.

**S58 (from O64).** Give `lz-red` a type-level red: a `tsc` or type-assertion failure (for example an
`@ts-expect-error` that stops being needed) counts as the red for a change that only types can observe.

**S59 (from O65).** For a search over a tree (parents, scopes, bindings), have `lz-red` list the stopping conditions
as separate tests: where the walk stops, where it must go on, and what it must skip.

**S60 (from O66).** In `lz-red`'s Vitest and TypeScript mechanics, say that under type stripping the red of a
signature change is a type-check run, and name the command beside the test command.

**S61 (from O67).** Add a "reuse an existing function" option to the coach procedure, ranked with
`(expression -> function)`, and have `lz-red` ask whether the reused function's own edge cases are pinned where it
is reused.

**S62 (from O68).** Name a "first green of a new component" case in `lz-tpp`: allow the smallest working slice through
every layer the test crosses, and have `lz-red` prefer a first test that crosses as few layers as the design allows.

**S63 (from O69).** Add collection transformations to the TypeScript overlay, for example `(array -> filtered
array)` and `(loop -> find)`, ranked near `(scalar -> array)`.

**S64 (from O70).** In the impasse check, add the outcome "the simpler tests are already green and the cases are the
domain": take `(case)` and say so, instead of backtracking.

**S65 (from O71).** In `lz-red`'s step 5, add: when the expected value is text the subject generates, take its spelling
from one real run of the subject, so the red and the later green both turn on behaviour.

**S66 (from O72).** In `lz-red`'s Vitest and TypeScript mechanics, say how to read a red raised in a shared setup hook:
count it as one red for the behaviour the hook checks, and prefer a red inside the test body when the file has several
tests.

**S67 (from O73).** In `lz-red`'s step 5, add a purity check for inputs that produce many outcomes (mutants, events,
log lines): list everything the input produces once, and keep only what the test is about.

**S68 (from O74).** In `lz-red`'s test selection, name the guard case: the red input is one the guard alone excludes,
and inputs the rest of the code already rejects are pins.

**S69 (from O75).** Add a "port" route to `lz-red` and `lz-tpp`: when a reference implementation exists, write its
documented limits as a pinned table, drive only the behaviour the target does not yet have, and say that the
reference decides the size of each green.

**S70 (from O76).** In `lz-tpp`'s green step, allow one named exception: when the test harness compares a whole output
(every mutant, every event), an earlier test's expectation may change with the green, and the cycle log names that
row and why.

**S71 (from O77).** Add `(condition -> disjunction)` to the TypeScript overlay: widen an existing guard with an
alternative, ranked just below `(unconditional -> if)`.

**S72 (from O78).** In the impasse check, add the case of a second, parallel rule: write its positive red, take
`(expression -> function)` for it, and pin its stop conditions in the same cycle. Do not invent reds that need code
no other test asks for.

**S73 (from O79).** In `lz-tpp`'s procedure, add a rerun step: after the chosen transformation, run the red test again.
When it still fails for a new reason, name that reason, pick the next transformation for it, and log both under the
same cycle.

**S74 (from O80).** Give `lz-tpp` a route for a test whose subject is not code (a document, a generated file, a
config): say that the transformation list does not apply, and that the green is the smallest edit to the artifact
that the test reads.

**S75 (from O81).** End each green with "run the project's formatter on the changed files, then run the tests again",
so that a formatter rewrite is caught before the refactor step starts.

**S76 (from O82).** Add a loop-audit outcome "stateful walk": when each step depends on the branch taken, a recursion
with one case per node kind is the target. Add Replace Loop with Recursion to the catalog, with the TCO caveat the
TypeScript overlay already gives.

**S77 (from O83).** Give `lz-refactor` a "reachable inputs" note: a change that keeps the output for every input the
producer can build (a parser, a schema) counts as behaviour-preserving when the note names the producer and the
shapes it never builds.

**S78 (from O84).** In `lz-red`'s step 5, add the mutant-killing case: the red is the new test failing with the
mutant applied, shown by a rerun of the mutation tool scoped to the line or by applying that one mutant in a copy.
Name the one-mutant-per-run rule.

**S79 (from O85).** Add a question to `lz-red`'s step 5: "could any change to the code under test pass this?" When a
harness or framework between the test and the code decides what the code sees, check that it delivers the input
before handing the red to `lz-tpp`; if it cannot, the test pins a limit, not missing behaviour.

**S80 (from O86).** In `lz-red`'s test-selection leaf, say what to do when a requested test names two behaviours and
the code already has one: write the missing half as the red, and either add the present half as a separate pin or
widen the test after green and log that half as test-after.

**S81 (from O87).** Add "make a mutant observable" as a motive in `lz-refactor`, with Extract Variable as the usual
move: when a constant decides nothing on its own, share it with code that a test reaches, so a mutated value fails a
test.

**S82 (from O88).** In the test-after route for closing a mutation gap (S51), add a step: rerun every line whose
status is Timeout with a generous timeout before counting it detected, because load can turn a survivor into a
Timeout.

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

## stryker-mutator/stryker-js: incremental mode places tests one line low in a file that starts with a block comment

Status: draft, not filed (2026-11-01). A search of the repo's issues for "ts-nocheck line", "startPosition
disableTypeChecks", "incremental test location comment" and "incremental" found no existing report on
2026-11-01. lz-node-test found the same bug with its node:test runner (its scenario W11) and keeps its own
draft; file once, with both runners' reproductions.

**Versions.** `@stryker-mutator/core` and `instrumenter` 10.1.1, `@playwright/test` 1.64.1, Node 24.22.0,
Windows 11 arm64, `disableTypeChecks` at its default (`true`).

**Reproduction (measured 2026-11-01).** On this repository's e2e demo, put a 3-line block comment above
`apps/demo-app-e2e/src/cart.spec.ts` and run
`npx stryker run stryker.e2e.config.ts --mutate apps/demo-app/src/app/cart.ts:28-28 --incremental`. The
incremental file then records each test at line 11, 18, 24, 29 and 38, one more than the `test(` calls at
lines 10, 17, 23, 28 and 37. Without the comment the recorded lines equal the `test(` lines (measured in
`reports/e2e/mutation.json`).

**Cause (read, not debugged).** `prefixWithNoCheck` keeps a leading block comment, then appends `'\n'` and
`// @ts-nocheck\n` and keeps the original newline after the comment, so the file grows by 2 lines
(`packages/instrumenter/src/disable-type-checks.ts`). With no leading comment it grows by 1. The dry-run
executor always subtracts 1 (`packages/core/src/process/3-dry-run-executor.ts`, the `test.startPosition.line--`
"HACK" in `remapSandboxFilesToOriginalFiles`).

**Effect.** Each test's region for change detection starts one line late. An edit on a test's `test(` line
that keeps its title (for example adding a fixture to `async ({ page })`) counts against the test above it.
The edited test keeps its reused results, so a Killed result can be stale. lz-node-test measured a stale
Killed, with Survived when forced, for one-line tests.

**Possible fix.** Have the preprocessor report how many lines it inserted per file and subtract that, or
insert `// @ts-nocheck` without the extra newline so the shift is always 1.

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

**Context.** `@layzee/stryker-jsx-mutators` in this repo adds that force-show mutant as
`LzConditionalElement`, and skips a `&&` whose left operand is a comparison or a `&&` or `||` expression,
because there the built-in `true` already exists. An upstream fix would make that skip need revisiting.

## stryker-mutator/stryker-js: mutator filters never drop mutants inside an ignored subtree

Status: draft, not filed (2026-11-05). Searches of the repo's issues for "ignored mutants CallExpression" and
"empty-expression-mutator filter" found nothing on 2026-11-05; a search for "ignorer" returned issues, as a control.

**Versions.** `@stryker-mutator/instrumenter` 10.1.1, built-in mutators only.

**Reproduction.** Instrument a file twice with the stock `Instrumenter`, once without ignorers and once with an
ignorer that ignores a function body holding statements such as `expect(summary.total).toBeGreaterThan(0)`.
Measured on 12 Storybook story files (api-diff-viewer at 4848282, ignoring `play` functions): with the ignorer,
the report holds 1 to 37 more mutants per file than without it. Every extra mutant is an ignored `CallExpression`
mutant (statement replaced by `;`). The placed mutants are the same in both runs.

**Cause.** `CallExpression` (`empty-expression-mutator.ts`) keeps its mutant only when
`mutantsInScope.length === 1`. `applyMutantFilters` in `babel-transformer.ts:138-148` builds the scope from mutants
without an `ignoreReason` and removes only mutants without one. Inside an ignored subtree the scope is empty and
the mutator's own mutant is ignored, so the filter fails but removes nothing. The report then counts ignored
mutants that would never exist outside the ignored subtree.

**Effect.** Ignored counts in reports run high; scores and placed mutants are not affected.

**Possible fix.** Apply the filter to ignored mutants as well: build `mutantsInScope` from every mutant in the
subtree, and remove the filtered mutants whatever their `ignoreReason`.

## stryker-mutator/stryker-js: no mutants inside an `as` expression (already reported)

Status: no draft needed (2026-10-26). Reported upstream as
[#6208](https://github.com/stryker-mutator/stryker-js/issues/6208) and
[#6227](https://github.com/stryker-mutator/stryker-js/issues/6227), with a fix proposed in
[#6228](https://github.com/stryker-mutator/stryker-js/pull/6228), all open on 2026-10-26.

**What it cost here.** `@stryker-mutator/instrumenter` 10.1.1 lists `TSAsExpression` among its type nodes
(`dist/src/util/syntax-helpers.js:140`), so it makes no mutant anywhere inside `expr as Type`. Measured on
2026-10-26: `export const a = [1 + 1] as const;` gives none, while the same line with `satisfies number[]`
or with no suffix gives ArrayDeclaration and ArithmeticOperator. The UI mutators' table was written as
`[...] as const satisfies ...`, so a mutation run scored 100% with no mutant in any rule body; the
package now builds the table through a helper with a `const` type parameter, and the run then found 15
survivors. Worth a comment on #6208 if Lars wants one: a `const` assertion is the common case, and it
hides the most code.

## stryker-mutator/stryker-js: the HTML report never shows its "Stryker" title postfix

Status: draft, not filed (2026-11-03). A search of stryker-js issues and PRs for "titlePostfix", and of
mutation-testing-elements issues for "title-postfix", found nothing on 2026-11-03.

**Versions.** `@stryker-mutator/core` 10.1.1 with `mutation-testing-elements` 3.9.0; stryker-js `master` at
8f24ef0be (2026-10-29) has the same line.

**Cause.** `packages/core/src/reporters/html-reporter.ts` writes
`<mutation-test-report-app titlePostfix="Stryker">`. The element declares the property as
`@property({ attribute: 'title-postfix' }) titlePostfix`, and HTML parsing lowercases attribute names, so the
page sets `titlepostfix`, which nothing reads.

**Reproduction.** Run Stryker with the `html` reporter and open `reports/mutation/mutation.html`. The tab title
is "All files", not "All files - Stryker". Changing the attribute to `title-postfix="Stryker"` gives
"All files - Stryker" (measured 2026-11-03 headless in Chromium, on a page built the same way by
`@layzee/stryker-playwright-runner`'s `lz-playwright-traces` reporter).

**Possible fix.** `title-postfix="Stryker"` in `html-reporter.ts`, with the reporter's test asserting the
attribute name.

## michael-denyer/pstack-claude: `arena` trusts the runner's model and lets the parent overrule the judge unchecked

Status: draft, not filed (2026-10-31). Observed 2026-10-26 in one arena run. Not searched for existing issues
yet; before filing, search the repo's issues with a single-word positive control ("arena") as well as the
specific words. Lars decides whether it goes to this port or to the original pstack.

**Versions.** pstack (Claude Code port) 0.9.81, `skills/arena/SKILL.md`; Claude Code on Windows 11 arm64; arena
runners `opus, fable, sonnet` from `pstack-models.md`.

**Observation 1: a runner can run on a model other than the one it was spawned for.** A runner spawned for Fable
at high effort ran on Opus for 46 turns, with no notice in its report. Phase C then nearly scored two Opus designs
as a cross-family panel. Phase B and Phase C never check which model ran. The subagent's transcript records it in
every assistant message (`"model":"..."`).

**Suggestion 1.** Add to Phase B: after each runner finishes, count the model names in its transcript, label each
candidate with the model that ran, and treat a mismatch like a dropout ("proceed with N-1 and note the dropout").
Phase C's "prefer a different model family" then rests on the measured model.

**Observation 2: Phase D lets the parent overrule the cross-judge on an unmeasured claim.** Phase D says
"Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding." The
parent overruled the judge with "my role table already settles that case". That table held 17 tags. Playwright
1.64.1's `kImplicitRoleByTagName` gives a fixed role to 51 tags, all 17 among them, out of 62 tags in all.

**Suggestion 2.** Add to Phase D: an override of the cross-judge names the measured fact it rests on, and a claim
that something is complete is checked against the primary source first. Record that fact in the synthesis note
beside the judge's verdict.

**Local workaround.** Lars's own skills carry both rules: `lars-principle-own-delegated-work` (model check from
the transcript) and the `pstack:arena` trigger line in `lars-mode` (override rule).

## microsoft/playwright: a supported API for running Playwright Test from another tool

Status: draft, not filed (2026-11-01). Searched the repo's issues on 2026-11-01 (REST search; the control query
"webServer" returned 399 hits): "Stryker" 0, "TestRunner programmatic API" 0, "run tests programmatically" 2.
Related, closed: [#27664](https://github.com/microsoft/playwright/issues/27664) (a test filter API, closed
2025-09-08 for limited engagement) and [#8027](https://github.com/microsoft/playwright/issues/8027) (a question,
folded into #7275 in 2021); [#7275](https://github.com/microsoft/playwright/issues/7275) "[Feature] expose
@playwright/test runner API" (2021-06-23) is closed. None asks for the context listener in point 2.

**Why now.** Nico Jansen, on how StrykerJS got coverage analysis into Jest: Stryker asked the Jest maintainers
for the hooks it needed instead of working around Jest (The Deep Dive episode 6, 24:31-24:51,
`D:/projects/sandbox/deep-dive-ep6-mutation-testing-stryker-nico-jansen.transcript.txt`).

**Versions.** `@playwright/test` and `playwright-core` 1.63 and 1.64.1, Node 22 and 24.

**What a mutation testing runner needs, and what it uses today.** `@layzee/stryker-playwright-runner` runs
Playwright Test in-process, once per mutant, and reads only internals for it
(`packages/stryker-playwright-runner/src/playwright-internals.ts`, checked at load by `probeInternals`, so a
Playwright release that moves them fails with a named error):

1. A test runner object: `initialize`, `loadConfig` (projects and webServers), `listTests`, `runGlobalSetup`,
   `runGlobalTeardown`, `runTests` with test ids, projects, workers, `maxFailures` and timeout, and `stopTests`.
   It looks like the runner behind UI mode and the VS Code extension (inferred from its methods, not traced).
2. A listener for each browser context a test creates (`runAfterCreateBrowserContext`,
   `runBeforeCloseBrowserContext` on the client instrumentation), to add an init script and read coverage from
   every frame.
3. The webServer availability check (`isURLAvailable`), so the runner can tell a server already running on the
   port from one it must wait for.
4. The worker entry path (`lib/worker/workerProcessEntry.js`), to recognise Playwright's worker processes.
5. `PLAYWRIGHT_NO_COPY_PROMPT`, to stop the failed-test aria snapshot, which waits out 5 s on a page stuck in a
   loop.

**Ask.** A documented, semver-covered API for points 1 and 2; points 3 to 5 follow from it or can stay private.

**Before filing.** Read #7275's closing comments, cut the list to what Playwright maintainers would accept as one
feature request, and decide whether it is a new issue or a comment on a closed one.

## storybookjs/storybook (eslint-plugin-storybook): flag stubs chained on `fn()` at story definition

Status: draft, not filed (2026-11-05). `gh search issues --repo storybookjs/storybook` for
"restoreMocks fn mockReturnValue args", "restoreAllMocks other stories" and "mockReturnValue args reset" found nothing on
2026-11-05; "loader" returned issues, as a control. Related and open:
[#31897](https://github.com/storybookjs/storybook/issues/31897) ("Function passed on mockImplementationOnce is never
called"), which this rule would catch.

**Versions.** Storybook 10.6.2 with Vitest 3.2.7, and Storybook 10.6.5 with Vitest 5.1.0 (`@storybook/addon-vitest`,
`@vitest/browser-playwright`). The plugin at v10.6.5 has 16 rules (`code/lib/eslint-plugin/src/rules`); none looks at
`fn()` stubs.

**Reproduction.** A story file with:

```tsx
function Probe({ getValue }: { getValue: () => unknown }) {
  return <output data-testid="value">{String(getValue())}</output>;
}

export const ChainedAtDefinition: Story = {
  args: { getValue: fn().mockReturnValue('stubbed') },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('value')).toHaveTextContent('stubbed');
  },
};
```

The play fails in the Storybook UI and under the Vitest addon: the component renders `undefined`. The same story passes
with `fn(() => 'stubbed')`, or with `fn()` in `args` and `args.getValue.mockReturnValue('stubbed')` in `beforeEach`.

**Cause.** The default loader `resetAllMocksLoader` (`code/core/src/test/preview.ts:15-25`) calls `restoreAllMocks()`
before every story renders, and `restoreAllMocks` restores every spy `fn()` has created (`code/core/src/test/spy.ts:98-99`).
A stub chained when the module loads is gone before any story uses it.

**Request.** A rule, for example `storybook/no-definition-time-mock-stub`, that reports a call
`fn(...).mockReturnValue|mockResolvedValue|mockRejectedValue|mockImplementation(...)` (and the `Once` forms) that runs at
module load: in `args` or `argTypes` of meta or a story, or in a module-level declaration. Calls inside functions (play,
`beforeEach`, loaders, factories called at render) are fine. Suggested message: "This stub is reset before the story
renders. Pass the implementation to fn() or set the stub in beforeEach." A fixer can rewrite
`fn().mockReturnValue(x)` to `fn(() => x)` and `fn().mockResolvedValue(x)` to `fn(async () => x)`.

**Evidence of use.** In an open-source corpus of Storybook projects, 29 such calls in 11 story files of 4 projects
(coder, langfuse, explorer, twenty), counted with an AST predicate. One coder story
(`site/src/pages/AgentsPage/components/AgentCreateForm.stories.tsx`, `PreservesAttachmentsOnFailedSend`) sets
`onCreateChat: fn().mockRejectedValue(new Error("server error"))`, so its "failed send" never fails (inferred; the
component was not run).

## storybookjs/storybook (docs): the mock reset runs before render and reaches every story's spies

Status: draft, not filed (2026-11-05). Same searches as the entry above, nothing found.

**Versions.** Storybook 10.6.2 and 10.6.5, docs at `v10.6.5`.

**What the docs say.** `docs/api/parameters.mdx`, "clearMocks", "mockReset" and "restoreMocks": each "will call ... on
all spies created with `fn()` from `storybook/test` when a story unmounts".

**What happens (measured).**
1. The reset runs as a loader before the story renders (`code/core/src/test/preview.ts:15-25,188`), not when a story
   unmounts. A stub chained on `fn()` in `args` is erased before the first render.
2. It reaches every spy `fn()` has created in the module, so one story's reset erases the stubs of other stories in
   the same file. A story with `parameters: { test: { restoreMocks: false } }` and a definition-time stub:
   - passes when run alone under the Vitest addon, and fails when a story with the default reset runs before it in the
     same file;
   - renders the stub on a fresh load of its story page, and `undefined` after the reader opens a default-reset story
     and comes back without a reload;
   - renders `undefined` on the Docs page.
   With `restoreMocks: false` in the file's `meta`, both such stories pass.

**Suggested change.** Say that the reset runs before each story renders, that it reaches all spies created with `fn()`
(including other stories' spies when they share a module), and that stubs belong in `fn(impl)` or `beforeEach`; and
that `restoreMocks: false` is reliable at the file (`meta`) or project level, not for a single story.

**Evidence.** Probe stories and scripts kept outside this repository; results recorded in this project's audit notes
(Storybook 10.6.2 with Vitest 3.2.7; Storybook 10.6.5 with Vitest 5.1.0).

## vitest-dev/vitest: browser mode refuses a setup file when `node_modules` is a symlink outside the root

Status: draft, not filed (2026-11-05).

**Versions.** vitest 5.1.0, @vitest/browser-playwright 5.1.0, vite 8.3.6, Node 24.22.0, Windows 11 arm64. Seen with
@storybook/addon-vitest 10.6.5 (setup file `@storybook/addon-vitest/internal/setup-file`) inside a StrykerJS 10.1.1
sandbox, which copies the project into `.stryker-tmp/sandbox-<id>/` and links `node_modules` back to the project's.

**Reproduction.** A Storybook project with addon-vitest in browser mode, and a Stryker config with `inPlace: false`
(the default). The dry run fails at once:

```
Failed to import test file <project>/node_modules/@storybook/addon-vitest/dist/vitest-plugin/setup-file.js
```

Running Vitest directly in the sandbox copy, with the sandbox as the working directory, gives the same error, and
Vite logs `The request id "<project>\node_modules\...\setup-file.js" is outside of Vite serving allow list.` With
`inPlace: true` the same project passes. A smaller reproduction without Storybook or Stryker (a folder whose
`node_modules` is a symlink to a folder outside it, and a `setupFiles` entry from a package) follows from the cause
below but was not run.

**Cause.** Vitest resolves the setup file's bare specifier to its real path, outside the symlink, and the browser
imports it as `/@fs/<real path>`. `server.fs.allow` holds the config folder, the workspace root and Vitest's own
folders; none of them holds the symlink's target, so Vite refuses the request. Files that served modules import
afterwards pass, through Vite's safe module paths, so only files the browser client imports directly are hit. At
v5.1.0, `packages/browser/src/node/project.ts:104-108` already adds the provider's `initScripts` to
`server.fs.allow`, but not the resolved setup files.

**Possible fix.** Add each resolved setup file (or its folder) to `server.fs.allow` when it is outside it, as for
`initScripts`.

**Workaround.** In the Vitest config:
`server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), realpathSync('node_modules')] } }`
(`searchForWorkspaceRoot` from `vite`, `realpathSync` from `node:fs`). Measured: the Stryker dry run in sandbox mode
then passes (4 tests).

**Evidence.** Logs and configs kept outside this repository, in the probe project of this project's Storybook spike.

## stryker-mutator/stryker-js: a test runner that fails `init()` after the dry run started crashes or hangs Stryker

Status: draft, not filed (2026-11-06).

**Versions.** StrykerJS 10.1.1, Node 24.22.0, Windows 11 arm64.

**What happens.** Stryker starts more than one test runner process when a checker is configured (each checker's
token becomes a test runner when checking ends, `freeCheckers()` in `concurrency-token-provider.ts`) or when
`concurrency` is 2 or more (the extra runners initialize while the dry run is still running). When one of those
later runners rejects `init()`, `concurrent/pool.ts:147,193` errors the resource stream and rejects the queued work,
the first runner's run in flight is killed, and its `RetryRejectedDecorator` recovers it with a new process anyway.
Measured with a Playwright test runner plugin whose later processes failed `init()`:

- With a checker at `concurrency: 1`, Stryker logged "Unexpected error occurred while running Stryker", started a
  replacement worker, then exited on `triggerUncaughtException` with the init error.
- At `concurrency: 2` without a checker, it started a replacement, retried the dry run on it, and never exited
  (stopped by hand after 6 minutes).

**Expected.** One error naming the failed init, every process disposed, and a non-zero exit.

**Reproduction.** Not yet reduced: a test runner plugin whose `init()` throws when `STRYKER_MUTATOR_WORKER` is not
`0`, run with `--concurrency 2` or with any checker, should show both outcomes (inferred from the cause above).

**Workaround.** Make the first process's `init()` fail instead, before any later runner starts.

**Evidence.** The `concurrency: 2` debug log is kept in this repository's spike folder, `spikes/server-d/out/`
(untracked). The checker run's log was removed in a cleanup; its outcome is recorded in the spike's report.
