# Negative control: a broken install stops `stryker run` on both routes

The design (`docs/design/playwright-mutators.md`, "What the verification plan adds", step 2) asks for a run
that breaks one operator's sample on purpose and shows that `stryker run` stops with that operator's name,
once per route. `break.ts` gives `LzTextLiteral` a sample it cannot mutate when `SPIKE_BROKEN=1`. A config's own
imports run before core loads `plugins`, so the real `@layzee/lz-stryker-ui-mutators` specifier installs the
broken table on both routes. With `SPIKE_BROKEN=0` the same runs are the control, and their JSON reports show
whether the UI operators reach a real run (the gate under "Risks that remain").

The package name resolves to the built `dist`, so `break.ts` breaks `dist`'s operator table, and it throws
when the name loads anything else (a `--conditions=@layzee/source` run, for one), because a break of another
copy would leave the broken runs green.

Run from this folder, after `npm install` has linked the workspace package and
`npx nx run @layzee/lz-stryker-ui-mutators:build` has built it:

```sh
SPIKE_BROKEN=0 node ../../node_modules/@stryker-mutator/core/bin/stryker.js run stryker.plugins.config.mjs
SPIKE_BROKEN=1 node ../../node_modules/@stryker-mutator/core/bin/stryker.js run stryker.plugins.config.mjs
SPIKE_BROKEN=0 node ../../node_modules/@stryker-mutator/core/bin/stryker.js run stryker.import.config.mjs
SPIKE_BROKEN=1 node ../../node_modules/@stryker-mutator/core/bin/stryker.js run stryker.import.config.mjs
```

Result on StrykerJS 10.1.1, 2026-10-26, on the built package (measured):

| Route | Intact | Broken `LzTextLiteral` sample |
|---|---|---|
| `plugins` + `ignorers` | exit 0 | exit 1: `lz-stryker-ui-mutators: the instrumenter 10.1.1 in ... made no mutants of LzTextLiteral from their samples ...`, then `ERROR Stryker ... Cannot find Ignore plugin "lz-stryker-ui-mutators"` |
| config import | exit 0 | exit 1: `Invalid config file "stryker.import.config.mjs". Error during import. Inner error: Error: lz-stryker-ui-mutators: ... made no mutants of LzTextLiteral ...` |

Both intact runs report the same mutants of `src.tsx` in `out/<route>/mutation.json`: 12 from seven UI
operators (`LzTextLiteral` 4, `LzElementRole` 3, `LzHiddenAttribute`, `LzConditionalElement`,
`LzLabelAttribute`, `LzEventHandler` and `LzUrlAttribute` 1 each) next to 5 built-in ones.
