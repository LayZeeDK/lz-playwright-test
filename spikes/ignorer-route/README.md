# Spike: the two fail-loud routes stop `stryker run`

The UI operators design (`docs/design/jsx-mutators.md`, Integration, "Fail loud") relies on two routes
that it marked as not spiked:

- an `Ignore` plugin named `ui-mutators` whose factory throws a kept install error (`plugin.mjs`), listed in
  `ignorers` (`stryker.ignorer.config.mjs`);
- a JavaScript config that imports a module whose top-level `await` rejects (`rejects.mjs`,
  `stryker.import.config.mjs`).

`SPIKE_MODE=throw` makes each one fail; `SPIKE_MODE=ok` is the control. Run from this folder:

```sh
SPIKE_MODE=ok node ../../node_modules/@stryker-mutator/core/bin/stryker.js run stryker.ignorer.config.mjs
SPIKE_MODE=throw node ../../node_modules/@stryker-mutator/core/bin/stryker.js run stryker.ignorer.config.mjs
SPIKE_MODE=ok node ../../node_modules/@stryker-mutator/core/bin/stryker.js run stryker.import.config.mjs
SPIKE_MODE=throw node ../../node_modules/@stryker-mutator/core/bin/stryker.js run stryker.import.config.mjs
```

Result on StrykerJS 10.1.1, 2026-10-25 (measured):

| Route | `ok` | `throw` |
|---|---|---|
| Ignorer factory | exit 0 | exit 1, `InjectionError: Could not inject [function ignorer]. Cause: SPIKE-KEPT-ERROR ...` |
| Config import | exit 0 | exit 1, `Invalid config file "stryker.import.config.mjs". Error during import. Inner error: Error: SPIKE-IMPORT-ERROR ...` |

Both routes stop the run with the error's message, and each control finishes.
