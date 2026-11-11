# Storybook

Stryker plugins for Storybook story files, and the Vite plugin that rewrites definition-time stubs so they survive
the mock reset. This context covers both `@layzee/stryker-storybook` and `@layzee/storybook-mock-transformer`: the
transformer exists only to rewrite the stubs this package diagnoses, and both read the same spy stub shape.

## Language

### Story files and what Storybook reads from them

**Story file**:
A file one Storybook's main configuration names as holding stories. When that configuration cannot be loaded, a
file whose name matches Storybook's CSF indexer pattern (ending in `stories` or `story`).
_Avoid_: stories file, CSF file (when the narrower set is meant)

**Storybook project**:
What the plugins learn from one Storybook config folder: its story files, its preview's reset settings, the tag
filter, and whether its Vite configuration adds the mock transformer.
_Avoid_: Storybook config, project config

**Static CSF value**:
A value in a story file that Storybook reads from the source without running the file, such as `title`, `id`,
`tags`, `name` or an export name. A mutant there cannot change what Storybook reads.
_Avoid_: static annotation, index value

**Story test code**:
The code in a story file that tests a story rather than renders it: `play` functions, `beforeEach` and
`afterEach`, and `.test()` bodies.
_Avoid_: play code (too narrow), interaction test

**Tested story**:
A story whose test Storybook's Vitest addon runs, because its tags pass the tag filter and none of them skips it.
_Avoid_: test story, story test

**Tag filter**:
The `include`, `exclude` and `skip` tag lists of Storybook's Vitest addon, which pick the tested stories. Without
one, stories tagged `test` are tested.
_Avoid_: test tags

### Spies, stubs and the mock reset

**Spy stub**:
A call that sets what a spy made with `fn()` from `storybook/test` returns or does: `mockReturnValue`,
`mockResolvedValue`, `mockRejectedValue`, `mockImplementation`, or their `Once` forms, chained on the spy.
_Avoid_: mock setup, stub (alone), mock implementation

**Definition-time stub**:
A spy stub that runs when the story file loads, because it sits outside any function, such as in `args`, in the
meta or at module scope. The mock reset can erase it before the story renders.
_Avoid_: module-level stub, static stub, args stub

**Mock reset**:
What Storybook does to every spy before a story renders: reset, clear or restore it, as the story's
`parameters.test` chooses. Storybook restores by default.
_Avoid_: reset loader, mock cleanup

**Reset setting**:
One of the `parameters.test` keys `mockReset`, `clearMocks` and `restoreMocks`, as a preview, a meta or a story
sets it; Storybook merges them, and the merged settings pick the story's reset branch.
_Avoid_: test parameter, mock option

**Reset branch**:
Which mock reset a story gets from its merged reset settings: reset, clear, restore, none, or unknown when the
settings cannot be read without running the file.

### Verdicts and findings

**Stub verdict**:
Whether a definition-time stub survives the mock reset: kept, erased, order-dependent (erased only when another
story in the file renders first), or unknown.
_Avoid_: stub status, stub result

**Erased stub**:
A definition-time stub that the mock reset undoes before the story renders, so the story runs with a spy that
returns `undefined` or the original implementation.
_Avoid_: lost stub, reset stub

**Unchecked stub**:
A spy stub at whose line an `LzStorybookSpyStub` mutant survived; the `lz-storybook` report lists it as a stub
finding, because no test fails without the stub.
_Avoid_: unobserved stub, surviving stub

**Stub finding**:
One entry in the `lz-storybook` report: a spy stub's file and line, its verdict, the reason, and the fix.
_Avoid_: stub warning, diagnostic

**Static story mutant**:
A mutant in a story file that Stryker runs against every test, listed in the `lz-storybook` report with its net
time.
_Avoid_: slow mutant

### Plugins

**Mock transformer**:
The Vite plugin `lz-storybook-mock-transformer` that rewrites each definition-time stub into `fn(implementation)`
form, which survives the mock reset. It leaves the `Once` forms as they are.
_Avoid_: stub rewriter, mock plugin

**Rewritten stub**:
A definition-time stub that the mock transformer has turned into `fn(implementation)` form; its verdict no longer
matters, because the mock reset keeps it.
_Avoid_: repaired stub, fixed stub

**Transformer record**:
The list of story files and stub counts that the mock transformer appends to during a Stryker run, which tells the
reporter whether the transformer really ran.
_Avoid_: record file, rewrite log

**CSF ignorer**:
The `lz-storybook-csf` ignorer, which reports as Ignored the mutants of static CSF values and, in the default play
mode, also those of the meta object, story test code and MSW handlers.
_Avoid_: story ignorer, Storybook ignorer

**Stub ignorer**:
The `lz-storybook` ignorer, which reports as Ignored the mutants of a spy stub that the mock reset erases, may
erase, or cannot be told to keep.
_Avoid_: reset ignorer

**Play mode**:
The `lzStorybookCsf.play` option: `ignore` for a Stryker configuration that mutates app code and leaves story
test code alone, `mutate` for one that mutates story test code.
_Avoid_: test mode, play option
