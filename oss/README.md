# Open-source copies used to validate the runner

Each folder holds what a disposable copy of an upstream repo needed for a Stryker run with this runner.
Never apply these to the upstream clone itself. `docs/VERDICT.md` (Evidence) has the results.

Every copy also needs this runner and StrykerJS installed. Link the runner as a directory junction or
an absolute link. Node resolves the link and strips the runner's TypeScript outside `node_modules`.
Every Stryker config here loads the runner by its package name, `@layzee/stryker-playwright-runner`.

```sh
npm install -D @stryker-mutator/core@^10.1.1 file:<this repo>/packages/stryker-playwright-runner
```

The runner needs `@playwright/test` 1.63 or later. If the copy has an older one or none, also install
`@playwright/test@^1.64.1`. ngx-yeti ran on its own `@playwright/test` 1.63.0.

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
   resolves to the copy itself, not to Stryker's sandbox.
3. Run `npx stryker run stryker.playwright.config.ts`. The config sets `playwright.workers` to 2 and
   `dryRunTimeoutMinutes` to 20, because the 234-test dry run takes longer than Stryker's default
   5 minutes on one worker.

## analog: analogjs/analog `beta` at a377078ec

1. Install with pnpm, not the npm line above: `pnpm add -D @stryker-mutator/core@10.1.1
   @playwright/test@^1.64.1`. The copy's own `@playwright/test` is `^1.58.2`, below the runner's 1.63
   floor; the copy's `package.json` diff after the run showed both versions. Then link the runner as a
   junction at `node_modules/@layzee/stryker-playwright-runner`, the name that
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
