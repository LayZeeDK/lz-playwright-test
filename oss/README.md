# Open-source copies used to validate the runner

Each folder holds what a disposable copy of an upstream repo needed for a Stryker run with this runner.
Never apply these to the upstream clone itself. `docs/VERDICT.md` (Evidence) has the results.

Every copy also needs this runner and StrykerJS installed. Link the runner as a directory junction or
an absolute link. Node resolves the link and strips the runner's TypeScript outside `node_modules`.
Every Stryker config here loads the runner by its package name, `@layzee/stryker-playwright-runner`.

Build both packages in this repo first. A copy loads each package from its `dist` folder, which a fresh
clone does not have; without it the import fails with `ERR_MODULE_NOT_FOUND`.

```sh
npx nx run-many -t build
npm install -D @stryker-mutator/core@^10.1.1 file:<this repo>/packages/stryker-playwright-runner
```

The runner needs `@playwright/test` 1.63 or a later 1.x release. If the copy has an older one or none,
also install `@playwright/test@^1.64.1`. ngx-yeti ran on its own `@playwright/test` 1.63.0.

## realworld: stefanoslig/angular-ngrx-nx-realworld-example-app at bc7158d

`node oss/realworld/prepare.ts <copy>` makes every change and writes the Stryker config. The API double
it uses is `oss/realworld-api`. Then run `npx stryker run stryker.playwright.config.ts` in the copy.

## hello-world: Huluvu424242/stryker-playwright-hello-world at fa6dd64

1. Copy `hello-world/stryker.playwright.config.ts` into the copy. For the forced-timeout check, also
   copy `hello-world/stryker.forced-timeout.config.ts`.
2. Remove the repo's Vite `define` of the active mutant, which overrides the runner's value.
   `tools/bench-hello-world.ts` does this itself and restores the file afterwards.

## ngx-yeti: a `git clone --local` of ngx-yeti at 87d4377

1. Apply `ngx-yeti/copy.patch` (`.stryker-tmp` in `.gitignore`) and copy
   `ngx-yeti/stryker.playwright.config.ts` into the copy.
2. Run `npx nx run yeti-css:yeti-build` once. Storybook reads `node_modules/yeti-css/dist`, which
   resolves to the copy itself, not to Stryker's sandbox. Then run `npx nx daemon --stop`. Stryker
   copies `.nx/workspace-data` into its sandbox, and while the daemon that the build started is
   running, the sandbox's Nx connects to it, the daemon refuses a different workspace, and the
   `webServer` fails to start.
3. Run `npx stryker run stryker.playwright.config.ts`. The config sets `lzPlaywright.workers` to 2 and
   `dryRunTimeoutMinutes` to 20, because the 234-test dry run takes longer than Stryker's default
   5 minutes on one worker.

## analog: analogjs/analog `beta` at a377078ec

1. Install with pnpm, not the npm line above:
   `pnpm add -D @stryker-mutator/core@10.1.1 @playwright/test@^1.64.1`. The copy's own
   `@playwright/test` is `^1.58.2`, below the runner's 1.63 floor; the copy's `package.json` diff
   after the run showed both versions. Then link the runner as a junction at
   `node_modules/@layzee/stryker-playwright-runner`, the name that
   `analog/stryker.playwright.config.ts` loads.
2. Apply `analog/copy.patch` and copy `analog/stryker.playwright.config.ts` into the copy. The patch:
   - starts the built SSR server instead of `nx serve-nitro`, whose `PORT=3000 node ...` cannot run
     in cmd.exe;
   - turns off `reuseExistingServer`;
   - sets `disableTypeChecking: true`, because the build's template type-check rejects Stryker's
     instrumented code;
   - adds `.stryker-tmp` to `.gitignore`.
3. Run `npx stryker run stryker.playwright.config.ts`. If it reports "Failed to delete stryker temp
   directory", stop the Nx daemon the build started: `npx nx daemon --stop` from the sandbox folder.

## epic-stack: epicweb-dev/epic-stack at 893610d

The run uses the JSX mutators and the TypeScript checker, against the repo's own e2e tests on its Vite
dev server (`npm run dev`), which compiles Stryker's sandbox on the fly.

1. Copy `.env.example` to `.env`, the repo's own setup step.
2. Install the runner, StrykerJS, and Playwright as above, plus the mutators and the checker:
   `npm install -D @stryker-mutator/typescript-checker@10.1.1 file:<this repo>/packages/stryker-jsx-mutators`.
   The copy pins `@playwright/test` to `^1.58.1`.
3. Apply `epic-stack/copy.patch` and copy `epic-stack/stryker.playwright.config.ts` into the copy.
   The patch:
   - sets Prisma's `engineType = "binary"`. Prisma 6.19 ships its query engine for Windows only as
     an x64 Node-API library, which arm64 Node cannot load. The binary engine is an x64 process,
     which Windows on Arm runs under emulation;
   - moves the default port from 3000 to 3313. The dev server moves to the next free port when its
     port is taken, while Playwright keeps waiting on the configured one;
   - raises the test timeout from 15 s to 30 s. On a cold dev server the 2FA test ran past 15 s;
   - adds `use.actionTimeout: 5000`, which the copy's config does not set;
   - marks "Users can update their profile photo" `test.fixme`. It failed in every plain run: its
     `/change/i` button locator matches the previous page's "Save changes" button before the photo
     page renders.
4. Run the repo's setup steps: `npx prisma migrate deploy`, then `npx prisma generate --sql`, which
   reads the tables the migration creates ("no such table: User" otherwise), then `npm run build`,
   `npx playwright install chromium`, and `npx react-router typegen` for the checker. Plain `npx playwright test --workers=1` then passes 25 tests and skips 1.
5. Run `npx stryker run stryker.playwright.config.ts`. Keep the copy's `reuseExistingServer: true`:
   when the type checker finishes, Stryker starts a second test runner, which would otherwise fail
   with "http://localhost:3313 is already used". So from then on two test runners share one dev
   server and one SQLite database, even at `concurrency: 1`. A test that one runner's data breaks can
   fail without a mutant at fault, which turns a survivor into a kill; that may be why two mutants
   killed on 2026-10-29 survived on 2026-10-31.

## react-virtuoso: petyosi/react-virtuoso at 31aef22

The run mutates three library files and five Ladle example files that the e2e specs open, against the
repo's own e2e tests on its Ladle dev server, which compiles Stryker's sandbox on the fly. Every step
below runs in `packages/react-virtuoso` unless it says otherwise.

1. Install with pnpm from the copy's root: `pnpm install --frozen-lockfile --filter react-virtuoso...`.
2. Install StrykerJS and Playwright:
   `pnpm add -D @stryker-mutator/core@10.1.1 @playwright/test@^1.64.1 playwright@^1.64.1`. The copy
   has `@playwright/test` `^1.60.0`, below the runner's 1.63 floor, and a separate `playwright`
   dependency; with only `@playwright/test` raised, `npx playwright` still runs the 1.60 CLI. Then link
   the runner and the mutators as junctions at `node_modules/@layzee/stryker-playwright-runner` and
   `node_modules/@layzee/stryker-jsx-mutators` in the copy's root. Stryker loads plugins from its own
   install in pnpm's store, which sees the root `node_modules` but not the package's.
3. Apply `react-virtuoso/copy.patch` from the copy's root and copy
   `react-virtuoso/stryker.playwright.config.ts` into `packages/react-virtuoso`. The patch:
   - starts Ladle with `node <ladle cli> serve` and sets `LADLE=true` through `webServer.env`, instead
     of `npm run ladle`, whose `LADLE=true ladle serve` cannot run in cmd.exe. `vite.config.ts` loads
     its library-build config unless `LADLE` is set;
   - looks for the Ladle CLI in `node_modules` of the config's folder or two levels up. Stryker's
     sandbox has no `node_modules` (see step 5), and Node resolves from the package's
     `node_modules` above it;
   - sets `BROWSER: 'none'`, which stops Ladle from opening a browser window each time it starts;
   - gives each Stryker test runner process its own port, 61000 plus `STRYKER_MUTATOR_WORKER`;
   - turns off `reuseExistingServer`;
   - adds `.stryker-tmp` to `.gitignore`.
4. Run `npx playwright install chromium`. Plain `npx playwright test --workers=1` then passes 45 tests
   and skips 1 (the repo's own `test.skip`).
5. Run `npx stryker run stryker.playwright.config.ts`. The config sets `symlinkNodeModules: false`:
   pnpm links packages with relative symlinks, and Node does not resolve them through the junction
   Stryker makes from the sandbox's `node_modules`, so Ladle failed with "Cannot find module
   ...\sandbox-...\node_modules\@ladle\react\lib\cli\cli.js". Keep `tempDirName: '.stryker-tmp'`
   inside the package: Stryker rewrites the sandbox's `tsconfig.json` `extends` for that depth, and a
   temp folder elsewhere leaves Vite unable to load `../../tsconfig.base.json`.

## tldraw: tldraw/tldraw at 12921f6

The canvas case. tldraw draws its overlays and its minimap on 2D canvases, so a trace shows them only
with `traceScreenshots`. Both configs record traces of survivors with
screenshots, against the repo's own e2e tests on its Vite dev server (`pnpm dev` in `apps/examples`).

- `tldraw/stryker.playwright.config.ts` runs the JSX mutators, and no built-in mutator, on seven
  files the seven specs drive: comment pins, stack and composer, menu items, the rich-text shape label,
  the live region and the minimap component.
- `tldraw/stryker.canvas.config.ts` runs the built-in mutators on the minimap's background fill and
  transform (`MinimapManager.ts:233-241`). The minimap spec checks only that the minimap shows, so these
  mutants survive, and their traces show what they drew.

1. Apply `tldraw/copy.patch` and copy both configs into the copy's root. The patch:
   - sets the workspace's `@playwright/test` to 1.64.1. The root and `apps/examples` both declare
     `^1.61.0`, below the runner's 1.63 floor;
   - on win32-arm64 only: raises sqlite3's `node-gyp` to `^13`. sqlite3 5.1.7 ships node-gyp 8.4.1, which
     finds neither Visual Studio 2026 nor the Windows 11 SDK, so `apps/docs` fails to install;
   - adds `apps/examples/e2e/playwright.stryker.config.ts`: the seven specs, chromium only, no retries,
     and the Vite dev server instead of upstream's build and preview. It leaves out the `text measurement`
     tests, whose expected widths come from another platform's fonts: on Windows 11 arm64 "measures
     text" measured 88.06 px against 87, and the custom `renderMethod` case 168.53 px against at most
     167. The other specs then pass: 31 tests, 2 skipped;
   - adds `.stryker-tmp` and `/reports` to `.gitignore`.
2. Run `pnpm install` with the `pnpm` on your `PATH`, not the npm line above; it switches to the
   version in `packageManager`. Through `corepack pnpm install`, the nested `pnpm` in the copy's
   `postinstall` refuses to switch.
3. Add the packages as dev dependencies at the root:
   `pnpm add -D -w @stryker-mutator/core@10.1.1 file:<runner tarball> file:<mutators tarball>`, with the
   tarballs from `npm pack` of both packages in this repo; then
   `pnpm install --no-frozen-lockfile` and `npx playwright install chromium`.
4. Run `npx stryker run stryker.playwright.config.ts`, then `npx stryker run stryker.canvas.config.ts`.
   Both set `inPlace: true`: the workspace packages resolve through per-package `node_modules` links to
   the copy's own source, so a sandbox would serve unmutated code. Copy
   `reports/lz-playwright-traces` aside between the runs; each run empties it.
5. Let an in-place run finish. Stryker puts the original files back only when the run ends, and a
   stopped run leaves thousands of files instrumented; restore them from `.stryker-tmp/backup-*`. The
   JSX run is incremental, but Stryker writes the incremental file only at the end, so a stopped run
   keeps nothing. To fit a run into shorter slots, run one file at a time with
   `--mutate <file>`.

Results on Windows 11 arm64, one file per run, concurrency 2 for the JSX config and 1 for the canvas
config (2026-11-04):

| File | Mutants | Killed | Timed out | Survived | No coverage | Score | Run |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `MinimapManager.ts:233-241` (canvas config) | 4 | 0 | 0 | 4 | 0 | 0% | 3 min |
| `A11y.tsx` | 5 | 0 | 0 | 5 | 0 | 0% | 12 min |
| `thread-stack.tsx` | 15 | 3 | 0 | 12 | 0 | 20% | 4 min |
| `thread-pin.tsx` | 25 | 7 | 0 | 17 | 1 | 28% | 4 min |
| `RichTextLabel.tsx` | 27 | 7 | 1 | 18 | 1 | 30% | 6 min |
| `DefaultMinimap.tsx` | 32 | 7 | 1 | 23 | 1 | 25% | 4 min |
| `comment-composer.tsx` | 40 | 7 | 1 | 31 | 1 | 20% | 4 min |
| `TldrawUiMenuItem.tsx` | 79 | 14 | 4 | 51 | 10 | 23% | 31 min |

The `A11y.tsx` run includes Vite's cold start, the first of the JSX runs. `PlainTextLabel.tsx` is not in the config: only the
speech-bubble example uses it, and no spec opens that example, so its run stopped in the dry run
with "No page loaded instrumented code".

## sigma: jacomyal/sigma.js at 1db3385

The WebGL case. sigma draws graphs with WebGL2, and its regression suite compares screenshots of the canvas,
so a mutant in a shader string or in the geometry code is killed only when the picture changes. The config
mutates the node shapes and their instance registry, the arrow edge extremity and the line, curved and loop
edge paths, the code the 12 regression scenarios run when they render, against `packages/browser-tests/regression` on its Vite dev server.

1. Apply `sigma/copy.patch` and copy `sigma/stryker.webgl.config.ts` into the copy's root. The patch:
   - adds `packages/browser-tests/playwright.stryker.config.ts`: the regression suite only, no retries, and
     only the regression `webServer`. The examples suite needs the Astro website, whose dev server downloads
     datasets first;
   - adds `.stryker-tmp` and `/reports` to `.gitignore`.
2. Run `npm ci`, then
   `npm i -D @stryker-mutator/core@10.1.1 @playwright/test@1.64.1 playwright@1.64.1 file:<runner tarball>`.
   The lockfile has Playwright 1.60, below the runner's 1.63 floor. npm 12 blocks the esbuild and sharp
   install scripts; the regression suite runs without them. The root `postinstall` (`preconstruct dev`)
   still runs and points the `sigma` package at its source.
3. Run `npx playwright install chromium`. Plain
   `npx playwright test -c packages/browser-tests/playwright.stryker.config.ts` then passes 12 tests. The
   upstream config pins Chromium to software WebGL (SwiftShader), and with it the Linux baselines match on
   Windows 11 arm64 within upstream's 0.1% tolerance: `--update-snapshots` rewrote none of them.
4. Run `npx stryker run stryker.webgl.config.ts`. It sets `inPlace: true`: npm workspaces link `sigma` to
   `packages/sigma`, and preconstruct points that at `src`, so a sandbox would serve unmutated code.

Result on Windows 11 arm64, concurrency 4, 15.5 minutes (2026-11-04). Free memory fell from 15.1 to 10.8 GB
during the run, about 1.1 GB per unit of concurrency:
523 mutants, 168 killed, 105 survived, 250 without coverage. The run used a wider `mutate` than the config
now has; 191 of the uncovered mutants came from files no scenario draws (`instance-registry.test.ts`,
`rectangle.ts` and four edge extremities). Without them, from the same run's per-file rows: 332 mutants,
168 killed, 105 survived, 59 without coverage, a score of 50.6%.
