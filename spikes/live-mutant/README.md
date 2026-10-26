# Spike: drive the demo app on a live page with one mutant active

A `control-demo-app` skill could prove claims like "this surviving mutant visibly changes the page" only if an
agent can serve the instrumented demo app, with the same mutant ids as a Stryker report, and pick the active
mutant per browser session. This spike checks each step. Lars approved it on 2026-10-26.

## Steps

1. Keep an instrumented sandbox. From the repo root, after `npx nx run-many -t build`:

   ```sh
   node node_modules/@stryker-mutator/core/bin/stryker.js run spikes/live-mutant/stryker.sandbox.config.mjs
   ```

   The config imports `stryker.e2e.ui.config.ts`, so its mutate list, plugins and mutators are the same. It
   replaces the test runner with a command runner that does nothing, turns coverage analysis off, and writes
   only the JSON report. With `cleanTempDir: false`, `.stryker-tmp-live/sandbox-*` stays.

2. Serve the sandbox and drive it with `pwsh spikes/live-mutant/drive.ps1 -Sandbox <sandbox folder>`. It
   refuses to start when another process holds its port, 4700 unless you pass `-Port`. It starts Vite on that
   port from the sandbox, opens one playwright-cli session per case, sets `globalThis.__stryker__.activeMutant`
   with `page.context().addInitScript` before the app loads (as the runner's worker hook does), and reads the
   page. It exits with the number of failed checks. A case fails when its page differs from its expectation,
   and the run fails when the port is still open after Vite stops.

To check that the sandbox has the mutants of a workspace run of `stryker.e2e.ui.config.ts`:

```sh
node tools/compare-mutation-reports.ts spikes/live-mutant/out/mutation.json reports/e2e-ui/mutation.json
```

## Results (measured, 2026-10-26 and 27, StrykerJS 10.1.1, Vite 8.3.5)

- Step 1 ran in 16 s. Its `out/mutation.json` lists the same 65 mutants as the e2e-ui report at 74df74e,
  matched on id, file name, line and column, mutator (ignoring the `Lz` prefix the rename added) and
  replacement. The same comparison against the e2e report exits 1, so the match is not an empty pass.
- Vite serves the sandbox: `GET /src/app/app.tsx` returns the instrumented module, with mutant 23's check in it.
  After `Stop-Process` nothing listens on the port and no child process is left.
- The instrumented code reads `ns.activeMutant` from `globalThis.__stryker__`, so the demo config's Vite
  `define` of `globalThis.__stryker__.activeMutant` does not activate a mutant on a live page. An init script
  does.
- Step 2 exits 0 (playwright-cli 0.1.21, Chromium), first on 2026-10-26 and again after the review fixes on
  2026-10-27. Every case matched the expectation written in `drive.ps1` before the first run. Without a
  mutant the page shows `Subtotal|Shipping|Total`. Mutant 23 empties the first `<dt>`, mutant 16 empties both
  line labels, and mutant 6 puts `Stryker was here!` in the discount code input. The three mutant cases are
  their own controls, because each would have shown the page without a mutant and failed had the init script
  not activated it. Afterwards nothing listened on port 4700 and `playwright-cli list` showed no browser.
- With another process listening on port 4700, step 2 stops before it starts Vite, names that process's PID,
  exits 1, and leaves the process running.

## Verdict

The launch works. An agent can serve Stryker's instrumented copy of the demo app and show any one mutant of a
report on a live page. All three mutants above survived the e2e-ui run, and each visibly changes the page, so
none of them is equivalent. Mutants 23 and 16 are two of the four UI survivors that VERDICT calls test gaps.
A `control-demo-app` feature would take this as its entry point. Its `up` would run step 1 once per head and
start Vite on the sandbox, and a recipe would open one session per mutant with the init script. The spike does
not cover the CT gallery, or a mutant that only runs on the server, which the demo app does not have.
