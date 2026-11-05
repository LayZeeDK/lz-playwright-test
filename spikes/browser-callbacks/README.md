# Spike: Stryker mutants inside Playwright callbacks that run in the browser

Playwright sends a callback's source text to the browser for `evaluate`, `evaluateHandle`, `$eval`, `$$eval`,
`evaluateAll`, `waitForFunction` and `addInitScript` (playwright v1.64.1 `client/jsHandle.ts:46`,
`client/clientHelper.ts:33-37`). Stryker's instrumenter puts calls to its file-scope helpers `stryMutAct_9fa48` and
`stryCov_9fa48` inside that text (stryker-js v10.1.1 `instrumenter/src/util/syntax-helpers.ts:22-66`), and the browser
has no such functions.

## Files

- `source.spec.ts`: one test whose `page.evaluate` callback holds five mutants.
- `instrument.mjs`: writes Stryker's instrumented copy (`instrumented.spec.ts`, importing `fixtures.ts`) and the
  helper header (`helpers.js`), and lists the mutants.
- `fixtures.ts`: with `SPIKE_MODE=helpers`, gives every page the helper header and `SPIKE_ACTIVE` as the active
  mutant through `context.addInitScript`, then prints the coverage the page recorded.
- `serialized-callback-ignorer.mjs` and `ignorer-check.mjs`: the other fix, a Stryker Ignore plugin, checked
  statically.

Run: `node spikes/browser-callbacks/instrument.mjs`, then
`node node_modules/@playwright/test/cli.js test -c spikes/browser-callbacks/playwright.config.ts` with the
environment variables above. It opens Chromium, so it needs the shared machine lock.

## Results (measured 2026-11-05)

| Case                                 | Result                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Bare page                            | `ReferenceError: stryMutAct_9fa48 is not defined`                                              |
| Helpers, no active mutant            | passes; the page covers all 5 callback mutants                                                 |
| Helpers, each callback mutant active | all 5 killed                                                                                   |
| Ignorer, static                      | the 5 callback mutants Ignored, the 3 outside it placed; the callback text has no helper calls |

Playwright runs init-script content inside a function, so the helper declarations must be published on
`globalThis`; plain declarations stayed local and the first try failed the same way as the bare page.

The runner already gives every page an init script that sets `__stryker__.activeMutant`, the current test id and
the hit limit, and reads page coverage per test (`packages/stryker-playwright-runner/src/worker-hook.ts:241,455-508`).
The page-helper fix adds the three helper functions to that script.

Not covered by an init script: web workers and service workers (`worker.evaluate`) and Electron's main process
(`electronApp.evaluate`).
