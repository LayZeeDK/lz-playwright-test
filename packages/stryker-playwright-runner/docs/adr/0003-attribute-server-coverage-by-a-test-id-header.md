# Attribute server coverage by a test id header, with arrival time as the fallback

In the `perTest` dry run the runner adds an `x-lz-stryker-test` header with the running test's id to the requests a
test sends to the `webServer`, and the server hook counts the code a request runs for that test. The hook passes the
id on when the server sends a request to its own host and port, and accepts only ids the runner listed at startup. A
request without the header, such as one from global setup, a `beforeAll` hook or a service worker, counts for every
test that runs when it arrives, or as reached outside any test when none does.

## Considered Options

- Count every request without the header as reached outside any test. Stryker would then run every test for each
  mutant such a request reaches, and the runner would restart the `webServer` for it. Measured, that took
  3.6 times as long and killed no extra mutant, so the arrival-time fallback stays even though it can credit a
  mutant to tests that did not send the request.
