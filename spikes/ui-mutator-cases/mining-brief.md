# Brief: mine UI shapes for synthetic operator test cases

Lars, 2026-10-25: "Create synthetic tests for our Playwright mutators/operators." Then: "I mean synthetic test
cases. Consider basing them on the OSS repos we have used to exercise them."

The operators are designed, not built: `D:/projects/sandbox/stryker-playwright-runner/docs/design/jsx-mutators.md`
(read "Operators in the first release", "Names" and "Equivalent mutants" in full; the names in its Names table
are the approved ones). Each operator has generate rules and skip rules. Your job is to find the real UI shapes
in one open-source repo that each operator would meet, and turn each into a synthetic JSX test case.

## Deliverable

Write `D:/projects/sandbox/stryker-playwright-runner/spikes/ui-mutator-cases/mined-<repo>.md` (the launch message
names `<repo>`), early, and extend it. One table row per case:

| Column | Content |
|---|---|
| id | `<repo>-<n>` |
| origin | `<path>:<line>` at the pinned commit, and the verbatim original line(s) in backticks |
| jsx | the smallest TSX snippet that keeps the shape (one element or a few lines), as the case's input |
| operator | the approved operator name, or `none` for a must-not-generate case |
| expect | every UI mutant the design says the snippet gives: the operator name and the replacement source text, or `none` |
| rule | the design rule or skip rule the case exercises, quoted short |

Aim for 8 to 15 cases: at least one must-generate case for each operator the repo's UI can show, and every
must-not-generate (skip) shape the repo actually contains. Prefer shapes a Playwright suite in that repo actually
observes (a locator or assertion in its tests that would kill the mutant); name that test as `path:line` in a
last column `killed by` when you find one, else `-`.

## Rules

- Read the repo with `git --git-dir=<clone>/.git show <sha>:<path>` and `git --git-dir=<clone>/.git ls-tree -r
  --name-only <sha>` at the pinned commit; never check out, edit, or run anything in the clone. Read-only:
  write only your one file. No browser, Stryker or Playwright runs.
- An Angular template shape becomes its JSX equivalent: `[attr.aria-label]="x"` becomes `aria-label={x}`, a
  static `aria-label="Close"` stays a string, `(click)="save()"` becomes `onClick={save}`, `*ngIf`/`@if` becomes
  `x && <A/>` or a ternary, `[disabled]="busy"` becomes `disabled={busy}`, `routerLink="/x"` becomes `href="/x"`
  on an `a` (say so in rule). Keep the original in origin, so the later Angular template support can reuse it.
- A shape with no faithful JSX equivalent is listed under a short "No JSX equivalent" heading with its origin,
  not forced into a case.
- Mark each expect [checked] when you applied the design's written rule to the snippet, [inferred] when the
  design is silent and you judged it; say what is unclear in one line.
- Return a three-line summary: case count, operators covered, anything the design leaves unclear.
