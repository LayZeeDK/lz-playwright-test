# Researching, proposing and deciding on mutators

How this repository finds new StrykerJS mutators for production code and for test code, and how it decides which
built-in mutators a test-code configuration keeps. It is written from the Playwright and Storybook work of
2026-11-03 to 2026-11-05 and is meant to be reused for other runners and APIs.

Who decides: Lars. Claude and its agents research, propose, prototype and measure. Every mutator name, entry point
(main or opt-in) and default is public API, so it is Lars's call. Record each ruling verbatim, dated, in the
decision log; record Claude's own calls labelled as Claude's.

## 1. Split the code into configurations first

Mutators are chosen per configuration, so settle which code each configuration mutates before proposing anything.

- **Production (app) code configuration.** The code under test. Built-in mutators apply; custom mutators add
  domain knowledge the built-ins lack (for example JSX attributes, Storybook story `args`).
- **Test code configuration.** Test files, fixtures, mocks and test doubles. A mutant here asks "would the suite
  notice if this test checked less?". Built-ins are reviewed one by one (section 6); custom mutators target the
  test API (actions, assertions, waits, request mocks).
- Some files hold both. Storybook story files are app code (meta, `args`, `render`), and their `play` functions are
  test code: the app-code configuration ignores `play`, the test-code configuration mutates only `play`. Use an
  ignorer plugin for the split, and remember that an ignorer hides a subtree from every mutator, custom ones
  included, so each configuration needs its own setting.
- Write the split down as a ruling before research starts. Proposals that do not say which configuration they
  serve cannot be judged.

## 2. Research

Run these in parallel, one agent per lens, each writing its own file early (see section 7 on briefs).

- **API lens.** Read the API's primary sources: the docs and the source in a local clone at the installed
  version's tag, never `node_modules`. List every call, option and return value whose misuse changes behaviour.
- **Common-mistakes lens.** Mistakes are where weak code and weak tests live. Sources, in order: lint plugins (each
  rule is a recorded mistake; note which mistakes have no rule), the official best-practice and pitfall pages,
  issue trackers, then experience reports. For each mistake say whether a lint rule fits (the pattern is visible in
  the syntax alone), a mutator fits (only running the tests tells weak from strong), or both, and name any rule
  that already exists.
- **Evidence lens.** Count real sites in a corpus of open-source repositories.
  - Clone into a fixed folder and write a manifest of repository, commit and origin, so counts can be compared
    across reports. A corpus that grows while agents count gives counts nobody can compare.
  - Count with word boundaries and run a positive control first: `play:` also matches `display:`, and a zero from
    a search that could not match is not a zero.
  - Regex counts on adjacent lines are upper bounds. Say so next to the number.
  - For mutant counts, run the real instrumenter on the file (`Instrumenter` from the installed
    `@stryker-mutator/instrumenter`) instead of estimating from the syntax tree: built-ins carry filters (for
    example `CallExpression` keeps its mutant only when the statement has no other mutant) that a tree walk misses.
    Count placed mutants: in StrykerJS 10.1.1 those filters never drop mutants inside an ignored subtree, so
    ignored counts run high.
- **Prior art.** Search for existing mutators or plugins with the same idea (StrykerJS, PIT, mutmut, Mull, other
  runners' plugins). Reuse names and semantics where they exist.

## 3. Propose

One entry per mutator, in this shape:

- Name: `Lz<Area><Name>`, letters only (for example `LzPlaywrightFulfill`, `LzStorybookInteraction`).
- Configuration it serves, and the exact syntax it matches.
- Before and after code.
- What a kill means and what a survivor means. A survivor must point at a specific weak test or a specific missing
  check; if it cannot, the mutator is noise.
- Noise: when it survives by construction (an equivalent mutant, a value nobody reads, a single-element locator
  for a first/last swap), and the predicate that skips those sites. If no static predicate can skip them, say so;
  that is usually a reason to drop or make it opt-in.
- Cost: a kill that only happens after a timeout (a wait removed, an assertion moved before its action) costs the
  full timeout per mutant. Such mutators go opt-in.
- Overlap with built-ins and with existing custom mutators. Prefer extending an existing mutator over a new name.
- Entry: main entry, opt-in, or experimental.
- Sites counted (measured) and the outcome expected (inferred until a run backs it).

Rank the proposals, give each a recommended triage outcome (section 5) and say which to prototype first. List
rejected ideas with reasons; they stop the same idea coming back.

## 4. Prototype and measure

A proposal is a guess about how tests behave. Measure before deciding.

- Write the mutator as a spike plugin (`appendPlugins` with a `.mjs` file that exports `strykerPlugins`) in a
  disposable copy of a corpus repository, not in the package.
- Static check first (seconds, no browser): instrument the target files and count placed mutants per mutator; for
  frameworks that parse the source themselves (Storybook's CSF indexer), also check the instrumented file still
  parses and indexes.
- Then one mutation run per mutator on a small set of files. Heavy runs go through the shared machine lock: book
  the estimate times 1.5, one part per slot, sample memory after acquiring, check for leftover processes after.
- Confirm the test baseline passes without Stryker before reading anything into a failed dry run.
- Triage every survivor by hand: **Useful** (points at a missing or weak check), **Noise** (survives by
  construction), **Coverage** (killed whenever the line runs; costs run time only). The useful share decides.
- Known setup traps: under pnpm, StrykerJS does not find `@stryker-mutator/*` plugins from the project (load the
  runner through a local re-export file in `plugins`); some browser-mode runners fail inside Stryker's sandbox and
  need `inPlace: true`.

## 5. Decide

Bring Lars one question per decision, with options, trade-offs and one recommendation. Decide in two passes: first
sort every proposal from section 3 into one of the triage outcomes below, then, once a prototype is measured, decide
how it ships. A proposal can move between outcomes as evidence arrives; record each move.

### Triage outcomes (before anything is built)

| Outcome | When it fits | What happens next |
| --- | --- | --- |
| **Prototype** | A new name with no overlap, a clear survivor meaning, enough corpus sites (counted, with repos), and a static predicate for its noise. | A spike plugin and one measured run per mutator (section 4). The result goes to the next ruling batch. Nothing is built in the package yet. |
| **Fold in** | The idea is a new case of an existing or approved mutator: a further call it should match, a coarse mode of a planned mutator, an extra site class. | No new public name. Add the case to the target mutator's proposal and build it with that mutator. |
| **Defer** | Another mutator's measurement settles this one (the same idea on another API, a shared noise risk), or it waits on a ruling or a build. | Write down what it waits on and what result would revive it. Revisit when that measurement lands. |
| **Drop** | No static predicate can skip its noise, a survivor would not point at a specific weak check, or a lint rule catches the mistake from the syntax alone. | Record the reason in the rejected list so the idea does not come back. A lint-shaped mistake gets an upstream lint-rule draft in the filing ledger; nothing is filed without Lars's yes. |

Prototypes run while other work waits on rulings, so they delay no build. Book each in its own lock slot.

### How a measured mutator ships

| Outcome | When it fits |
| --- | --- |
| **Main entry** | Measured on at least two corpus repositories; survivors are mostly Useful; kills are cheap (no timeout-only kills). |
| **Opt-in entry** | Useful, but costly (timeout kills, slow runs) or noisy in some codebases, so users turn it on deliberately. |
| **Experimental** | Approved to ship but resting on thin evidence: measured on one repository or few sites, a flaky kill risk, or a survivor meaning not yet confirmed by triage. It ships marked experimental in the package and README, with the evidence it waits for written down (which repositories, how many sites, what useful share). A later measurement promotes it to main or opt-in, or demotes it to fold in or drop. |
| **Back to triage** | The measurement contradicts the proposal (mostly Noise, or kills only by crashing the test). Re-sort it with the table above. |

Example from 2026-11-05: Lars approved seven Storybook play mutators, marking three as experimental "pending more
evidence"; the common-mistakes proposals were sorted into four prototypes, three fold-ins, one deferral and one drop.

Record the ruling verbatim, update the plan, and restate every public name and default at each report until it
ships.

## 6. Built-in mutators in a test-code configuration

Do not exclude all built-ins from test code, and do not keep them all. Decide per built-in mutator.

1. **Classify the sites.** Run the instrumenter over the test files and sort each mutant by site class: action
   call, assertion, wait, mock or double, setup data, helper logic, hook. Note the test kind (browser e2e, component,
   API, server mock).
2. **Join measured outcomes.** Where a run exists, join killed, survived and NoCoverage per mutator and site class.
3. **Judge each cell** as Noise, Coverage or Useful (section 4). Typical results from the Playwright analysis:
   mutants that empty a test body or delete an assertion survive by construction (Noise); literals in mocks and
   doubles behave like production code and keep every built-in (they are the server side of the test).
4. **Verdict per built-in mutator:** keep, exclude, or replace with a named custom mutator that does the useful part
   without the noise. Note where the verdict differs between test kinds and why.
5. **Apply it** with `mutator.excludedMutations` in the test-code configuration, and document each exclusion's
   reason next to the configuration.

The Playwright analysis (`.audit/builtin-mutators/analysis.md`) is the worked example.

## 7. Running it with agents

- One deliverable file per agent, at a named path, created in its first minutes and extended as it goes.
- The brief carries Lars's words verbatim, the rulings the agent cannot see, the corpus location and manifest, the
  no-`node_modules` rule, "label every claim measured or inferred", and a finish line with a time cap.
- Agents research and write; they do not run heavy work. Runs they need come back as a list for the lock holder.
- Before accepting a report, re-check two of its citations yourself and re-run any count you will act on.
- Mid-run scope changes from Lars go to the running agent verbatim and into its brief file.
