# Negative control: a broken install stops `stryker run` on both routes

The design (`docs/design/playwright-mutators.md`, "What the verification plan adds", step 2) asks for a run
that breaks one operator's sample on purpose and shows that `stryker run` stops with that operator's name,
once per route. `break.ts` gives `LzTextLiteral` a sample it cannot mutate when `SPIKE_BROKEN=1`. A config's own
imports run before core loads `plugins`, so the real `@layzee/stryker-playwright-mutators` specifier installs the
broken table on both routes. With `SPIKE_BROKEN=0` the same runs are the control, and their JSON reports show
whether the UI operators reach a real run (the gate under "Risks that remain").

`break.ts` imports `operators.js` from beside the entry that the package name resolves to, the built
`dist`, so it breaks the same copy of the table that the plugin installs. A break of another copy would leave
the broken runs green. Under `--conditions=@layzee/source` the name resolves to `src/index.ts`, which has no
`operators.js` beside it, so every run stops with `ERR_MODULE_NOT_FOUND`.

Run from this folder, after `npm install` has linked the workspace package and
`npx nx run @layzee/stryker-playwright-mutators:build` has built it:

```sh
SPIKE_BROKEN=0 node ../../node_modules/@stryker-mutator/core/bin/stryker.js run stryker.plugins.config.mjs
SPIKE_BROKEN=1 node ../../node_modules/@stryker-mutator/core/bin/stryker.js run stryker.plugins.config.mjs
SPIKE_BROKEN=0 node ../../node_modules/@stryker-mutator/core/bin/stryker.js run stryker.import.config.mjs
SPIKE_BROKEN=1 node ../../node_modules/@stryker-mutator/core/bin/stryker.js run stryker.import.config.mjs
```

Result on StrykerJS 10.1.1, 2026-10-26, on the built package and the import config that awaits the package
after `break.ts` (measured):

| Route | Intact | Broken `LzTextLiteral` sample |
|---|---|---|
| `plugins` + `ignorers` | exit 0 | exit 1: `stryker-playwright-mutators: the instrumenter 10.1.1 in ... made no mutants of LzTextLiteral from their samples ...`, then `ERROR Stryker ... Cannot find Ignore plugin "stryker-playwright-mutators"` |
| config import | exit 0 | exit 1: `Invalid config file "stryker.import.config.mjs". Error during import. Inner error: Error: stryker-playwright-mutators: ... made no mutants of LzTextLiteral ...` |

Both intact runs report the same mutants of `src.tsx` in `out/<route>/mutation.json`: 12 from seven UI
operators (`LzTextLiteral` 4, `LzElementRole` 3, `LzHiddenAttribute`, `LzConditionalElement`,
`LzLabelAttribute`, `LzEventHandler` and `LzUrlAttribute` 1 each) next to 5 built-in ones.
