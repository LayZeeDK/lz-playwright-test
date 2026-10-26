# Negative control: a broken install stops `stryker run` on both routes

The design (`docs/design/playwright-mutators.md`, "What the verification plan adds", step 2) asks for a run
that breaks one operator's sample on purpose and shows that `stryker run` stops with that operator's name,
once per route. `break.ts` gives `LzTextLiteral` a sample it cannot mutate when `SPIKE_BROKEN=1`. A config's own
imports run before core loads `plugins`, so the real `@layzee/lz-stryker-ui-mutators` specifier installs the
broken table on both routes. With `SPIKE_BROKEN=0` the same runs are the control, and their JSON reports show
whether the UI operators reach a real run (the gate under "Risks that remain").

Run from this folder, after `npm install` has linked the workspace package:

```sh
SPIKE_BROKEN=0 node ../../node_modules/@stryker-mutator/core/bin/stryker.js run stryker.plugins.config.mjs
SPIKE_BROKEN=1 node ../../node_modules/@stryker-mutator/core/bin/stryker.js run stryker.plugins.config.mjs
SPIKE_BROKEN=0 node ../../node_modules/@stryker-mutator/core/bin/stryker.js run stryker.import.config.mjs
SPIKE_BROKEN=1 node ../../node_modules/@stryker-mutator/core/bin/stryker.js run stryker.import.config.mjs
```

Result on StrykerJS 10.1.1 at `7fe02de`, 2026-10-26 (measured):

| Route | Intact | Broken `TextLiteral` sample |
|---|---|---|
| `plugins` + `ignorers` | exit 0 | exit 1: `WARN PluginLoader Error during loading "@layzee/stryker-ui-mutators" plugin: stryker-ui-mutators: ... made no mutants of TextLiteral from their samples ...`, then `ERROR Stryker ... Cannot find Ignore plugin "ui-mutators"` |
| config import | exit 0 | exit 1: `Invalid config file "stryker.import.config.mjs". Error during import. Inner error: Error: stryker-ui-mutators: ... made no mutants of TextLiteral ...` |

Both intact runs report the same mutants of `src.tsx` in `out/<route>/mutation.json`: 12 from seven UI
operators (`TextLiteral` 4, `ElementRole` 3, `HiddenAttribute`, `ConditionalElement`, `LabelAttribute`,
`EventHandler` and `UrlAttribute` 1 each) next to 5 built-in ones.
