# Filing ledger

Drafts of upstream issues found while validating the runner. Lars files from here when he chooses;
nothing in this file has been filed.

## stefanoslig/angular-ngrx-nx-realworld-example-app: "View article's author" e2e test always fails

Status: draft, not filed (2026-10-25).

**Versions.** Commit bc7158d (2026-05-09, "chore: migrate to the latest version of nx"),
Playwright 1.64.1, Chromium, Windows 11 arm64, Node 24.22.0. The backend was this repo's local
RealWorld API double (`oss/realworld-api/server.ts`), not the public API.

**Reproduction.**

1. Start the app and a RealWorld backend, then run
   `npx playwright test -c apps/conduit-e2e/playwright.config.ts --project=chromium`.
2. `article-list.spec.ts:19` "View article's author" fails; the other 6 tests pass.

```
Error: expect(locator).toHaveText(expected) failed
Locator:  getByTestId('article-author-profile')
Expected: ""
Received: " anne "
```

**What the test does.** It reads `textContent()` of the first `getByTestId('article-author')`, clicks
it, and expects the profile heading to have that text. In
`libs/articles/feature-article/src/article-meta/article-meta.component.html` that test id is on the
link that holds only the avatar (`<cdt-avatar>`, an `<img>` before 7659b69), so its text is empty or the
avatar's initials, never the username. The `a.author` link next to it holds the username.

**Possible fix.** Read the name from the `a.author` link, or move `data-testid="article-author"` to it.

**Evidence.** The failure without Stryker: the plain Playwright run above, 2026-10-25, 1 failed and 6
passed. The same failure in a Stryker dry run is in a log that later runs overwrote, so the plain
Playwright run above is the reproduction to rely on.

**Same suite: `auth.spec.ts` fails on one worker.** The spec makes `userId` once at module level and
registers it in `test.beforeEach`, so the second test in a worker registers the same user again and
fails with `{"errors":{"email":["has already been taken"],...}}`. Reproduce with `--workers=1`
(2026-10-25: 1 failed, 1 skipped, 5 passed). With several workers each test can land in its own worker,
which hides it. Possible fix: register in `test.beforeAll`, or make the id per test.

**Also noticed.** `apps/conduit-e2e/playwright.config.ts` starts `npx nx run frontend:serve-static`,
but the workspace has no `frontend` project (`nx show project frontend`: "Could not find project
frontend"), so the suite works only next to a dev server someone already started on port 4200.
