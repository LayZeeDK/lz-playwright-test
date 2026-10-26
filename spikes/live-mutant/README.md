# Spike: drive the demo app on a live page with one mutant active

A `control-demo-app` skill could prove claims like "this surviving mutant visibly changes the page" only if an
agent can serve the instrumented demo app, with the same mutant ids as a Stryker report, and pick the active
mutant per browser session. This spike checks each step. Lars approved it on 2026-10-26.

## Steps

1. Keep an instrumented sandbox. From the repo root, after `npx nx run-many -t build`:

   ```sh
   node node_modules/@stryker-mutator/core/bin/stryker.js run spikes/live-mutant/stryker.sandbox.config.mjs
   ```

   The config has the mutate list and plugins of `stryker.e2e.ui.config.ts`, a command runner that does
   nothing, and `cleanTempDir: false`, so `.stryker-tmp-live/sandbox-*` stays.

2. Serve the sandbox and drive it: `pwsh spikes/live-mutant/drive.ps1 -Sandbox <sandbox folder>`. It starts
   Vite on port 4700 from the sandbox, opens one playwright-cli session per case, sets
   `globalThis.__stryker__.activeMutant` with `page.context().addInitScript` before the app loads (as the runner's
   worker hook does), reads the page, and exits with the number of failed cases.

## Results so far (measured, 2026-10-26, StrykerJS 10.1.1, Vite 8.3.5)

- Step 1 ran in 11 s. Its `out/mutation.json` lists the same 65 mutants as the e2e-ui report at 74df74e,
  matched on id, file, line and column, mutator (ignoring the `Lz` prefix the rename added) and replacement.
  The same comparison against the e2e report exits 1, so the match is not an empty pass.
- Vite serves the sandbox: `GET /src/app/app.tsx` returns the instrumented module, with mutant 23's check in it.
  After `Stop-Process` nothing listens on the port and no child process is left.
- The instrumented code reads `ns.activeMutant` from `globalThis.__stryker__`, so the demo config's Vite
  `define` of `globalThis.__stryker__.activeMutant` does not activate a mutant on a live page. An init script
  does.
- Step 2 exits 0 (playwright-cli 0.1.21, Chromium). Every case matched the expectation written in `drive.ps1`
  before the first run: without a mutant the page shows `Subtotal|Shipping|Total`; mutant 23 empties the
  first `<dt>`; mutant 16 empties both line labels; mutant 6 puts `Stryker was here!` in the discount code
  input. The three mutant cases are their own controls: had the init script not activated them, each would
  have shown the page without a mutant and failed. Afterwards nothing listened on port 4700 and
  `playwright-cli list` showed no browser.

## Verdict

The launch works: an agent can serve Stryker's instrumented copy of the demo app and show any one mutant of a
report on a live page. All three mutants above survived the e2e-ui run, and each visibly changes the page, which
measures the VERDICT claim that they are test gaps rather than equivalent mutants. A `control-demo-app` feature
would take this as its entry point: `up` runs step 1 once per head and starts Vite on the sandbox, and a recipe
opens one session per mutant with the init script. Not covered: the CT gallery, and a mutant that only runs on
the server (the demo app has none).
