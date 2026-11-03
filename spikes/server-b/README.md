# Spike B: server mutants in a real Stryker run

Plan: `plans/server-and-api-tests.plan.md`, step 2. Ruling, Lars, 2026-11-03: "Don't add the lz-playwright-server
ignorer. Add server and API test support to the stryker-playwright-runner instead."

The fixture is a plain `node:http` server (`src/server.mjs`) that Playwright starts as its `webServer`. Stryker
mutates only `src/cart.mjs`, which only the server runs. Four tests use it:

| Test (file) | Cart | Reaches |
| --- | --- | --- |
| API big: `the API charges no shipping on a cart over 50` (`api.spec.mjs`) | 3 mugs, 1 poster = 56 | `request` fixture, `GET /api/total` |
| API small: `the API adds shipping to a cart of 50 or less` (`api.spec.mjs`) | 1 mug, 1 poster = 36.95 | `request` fixture, `GET /api/total` |
| Page big: `the page shows a cart over 50 without shipping` (`page.spec.mjs`) | 56 | page navigation, server-rendered |
| Page small: `the page recounts a cart of 50 or less with shipping` (`page.spec.mjs`) | 36.95 | navigation, then an in-page `fetch` to `/api/total` |

The runner's server support is behind `LZ_PLAYWRIGHT_SERVER_TESTS` (provisional name): `header` (test id header,
arrival-time fallback), `arrival` (arrival time only) or `off`. `SPIKE_B_WORKERS` sets the runner's `workers`. The
JSON report goes to `spikes/server-b/out/<mode>-w<workers>.json`.

## Commands (coordinator, under the shared-machine lock, from the repo root, Git Bash)

Merge the branch first, so the root `node_modules/@layzee/stryker-playwright-runner` link points at this code.

```sh
npx nx run @layzee/stryker-playwright-runner:build

# 0. Control: the switch off.
LZ_PLAYWRIGHT_SERVER_TESTS=off npx stryker run spikes/server-b/stryker.config.mjs

# 1-4. Header mode and arrival mode, with 1 and 2 Playwright workers.
LZ_PLAYWRIGHT_SERVER_TESTS=header SPIKE_B_WORKERS=1 npx stryker run spikes/server-b/stryker.config.mjs
LZ_PLAYWRIGHT_SERVER_TESTS=header SPIKE_B_WORKERS=2 npx stryker run spikes/server-b/stryker.config.mjs
LZ_PLAYWRIGHT_SERVER_TESTS=arrival SPIKE_B_WORKERS=1 npx stryker run spikes/server-b/stryker.config.mjs
LZ_PLAYWRIGHT_SERVER_TESTS=arrival SPIKE_B_WORKERS=2 npx stryker run spikes/server-b/stryker.config.mjs

# 5. Fail loud: concurrency 2 with a shared server.
```

For step 5, copy `playwright.config.mjs` to `playwright.shared.config.mjs` with a fixed `port = 4830` and
`reuseExistingServer: true`, point a copy of the Stryker config at it, and run that with `--concurrency 2`. The second
test runner process must refuse to start with "LZ_PLAYWRIGHT_SERVER_TESTS is on, but the webServer at ... already
answers and reuseExistingServer is true". A second fail-loud check: add `NODE_OPTIONS: ''` to the webServer `env`;
init must refuse with "a webServer's env sets NODE_OPTIONS". The unit tests cover both with a fake Playwright, so
these two are optional.

Add `--logLevel debug` to a run to see each "Restarting the webServer with static mutant" line.

## What to check

- Run 0 fails the dry run with "No page loaded instrumented code", because no page or worker runs the mutated
  code (inferred from `missingCoverageError` in `run-result.ts`). That is today's behaviour, and it shows that runs
  1 to 4 get their coverage from the server.
- Runs 1 to 4: no mutant is NoCoverage. Every server mutant is Killed or Survived.
- Per-test coverage, from each mutant's `coveredBy` and `killedBy` in the JSON report (test ids map to names in
  the report's `testFiles`):
  - Mutant 9 (`subtotal - 4.95`, the shipping branch) is covered by API small and Page small only. That must
    hold in header mode with 1 and with 2 workers.
  - In arrival mode with 1 worker the same should hold. With 2 workers a big test that ran at the same time may
    be added to `coveredBy` (over-approximation), never a small test taken away.
  - Every mutant's `killedBy` is a subset of its `coveredBy`.
- Mutant 0 (`'EUR'` emptied at module scope) is static: Stryker runs it against every test, and the debug log
  shows a restart into it and one back out on the next run.
- Afterwards nothing listens on ports 4830 and 4831, and `.stryker-tmp-server-b` is gone.
- Note the dry run time of header mode against arrival mode: header mode routes each page request to the
  server through the Playwright worker.

## Expected mutant outcomes (inferred, not run)

Ids as `@stryker-mutator/instrumenter` 10.1.1 numbers `src/cart.mjs` (listed with the instrumenter on 2026-11-03,
measured; the outcomes below are predictions).

| Id | Mutant | Covered by | Outcome |
| --- | --- | --- | --- |
| 0 | `'EUR'` -> `""` (module scope) | static: all tests | Killed by all four, after a restart with the mutant |
| 1 | `total` body -> `{}` | all four | Killed; `label(undefined)` throws, the server crashes, the runner restarts it and reruns once |
| 2 | `+` -> `-` in the subtotal | all four | Killed by all four |
| 3 | `mugs * 12` -> `mugs / 12` | all four | Killed by all four |
| 4 | `posters * 20` -> `posters / 20` | all four | Killed by all four |
| 5 | condition -> `true` | all four | Killed by the two small tests |
| 6 | condition -> `false` | all four | Killed by the two big tests |
| 7 | `> 50` -> `>= 50` | all four | Survived: no cart totals exactly 50 |
| 8 | `> 50` -> `<= 50` | all four | Killed by all four |
| 9 | `subtotal + 4.95` -> `subtotal - 4.95` | API small, Page small | Killed by those two |
| 10 | `label` body -> `{}` | all four | Killed by all four |
| 11 | template -> empty | all four | Killed by all four |

Expected score: 11 of 12 (91.67 %), 0 NoCoverage. With `disableBail` off (the default) Stryker stops a mutant
run at the first failure, so `killedBy` may list one test where the table names several.

## Result

(to be filled in by the coordinator)
