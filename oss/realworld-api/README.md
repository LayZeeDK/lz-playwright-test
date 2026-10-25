# RealWorld API double

A dependency-free, in-memory RealWorld ("Conduit") backend for the Angular/Nx RealWorld app's Playwright suite, so
mutation runs never touch the third-party Heroku API. Node 24 runs the TypeScript directly (type stripping, erasable syntax only).
`ENDPOINTS.md` lists what is implemented and who calls it.

## Run

```sh
node D:/projects/sandbox/stryker-playwright-runner/oss/realworld-api/server.ts
```

| Variable | Default | Effect |
|----------|---------|--------|
| `PORT` | `3100` | Listen port. API base is `http://localhost:<PORT>/api`. |
| `STATE_FILE` | unset | Path to a JSON file. When set, state and the token secret are loaded from it on start (seed data if the file does not exist) and the whole state is rewritten after every successful non-GET request (temp file in the same directory, then rename). Users, tokens, articles, comments, favorites and follows survive a restart. Delete the file to reset. Unset: purely in-memory, state resets on every start. |
| `DEBUG` | unset | Log one line per request. |

Check: `node --test D:/projects/sandbox/stryker-playwright-runner/oss/realworld-api/server.test.ts`

Use `localhost`, not `127.0.0.1`, everywhere: auth is a `jwt` cookie (the app sends no `Authorization` header), and the cookie is only
shared between `localhost:4200` and `localhost:3100` when both use the same host name.

The double listens on loopback only, answers only requests whose `Host` is a loopback name, refuses any request whose `Origin` is not
an `http://` origin on a loopback name, and grants CORS with credentials only to those origins. The state file holds the token secret
and the seeded passwords. On POSIX it is written with mode 0600; on Windows the mode is ignored and the folder's ACL decides who can
read it. `oss/realworld-api/state.json` is gitignored.

## Edits for a disposable copy of the app

Do not apply these to the original clone. In the copy, change four places.

`apps/conduit/src/environments/environment.ts` (line 8) and `environment.prod.ts` (line 3):

```ts
// before
api_url: 'https://real-world-app-39656dff2ddc.herokuapp.com/api',
// after
api_url: 'http://localhost:3100/api',
```

The e2e helpers also hard-code the Heroku URL and bypass `api_url`: `apps/conduit-e2e/src/helpers/register-user.ts` (line 4) and `login-user.ts` (line 4):

```ts
// before
requestContext.post('https://real-world-app-39656dff2ddc.herokuapp.com/api/users', {
requestContext.post('https://real-world-app-39656dff2ddc.herokuapp.com/api/users/login', {
// after
requestContext.post('http://localhost:3100/api/users', {
requestContext.post('http://localhost:3100/api/users/login', {
```

`apps/conduit-e2e/playwright.config.ts`: turn `webServer` into an array and put the API first:

```ts
// before
webServer: {
  command: 'npx nx run frontend:serve-static',
  url: 'http://localhost:4200',
  reuseExistingServer: !process.env.CI,
  cwd: workspaceRoot,
},

// after
webServer: [
  {
    command: 'node D:/projects/sandbox/stryker-playwright-runner/oss/realworld-api/server.ts',
    url: 'http://localhost:3100/api/tags',
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: '3100',
      // optional: keep users and tokens across web-server restarts
      STATE_FILE: 'D:/projects/sandbox/stryker-playwright-runner/oss/realworld-api/state.json',
    },
  },
  {
    command: 'npx nx run frontend:serve-static',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env.CI,
    cwd: workspaceRoot,
  },
],
```

The `setup` project registers a random user through the API and saves its cookie to `playwright/.auth/user.json`; with `STATE_FILE`
set, that user and cookie stay valid if the API process restarts. `serve-static` serves a built app, so rebuild the frontend
after changing the environment files.
