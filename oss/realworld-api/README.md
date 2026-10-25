# RealWorld API double

A dependency-free, in-memory RealWorld ("Conduit") backend for the Angular/Nx RealWorld app's Playwright suite, so
mutation runs never touch the third-party Heroku API. Node runs the TypeScript directly (type stripping, erasable syntax only).
`ENDPOINTS.md` lists what is implemented and who calls it.

The server needs Node 24.2 or later. It starts only when `import.meta.main` is true, and older Node versions do not set it,
so `node server.ts` exits at once without listening.

## Run

From the root of this repo:

```sh
node oss/realworld-api/server.ts
```

| Variable | Default | Effect |
|----------|---------|--------|
| `PORT` | `3100` | Listen port. API base is `http://localhost:<PORT>/api`. |
| `STATE_FILE` | unset | Path to a JSON file. When set, state and the token secret are loaded from it on start (seed data if the file does not exist) and the whole state is rewritten after every successful non-GET request (temp file in the same directory, then rename). Users, tokens, articles, comments, favorites and follows survive a restart. Delete the file to reset. Unset: purely in-memory, state resets on every start. |
| `DEBUG` | unset | Log one line per request. |

Check: `node --test oss/realworld-api/server.test.ts`

Use `localhost`, not `127.0.0.1`, everywhere: auth is a `jwt` cookie (the app sends no `Authorization` header), and the cookie is only
shared between the app and `localhost:3100` when both use the same host name.

The double listens on loopback only, answers only requests whose `Host` is a loopback name, refuses any request whose `Origin` is not
an `http://` origin on a loopback name, and grants CORS with credentials only to those origins. The state file holds the token secret
and the seeded passwords. On POSIX it is written with mode 0600; on Windows the mode is ignored and the folder's ACL decides who can
read it. `oss/realworld-api/state.json` is gitignored in this repo.

## Use it from a disposable copy of the app

Run `node oss/realworld/prepare.ts <copy>`. The script makes every change the copy needs and writes its Stryker config.
`oss/README.md` describes the whole procedure. Do not apply these changes to the original clone.

The script points the app and the e2e helpers at this double. It adds the double as the first `webServer`, started with
`node server.ts` from this folder. It sets `STATE_FILE` to `.stryker-api-state.json` in the copy and adds that file to the
copy's `.gitignore`. With `STATE_FILE` set, the user that the `setup` project registers stays valid, with its cookie, if the API
process restarts.
