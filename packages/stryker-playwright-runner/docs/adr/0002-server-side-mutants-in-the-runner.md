# Server-side mutants are a runner option, off by default, isolated by default

Code that the Playwright config's `webServer` runs (server rendering, loaders, actions, API routes) gets the active
mutant only with `lzPlaywright.webServer.mutate`. The runner, not an ignorer, owns this: Lars ruled "Don't add the
lz-playwright-server ignorer. Add server and API test support to the stryker-playwright-runner instead." `mutate`
takes `false`, `true` or `'auto'`. `false` is the default, and the dry run then logs that the server's mutants stay
NoCoverage; Lars chose that shipped default over `true`. `true` gives the `webServer` each mutant and stops the
runner at startup when the setup cannot work. `'auto'` does the same but falls back to `false` with a warning.
`isolate` defaults to `true`: the runner restarts the `webServer` before a run when that run or the one before it
tests a server-side mutant, so state that one mutant run leaves in the server is not read by the next.

## Considered Options

- An `lz-playwright-server` ignorer that hides server-side mutants. Rejected by the ruling above. On a copy of
  epic-stack, 80 of 244 mutants sat in loaders and actions that never ran with a mutant.
- `'auto'` as the default. It is planned as a later default, once the restart behaviour is settled and the cost of
  the dry run's detection hint is measured; it is not the default yet.
- `isolate: false` as the default. One server for every run is faster, but a cache filled by one mutant run is read
  by the next. A restart cost about 10 s per restarted run on epic-stack's Vite dev server, so `isolate: false`
  stays an opt-in for servers that keep no state between requests.
- Warming the `webServer` after the dry run's restart, so that Stryker's timeout covers cold requests. Measured under
  load, 6 of 6 mutant runs were Timeouts without the warm-up and 4 of 6 with it, a difference that did not hold up
  (Fisher p about 0.45), while the warm-up added about 10 s to each Stryker run's dry run at a normal start. So it was
  not shipped, and the README asks for a larger `timeoutMS` instead.
