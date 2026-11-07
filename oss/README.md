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

The e2e configs here set `lzPlaywright.webServer.mutate` to `true`, so their mutants in server code run
too. To run one with `'auto'` instead, set `LZ_CORPUS_WEBSERVER_MUTATE=auto` in the environment that runs
Stryker. The configs refuse any value other than `true` or `auto`. The component-test configs of
use-debouncy and punktlandung leave the option unset.

## Resuming a stopped run

Stryker writes its incremental file when a run ends, or on SIGINT, SIGTERM, SIGHUP or SIGABRT. On Windows a
run stopped with `Stop-Process -Force` or `taskkill /F` gets none of these, so it keeps nothing.
`tools/stryker-checkpoint.ts` is a reporter that writes the mutants tested so far to the incremental file
as they finish, at most once every 5 seconds. Add it to the run, with the config's own reporters listed again:

```sh
npx stryker run <config> --incremental --appendPlugins <this repo>/tools/stryker-checkpoint.ts --reporters <the config's reporters>,lz-checkpoint
```

Run the same command again to resume. Stryker reuses each result whose code and tests did not change.

An in-place run that was stopped leaves its changed files behind: the instrumented source, and
`// @ts-nocheck` at the top of every file Stryker checked. Restore them before you resume, from git or from
`.stryker-tmp/backup-*`. The checkpoint reads each file's original from that backup, so the resumed run sees
the original source.

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
5. Run `npx stryker run stryker.playwright.config.ts`. When the type checker finishes, Stryker starts a
   second test runner. With `webServer.mutate` on, the runner moves each test runner's dev server to a
   port of its own. Keep the copy's `reuseExistingServer: true` for a run where server support is off,
   such as `'auto'` after a fallback: the second test runner would otherwise fail with
   "http://localhost:3313 is already used", and the two then share one dev server. Either way they share
   one SQLite database, even at `concurrency: 1`. A test that one runner's data breaks can
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
   - adds `.stryker-tmp`, `/reports` and `.lz-playwright-server-mutants` to `.gitignore`. An in-place run
     writes the server mutants file into the copy's root.
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
   The JSX config runs at `concurrency: 2`, so the runner moves each process's dev server to a port of its
   own. `pnpm dev` binds port 5420 from the Vite config and has no port in its command for the runner to
   move. With `webServer.mutate: true`, the runner refuses this at startup and names both ports. With
   `LZ_CORPUS_WEBSERVER_MUTATE=auto`, every process falls back to running without server support, and
   `reuseExistingServer: true` lets the second process use the first one's server. Each process
   waits out the `webServer` timeout, 300 s here, before it falls back, so a run with two processes
   spends about 10 minutes starting before its first mutant. The canvas config
   runs one process at `concurrency: 1` and keeps port 5420.
5. Let an in-place run finish. Stryker puts the original files back only when the run ends, and a
   stopped run leaves thousands of files instrumented; restore them from `.stryker-tmp/backup-*`. The
   JSX run is incremental, but Stryker writes the incremental file only at the end, so a stopped run
   keeps nothing unless it ran with the checkpoint reporter ("Resuming a stopped run"). To fit a run into
   shorter slots, run one file at a time with `--mutate <file>`.

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
   - adds `.stryker-tmp`, `/reports` and `.lz-playwright-server-mutants` to `.gitignore`. An in-place run
     writes the server mutants file into the copy's root.
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

## fluid-player: fluid-player/fluid-player at 68aa004

The video case. fluid-player is an HTML5 video player whose e2e specs check the `<video>` element itself:
`currentTime`, `paused`, `readyState` and `playbackRate`, read through `evaluate` and `waitForFunction`. The
config mutates three playback modules (the timeline preview, the miniplayer and subtitles) against the repo's
own specs on its webpack dev server. The 3,551-line player core and the ad code are left out: at the measured
10 to 30 mutants a minute, depending on concurrency, they would need several more hours of runs.

1. Apply `fluid-player/copy.patch` and copy `fluid-player/stryker.video.config.ts` into the copy's root. The
   patch:
   - adds `playwright.stryker.config.ts`: Chromium instead of upstream's Firefox-only project, no retries, and a
     `webServer` that runs `webpack serve --mode=development --no-live-reload --port 8080`. The webpack config
     emits the e2e pages and copies the test media only in development mode, so upstream's `dev-server-test`
     script (production mode) serves none of them. The webpack config sets no port, so without `--port 8080`
     webpack-dev-server binds the first free port from 8080 and ignores `PORT`;
   - runs 11 of the 22 specs. Ten play local media (WebM, or an unplayable `.flv` in `ads_error_code`);
     `skip_stuck` streams `.mkv` files from `cdn.fluidplayer.com` and passed in every dry run. The other 11
     stream an H.264 MP4 from `media.w3.org` or `fluidplayer.com`, play local H.264 and HLS ads, or compare a
     screenshot made in Firefox. In a plain run most of them pass, but under Stryker's load they timed out at
     random in the dry run, and their results depend on the network;
   - deletes `.babelrc`. It only repeats the `@babel/preset-env` preset that `webpack.config.js` passes to
     `babel-loader`, and Stryker's instrumenter, which runs Babel 8, refused to load that Babel 7 preset;
   - adds `.stryker-tmp` and `/reports` to `.gitignore`.
2. Run `npx yarn@1.22.22 install --frozen-lockfile`, then
   `npx yarn@1.22.22 add -D @stryker-mutator/core@10.1.1 @playwright/test@1.64.1 file:<runner tarball>`. Add
   `--registry https://registry.npmjs.org` when your yarn configuration names another registry: the lockfile
   install uses the URLs in `yarn.lock`, but `yarn add` resolves through the configured registry.
3. Run `npx playwright install chromium`. With the 11 specs, Stryker's dry runs passed 39 tests in 1 to 3
   minutes. Before the spec list was cut down, a plain run of all 22 specs with 5 tests left out passed the
   other 73.
4. Run `npx stryker run stryker.video.config.ts`. It runs in Stryker's sandbox: webpack builds the sandbox's
   `src`. The config runs at `concurrency: 3`, so the runner moves each process's dev server to a port of
   its own: it rewrites the `--port 8080` in the command along with the `url`. Without that port in the
   command, `webServer.mutate: true` stops the run at startup. To
   split the run, pass one file at a time with `--mutate`; the incremental file carries finished files into the next run.
   `--mutate` takes a comma-separated list, so a brace glob such as `{a,b}.js` breaks into pieces that match
   nothing.

Results on Windows 11 arm64, one file per run, concurrency 2 to 4 as free memory allowed (2026-11-04):

| File | Mutants | Killed | Timed out | Survived | No coverage | Score | Run |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `src/modules/timeline.js` | 215 | 56 | 41 | 69 | 49 | 45% | 22 min |
| `src/modules/miniplayer.js` | 305 | 101 | 12 | 78 | 114 | 37% | 12 min |
| `src/modules/subtitles.js` | 369 | 171 | 19 | 108 | 71 | 51% | 19 min |
| Total | 889 | 328 | 72 | 255 | 234 | 45% | |

`timeline.js` was measured twice: with 68 tests (all specs but the two H.264 and HLS ones, and two tests) it
had 62 killed and 35 timed out; the row
above is the rerun with the 11 specs. Run times come from Stryker's "Done in" lines. The final report also
lists `suggestedVideos.js` from an earlier, wider `mutate`; it is not in the config. The timeouts are likely
mutants that stop playback, so that a spec waits for a `currentTime` or `readyState`
that never comes until Stryker's 20-second limit; the traces of individual timeouts were not checked.

## use-debouncy: eavam/use-debouncy at d8597b0

The component-test case. use-debouncy's tests are Playwright component tests in the stories model that
Playwright 1.62 introduced: plain `@playwright/test` tests call the built-in `mount('<story id>')` fixture, and
the repo's own Vite dev server serves a gallery page (`playwright/gallery/`) that renders each story. The config
mutates the hook's one source file, `src/index.ts`, against the 8 spec files in `playwright/tests` (Playwright
1.64.1); 7 of them take `test` from the repo's fake-clock fixture, `playwright/tests/fixtures.ts`.

1. Apply `use-debouncy/copy.patch` and copy `use-debouncy/stryker.ct.config.ts` into the copy's root. The patch:
   - adds `playwright.stryker.config.ts`: Chromium only (upstream also runs Firefox and WebKit), no retries,
     and a `webServer` that runs `npx vite --port 3100 --strictPort` instead of `yarn vite`, which needs yarn
     on the `PATH`;
   - adds `.stryker-tmp` and `/reports` to `.gitignore`.
2. Run `node .yarn/releases/yarn-4.18.1.cjs install`, then
   `node .yarn/releases/yarn-4.18.1.cjs add -D @stryker-mutator/core@10.1.1 @layzee/stryker-playwright-runner@file:<runner tarball>`.
   The repo commits its yarn release, so neither Corepack nor a global yarn is needed.
3. Run `npx playwright install chromium`. Plain `npx playwright test -c playwright.stryker.config.ts` then
   passes 47 tests in 14 seconds.
4. Run `npx stryker run stryker.ct.config.ts`. It sets `inPlace: true`: Stryker 10.1.1 rewrites a sandbox's
   `tsconfig.json` through TypeScript's JavaScript API, and the call it makes (`parseConfigFileTextToJson`)
   is missing from TypeScript 7, this repo's version. A sandbox run stopped with
   "ts.parseConfigFileTextToJson is not a function". Stryker skips that rewrite in place.

Result on Windows 11 arm64, concurrency 2, 5.4 minutes (2026-11-04): 43 mutants, 37 killed, 6 survived, none
without coverage, a score of 86%. The dry run ran the 47 tests in 34 seconds.

## punktlandung: davidvornholt/punktlandung at 0972969

The second component-test case, a React app in a bun workspace. Its `apps/web` package has 13
`*.story-test.ts` specs in the same stories model as use-debouncy: each test calls `mount('<story id>')`, and a
Vite server started with `playwright/vite.config.ts` serves the gallery page that renders the stories. The
config mutates 10 feature components that the specs mount, with the built-in mutators and the JSX mutators.

1. Apply `punktlandung/copy.patch` at the repo root and copy `punktlandung/stryker.ct.config.ts` into
   `apps/web`. The patch:
   - adds `apps/web/playwright.stryker.config.ts`, which extends upstream's `playwright-stories.config.ts` with
     no retries and a `webServer` that runs `node node_modules/vite/bin/vite.js`. Upstream runs
     `./node_modules/.bin/vite`, which cmd.exe cannot run, and `npx vite` is no way out: bun writes only `.exe`
     shims to `node_modules/.bin`, which npx does not see, so it can fetch a package of that name from the
     registry instead, as `npx stryker` does (step 3). The server is also reused (`reuseExistingServer: true`), so all test runner processes share it;
   - adds `.stryker-tmp` and `/reports` to a new `apps/web/.gitignore`.
2. Run `bun install` at the repo root (bun 1.4.4 was used; the repo names 1.4.3), then in `apps/web`
   `bun add -d @stryker-mutator/core@10.1.1 <runner tarball> <JSX mutators tarball>`.
3. In `apps/web`, run `node node_modules/@playwright/test/cli.js install chromium`. Plain
   `node node_modules/@playwright/test/cli.js test -c playwright.stryker.config.ts --workers=2` then passes 49
   tests in 22 to 26 seconds with Playwright 1.64.1. Call both CLIs through `node`: `npx stryker` runs the
   unrelated `stryker` 1.0.1 package from the registry, which stops with "Cannot find module 'rx'".
4. Run `node node_modules/@stryker-mutator/core/bin/stryker.js run stryker.ct.config.ts`. It runs in place:
   the `#/` imports resolve through the workspace's tsconfig paths and bun's links back to the package, so a
   sandbox would serve unmutated code, and Stryker 10.1.1 cannot rewrite a sandbox's `tsconfig.json` with
   TypeScript 7 (see use-debouncy). The config's brace globs work in the file; on the command line,
   `--mutate` takes a comma-separated list.

Results on Windows 11 arm64 (2026-11-04), in five incremental runs of one to three files, concurrency 1 to 3 as
free memory and busy cores allowed:

| File | Mutants | Killed | Timed out | Survived | No coverage | Score |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `noten/ui/upcoming-block.tsx` | 56 | 35 | 5 | 15 | 1 | 71% |
| `noten/ui/trend-chart.tsx` | 125 | 48 | 1 | 75 | 1 | 39% |
| `noten/ui/noten-list.tsx` | 71 | 29 | 27 | 15 | 0 | 79% |
| `noten/ui/leistung-detail.tsx` | 94 | 48 | 7 | 29 | 10 | 59% |
| `halbjahre/ui/halbjahre-management.tsx` | 1 | 0 | 0 | 0 | 1 | 0% |
| `halbjahre/ui/halbjahr-form.tsx` | 110 | 65 | 7 | 31 | 7 | 65% |
| `halbjahre/ui/conversion-reference.tsx` | 20 | 13 | 2 | 5 | 0 | 75% |
| `lernen/ui/learned-for-leistung.tsx` | 25 | 10 | 5 | 7 | 3 | 60% |
| `faecher/ui/gewichtung-field.tsx` | 56 | 13 | 0 | 43 | 0 | 23% |
| `faecher/ui/fach-form.tsx` | 40 | 16 | 5 | 18 | 1 | 53% |
| Total | 598 | 277 | 59 | 238 | 24 | 56% |

The paths are under `apps/web/src/features/`. The five runs took 4.5 to 14 minutes each, 44 minutes in all.
The first three ran with `timeoutMS: 10_000`; the runner warned that this is below the 10,600 ms it suggests, so
some kills may count as timeouts there, such as noten-list's 27. The last two, and the config here, use
`11_000`. gewichtung-field's low score comes from its tests, not the runner. Its two tests check the radio
choice between one list and a fixed ratio, the ratio inputs and one preset. No assertion reads the rows per
type of grade, and the survivors sit there: the rows that map GFS, other grades and tests onto another grade
type (`controlFor`), the split of the rows into written and oral, their event handlers, and the summary line
below them. halbjahre-management is a 6-line wrapper whose single mutant no spec reaches.
