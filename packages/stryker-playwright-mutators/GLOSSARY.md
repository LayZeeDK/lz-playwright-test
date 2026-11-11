# Playwright mutators

Mutators that change Playwright test code instead of the app, so that a surviving mutant shows a test line that does
not affect what the test checks, or a missing assertion. Install, tier and built-in mutator terms belong to the
Mutator install context.

## Language

### What gets mutated

**Test code**:
The Playwright spec files, page objects and fixtures that a test-code configuration mutates.
_Avoid_: spec code, test files (too narrow)

**App code**:
The code of the app or library that the tests run against; this package's mutators never target it, and a
test-code configuration leaves it out of `mutate`.
_Avoid_: production code, source code

**Test-code configuration**:
A Stryker config whose `mutate` holds only test code and that installs these mutators, kept apart from the
configuration that mutates app code.
_Avoid_: test config, spec config

**LzPlaywright mutator**:
One of this package's mutators, named `LzPlaywright` plus what it changes, such as `LzPlaywrightClickAction`.
_Avoid_: Playwright operator, test mutator

### Mutator families

**Action mutator**:
A mutator that removes an awaited user action, navigation or API request: `LzPlaywrightClickAction`,
`LzPlaywrightInputAction`, `LzPlaywrightFocusAction` or `LzPlaywrightNavigationAction`.
_Avoid_: interaction mutator

**Wait mutator**:
A mutator that removes an awaited wait: `LzPlaywrightSleepWait`, `LzPlaywrightStateWait` or
`LzPlaywrightNetworkWait`.
_Avoid_: timing mutator

**Clock mutator**:
`LzPlaywrightClock`, the mutator that removes an awaited `clock.runFor` or `clock.fastForward`.
_Avoid_: timer mutator

**Mount mutator**:
`LzPlaywrightMountStory`, the mutator that swaps the story id a `mount(...)` call names for another story id that
the same file mounts.
_Avoid_: story mutator

**Locator mutator**:
A mutator that swaps a locator's value for another value in the same file: `LzPlaywrightTestIdLocator`,
`LzPlaywrightRoleLocator` or `LzPlaywrightTextLocator`.
_Avoid_: selector mutator

**Route mock mutator**:
A mutator that changes what a route handler does with a request: `LzPlaywrightFulfill` changes a mocked response,
`LzPlaywrightRouteOutcome` turns an abort into a continue and back.
_Avoid_: network mock mutator

**Request mutator**:
A mutator that changes an API request a test sends: `LzPlaywrightRequestData` changes its payload,
`LzPlaywrightRequestUrl` empties its URL.
_Avoid_: API mutator

### How mutants are made

**Statement removal**:
A mutant that removes one awaited call that stands alone as a statement, such as `await page.goto('/');`; a call
whose result the test uses makes none.
_Avoid_: deletion, statement drop

**Same-file swap**:
A mutant that replaces a literal with the nearest distinct value of the same kind before or after it in the same
file, so each swap site gets at most two.
_Avoid_: replacement, substitution

**Swap site**:
A literal that a same-file swap may replace, together with what tells it apart from another literal of the same
kind, such as a role's name or a mounted story id.
_Avoid_: site (alone), target, candidate

**Teardown**:
The code an Action, Wait or Clock mutator skips: `test.afterEach` and `test.afterAll` bodies, and the code after
`await use(...)` in a fixture.
_Avoid_: cleanup

### Playwright shapes the mutators read

**Navigation fixture**:
A fixture whose awaited call `LzPlaywrightNavigationAction` removes like a `goto`; the `navigationFixtures` setting
names them, `navigate` by default.
_Avoid_: navigation helper

**Route handler**:
The function passed as the second argument of `<x>.route(url, handler)`, or a function whose first parameter is typed
`Route`.
_Avoid_: route callback, interceptor

**API request**:
A `delete`, `fetch`, `get`, `head`, `patch`, `post` or `put` call on a request context: the `request` fixture or
another parameter named `request`, `<x>.request`, or, for `LzPlaywrightRequestUrl`, a context from
`request.newContext()`.
_Avoid_: HTTP call, fetch

**Payload**:
The `data`, `form` or `params` object of an API request's options.
_Avoid_: body, request data

**Story id**:
The literal path, such as `Button/Primary`, that a test passes to `mount(...)` to name a story; two ids where one is
a path suffix of the other name the same story. It is not Storybook's kebab-case story id.
_Avoid_: story name, component id

**Serialized callback**:
A function passed directly to `evaluate`, `evaluateHandle`, `evaluateAll`, `$eval`, `$$eval`, `addInitScript` or
`waitForFunction`, which Playwright sends as source text to run in another realm; the `lz-playwright-serialized`
ignorer reports its mutants as Ignored.
_Avoid_: browser callback, page function
