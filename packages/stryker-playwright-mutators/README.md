# @layzee/stryker-playwright-mutators

StrykerJS mutators for Playwright test code. Mutation testing usually changes the app and checks that a test fails.
These mutators change the tests instead: they remove an action, swap a locator for another one in the same file, or
change what a route mock returns. When the suite still passes, a line of the test does not affect what the test
checks, or an assertion is missing. Run the mutants with `@layzee/stryker-playwright-runner`.

The package turns Stryker's 17 built-in mutators off and adds 16 of its own: 9 run by default, 5 are opt-in and 2
are experimental. The package is private and not on npm yet.

## Requirements

- `@stryker-mutator/core` 10.1, tested on 10.1.1. The install patches internals of that version's instrumenter, and
  warns when `@stryker-mutator/instrumenter` is a version other than 10.1.1.
- Node.js 22 or later.

## Turn the mutators on

The package turns Stryker's built-in mutators off for every file in the run, production files included. Give it a
Stryker configuration whose `mutate` holds only Playwright test code: spec files, page objects and fixtures. Mutate
production code in a separate configuration.

A run in which no file makes a valid mutant exits 0 under every `thresholds.break`, 100 included. A threshold on
this configuration proves something only when the report shows mutants in the spec files.

When a file in `mutate` has no `@playwright/` import and no top-level `test(...)` call, the run prints one warning
for that file and goes on.

Call `lzPlaywrightMutators` at the top of the Stryker configuration file and await it:

```ts
// stryker.test-code.config.mjs
import { lzPlaywrightMutators } from '@layzee/stryker-playwright-mutators';

await lzPlaywrightMutators();

export default {
  mutate: ['e2e/**/*.spec.ts', 'e2e/pages/**/*.ts', 'e2e/fixtures.ts'],
  appendPlugins: ['@layzee/stryker-playwright-runner'],
  testRunner: 'lz-playwright',
};
```

Await the call, so that an error in the install stops the run. The configuration file must be a JavaScript or
TypeScript ES module, because a JSON configuration cannot import a module. Listing the package in `plugins` or
`appendPlugins` does not install the mutators; only the call does.

The call prints one line:

```text
@layzee/stryker-playwright-mutators: Stryker's 17 built-in mutators are off for every file in this run; 9 LzPlaywright mutators on.
```

The call checks that each mutator it installs makes a mutant of a sample, and that no built-in mutator makes one. It
stops the run when either check fails, and names the instrumenter's folder and version when an internal it patches
is missing. A second call replaces the mutators and settings of the first.

### Choose the opt-in and experimental mutators

The first argument turns on mutators beyond the default tier. Each key takes only `true`:

```ts
// Every opt-in mutator.
await lzPlaywrightMutators({ extended: true });

// One opt-in mutator, and one experimental mutator.
await lzPlaywrightMutators({
  LzPlaywrightSleepWait: true,
  experimental: { LzPlaywrightRequestUrl: true },
});

// Every experimental mutator.
await lzPlaywrightMutators({ experimental: true });
```

- `extended: true` turns on every opt-in mutator.
- `<opt-in name>: true` turns on one opt-in mutator.
- `experimental: true` turns on every experimental mutator.
- `experimental: { <experimental name>: true }` turns on one experimental mutator.

With opt-in or experimental mutators on, the line names them:

```text
@layzee/stryker-playwright-mutators: Stryker's 17 built-in mutators are off for every file in this run; 11 LzPlaywright mutators on. Opt-in or experimental: LzPlaywrightSleepWait, LzPlaywrightRequestUrl.
```

The call throws, with a message that starts with the package name, on an unknown key, on a value other than `true`,
on the name of a default mutator, on an opt-in name inside `experimental`, and on an experimental name outside it.
For example:

```text
@layzee/stryker-playwright-mutators: no opt-in mutator is named LzPlaywrightRequestUrl; it is experimental, so it goes inside experimental.
```

The options turn mutators on, never off. To turn one off, see [Turn a mutator off](#turn-a-mutator-off).

### Name your navigation fixtures

The second argument holds settings. `navigationFixtures` lists the fixture names whose awaited calls
`LzPlaywrightNavigationAction` removes. It replaces the default list, `['navigate']`:

```ts
await lzPlaywrightMutators({}, { navigationFixtures: ['navigate', 'visit'] });
```

The call throws when the settings are not an object, when they hold a key other than `navigationFixtures`, or when
`navigationFixtures` is not an array of identifier names.

## The mutators

Each mutator's name is the mutator name in Stryker's reports. A statement removal applies only to an awaited call
that stands alone as a statement, such as `await page.goto('/');`. A call whose result the test uses, such as
`const response = await request.get('/a');`, makes no removal mutant.

### Default mutators

These run on `await lzPlaywrightMutators()`.

| Mutator                        | What it changes                                                                                                                                                                                                                                                                                                                    | Example                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `LzPlaywrightClickAction`      | Removes an awaited `click`, `dblclick`, `tap`, `dragTo`, `dispatchEvent` or `dragAndDrop` statement.                                                                                                                                                                                                                               | `await page.getByRole('button').click();` is removed.                                      |
| `LzPlaywrightInputAction`      | Removes an awaited `fill`, `clear`, `press`, `pressSequentially`, `type`, `selectOption`, `selectText`, `setInputFiles`, `drop`, `check`, `uncheck` or `setChecked` statement, and an awaited API request (`delete`, `fetch`, `get`, `head`, `patch`, `post`, `put` on `request` or `<x>.request`) whose result the test discards. | `await page.getByLabel('Name').fill('Ada');` is removed.                                   |
| `LzPlaywrightFocusAction`      | Removes an awaited `focus`, `blur` or `hover` statement.                                                                                                                                                                                                                                                                           | `await page.getByRole('link').hover();` is removed.                                        |
| `LzPlaywrightNavigationAction` | Removes an awaited `goto`, `reload`, `goBack` or `goForward` statement, and an awaited call to a navigation fixture that a test, hook or fixture takes from its fixtures, also inside `test.step`.                                                                                                                                 | `await navigate('/cart');` is removed.                                                     |
| `LzPlaywrightTestIdLocator`    | Replaces the argument of `getByTestId` with another test id that the same file passes to `getByTestId`.                                                                                                                                                                                                                            | `getByTestId('badge')` becomes `getByTestId('total')`.                                     |
| `LzPlaywrightRoleLocator`      | Replaces the `name` of `getByRole(role, { name })` with another name that the same file gives the same role.                                                                                                                                                                                                                       | `getByRole('button', { name: 'Save' })` becomes `getByRole('button', { name: 'Cancel' })`. |
| `LzPlaywrightTextLocator`      | Replaces the first argument of `getByText`, `getByLabel`, `getByPlaceholder`, `getByAltText` or `getByTitle` with another value that the same file passes to the same method.                                                                                                                                                      | `getByLabel('Email')` becomes `getByLabel('Password')`.                                    |
| `LzPlaywrightFulfill`          | Empties the `json` or `body` of `route.fulfill({ ... })`, and turns a literal `status` from 200-399 into 500 and from 400-599 into 200.                                                                                                                                                                                            | `json: { items: [1] }` becomes `json: {}`; `status: 404` becomes `status: 200`.            |
| `LzPlaywrightRouteOutcome`     | In a route handler, turns `route.abort(...)` into `route.continue()`, and `route.continue(...)` or `route.fallback(...)` into `route.abort()`.                                                                                                                                                                                     | `await route.abort();` becomes `await route.continue();`.                                  |

The four Action mutators skip teardown: `test.afterEach` and `test.afterAll` bodies, and the code after
`await use(...)` in a fixture. The API request removals of `LzPlaywrightInputAction` also skip `test.beforeEach` and
`test.beforeAll` bodies and `finally` blocks, where a request usually prepares or cleans up data.

The Locator mutators replace a value with the nearest distinct value before it and the nearest after it in the
file, so a site gets at most two mutants. They change locators in assertions too, such as
`expect(page.getByTestId('badge'))`, and leave options such as `exact` as they are.

### Opt-in mutators

These run with `extended: true`, or each with its own name set to `true`.

| Mutator                   | What it changes                                                                                                   | Example                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `LzPlaywrightSleepWait`   | Removes an awaited `waitForTimeout` statement.                                                                    | `await page.waitForTimeout(500);` is removed.                 |
| `LzPlaywrightStateWait`   | Removes an awaited `waitForLoadState`, `waitForURL`, `waitFor`, `waitForSelector` or `waitForFunction` statement. | `await page.waitForURL('/cart');` is removed.                 |
| `LzPlaywrightNetworkWait` | Removes an awaited `waitForResponse` or `waitForRequest` statement.                                               | `await page.waitForResponse('**/api/cart');` is removed.      |
| `LzPlaywrightClock`       | Removes an awaited `runFor` or `fastForward` statement on `clock` or `<x>.clock`.                                 | `await page.clock.runFor(1000);` is removed.                  |
| `LzPlaywrightMountStory`  | Replaces the literal story id of `mount(...)` or `<x>.mount(...)` with another id that the same file mounts.      | `mount('Button/Primary')` becomes `mount('Button/Disabled')`. |

The three Wait mutators and `LzPlaywrightClock` skip teardown, as the Action mutators do.

#### Run the Wait and Clock mutators with failOnFlakyTests

Set `failOnFlakyTests: true` in the Playwright configuration whenever a Wait mutator or `LzPlaywrightClock` is on:

```ts
// playwright.config.ts
export default defineConfig({
  failOnFlakyTests: true,
});
```

It is a Playwright option, and the runner reads it from Playwright's configuration. In the Stryker configuration it
does nothing, and Stryker logs it as an unknown option. Without it, and with `retries` above 0, a test that fails
without the wait and then passes on a retry reports the mutant as Survived.

Read a survivor of these mutators as "not needed in this run". Removing the wait did not change the result this
time, which does not prove that the wait is never needed. Run the mutant again before you delete the line.

### Experimental mutators

These run with `experimental: true`, or each by its name inside `experimental`. They are experimental: each was
measured on few repositories, and its matching rules or its name can still change.

| Mutator                   | What it changes                                                                                                                          | Example                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `LzPlaywrightRequestData` | In the `data`, `form` or `params` object of an API request, at any depth, adds `x` to a string, adds 1 to a number, and flips a boolean. | `data: { title: 'Dune' }` becomes `data: { title: 'Dunex' }`. |
| `LzPlaywrightRequestUrl`  | Empties the URL of a `get`, `head` or `fetch` API request whose result the test reads.                                                   | `request.get('/api/health')` becomes `request.get('')`.       |

`LzPlaywrightRequestUrl` also empties each URL in the array of a `for (const url of [...])` loop whose variable is
the URL of such a request.

## Why Stryker's built-in mutators are off

Stryker's built-in mutators target production code. StrykerJS tells you not to mutate tests: its `mutate` option
"should be your _production code files_, and definitely not your test files"
([`docs/configuration.md`](https://github.com/stryker-mutator/stryker-js/blob/v10.1.1/docs/configuration.md#mutate-string)).
Its maintainer, nicojs, said the same in
[stryker-js#928](https://github.com/stryker-mutator/stryker-js/issues/928), where emptied test titles survived and
the fix was a default `mutate` that leaves test files out, and in
[stryker-js#3304](https://github.com/stryker-mutator/stryker-js/issues/3304#issuecomment-989547696): "You shouldn't
be mutating your test code." The owner of PIT, hcoles, wrote "Pitest should not be mutating tests." in
[pitest#1117](https://github.com/hcoles/pitest/issues/1117).

This package mutates test code on purpose, so it decided each built-in mutator on its own, from what its mutants did
in Playwright e2e, component and API tests. None of the 17 stays on in test code. The reasons:

| Built-in mutator        | Why it is off in test code                                                                                                                                            | Replaced by                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ArithmeticOperator`    | The analysed suites had two sites, both boundary data, and no rule tells boundary data from expected values.                                                          | -                                                                                                                                  |
| `ArrayDeclaration`      | `Promise.race([])` never settles, so the mutant times out; an emptied loop list makes the loop pass.                                                                  | -                                                                                                                                  |
| `ArrowFunction`         | An emptied callback never resolves or leaves a dialog open: killed, mostly after the full timeout.                                                                    | -                                                                                                                                  |
| `AssignmentOperator`    | Spec files had no sites; the `??=` sites in fixtures break setup, so they die whenever the line runs.                                                                 | -                                                                                                                                  |
| `BlockStatement`        | An emptied test body always survives (10 of 10 measured); emptied hooks time out or survive.                                                                          | The Action mutators, one statement at a time                                                                                       |
| `BooleanLiteral`        | `exact: true` to `false` only loosens a locator; setup flags die whenever the line runs.                                                                              | The Locator mutators                                                                                                               |
| `CallExpression`        | It removes `expect(...)` calls and `test(...)` registrations, so the test passes by construction.                                                                     | -                                                                                                                                  |
| `ConditionalExpression` | Its sites are console filters and guards: changes no test can see, or mutants that die whenever the line runs.                                                        | -                                                                                                                                  |
| `EqualityOperator`      | The same sites as `ConditionalExpression`, with the same results.                                                                                                     | -                                                                                                                                  |
| `LogicalOperator`       | `name \|\| username` in a locator name dies whenever the line runs.                                                                                                   | -                                                                                                                                  |
| `MethodExpression`      | Case changes on expected values die whenever the line runs; removing `.filter()` loosens a locator.                                                                   | -                                                                                                                                  |
| `ObjectLiteral`         | `{ name, level }` to `{}` loosens a locator (4 of 4 measured survivors were equivalent); emptied test data breaks setup.                                              | `LzPlaywrightRoleLocator`; `LzPlaywrightFulfill` for mocked bodies                                                                 |
| `OptionalChaining`      | A passing test never takes the `null` path, so the mutant is equivalent.                                                                                              | -                                                                                                                                  |
| `Regex`                 | Locator-name regexes only get looser; extraction regexes die whenever the line runs.                                                                                  | The Locator mutators                                                                                                               |
| `StringLiteral`         | Emptied titles always survive (10 of 10 measured); `''` matches every locator name; an emptied role throws whenever the line runs; messages never change the outcome. | The Locator mutators, `LzPlaywrightNavigationAction`, `LzPlaywrightInputAction`, `LzPlaywrightStateWait`, `LzPlaywrightRequestUrl` |
| `UnaryOperator`         | Spec files had no sites.                                                                                                                                              | -                                                                                                                                  |
| `UpdateOperator`        | Spec files had no sites.                                                                                                                                              | -                                                                                                                                  |

A mutant that dies whenever its line runs is killed by every test that reaches the line, so it shows only that the
line runs, not what the test checks. It costs run time and finds nothing.

The install removes the built-ins by name. Mutators from other packages, such as `@layzee/stryker-jsx-mutators`, stay
on. When the instrumenter holds a mutator that is neither one of the 17 nor from a `@layzee` package, the install
warns that it stays on and that this package has not reviewed it.

## Hide browser callbacks with lz-playwright-serialized

Playwright sends some functions to another realm as source text: a browser page, a worker, a service worker or an
Electron process. A mutant inside such a function carries Stryker's helper calls along, which do not exist there, so
the function throws a `ReferenceError` and the mutant counts as killed whatever the test checks.
`@layzee/stryker-playwright-runner` defines the helpers in pages, so `page.evaluate` callbacks work there. Workers,
service workers and Electron get no helpers.

The opt-in `lz-playwright-serialized` ignorer reports the mutants of such functions as Ignored, with a reason such
as "lz-playwright-serialized: Playwright's evaluate runs this function's source text where Stryker's helpers do not
exist". Ignored mutants stay in the report and are left out of the score.

List the package in `appendPlugins`, then the ignorer:

```ts
appendPlugins: ['@layzee/stryker-playwright-runner', '@layzee/stryker-playwright-mutators'],
ignorers: ['lz-playwright-serialized'],
```

Listing the package loads the ignorer and installs no mutator. The `lzPlaywrightMutators` call still turns the
mutators on.

The ignorer hides every mutant inside a function or arrow function passed directly as an argument to `evaluate`,
`evaluateHandle`, `evaluateAll`, `$eval`, `$$eval`, `addInitScript` or `waitForFunction`, on any receiver. A function
nested in such a callback is hidden with it.

It matches the method name only, so it also hides `page.evaluate` callbacks, which the runner could run.

What it misses:

- A function passed by variable, such as `worker.evaluate(readCount)`.
- A function wrapped in a cast, such as `worker.evaluate((() => 1) as Fn)`.

Their mutants still carry Stryker's helpers to the other realm and count as killed by the `ReferenceError`.

## Turn a mutator off

For the whole run, list the mutator in `mutator.excludedMutations`. The names are case sensitive, and Stryker does
not check them, so a misspelt name excludes nothing and logs nothing. Stryker still reports an excluded mutant, as
Ignored.

For one mutant, put a Stryker disable comment with a reason on the line before the statement:

```ts
// Stryker disable next-line LzPlaywrightSleepWait: the chart animates for 300 ms and has no settled state to wait for
await page.waitForTimeout(300);
```

A removal mutant sits on the whole statement and a swap or Fulfill mutant on its value, so `next-line` before the
line that holds the statement or value covers it. For a block, use `// Stryker disable <name>: <reason>` and
`// Stryker restore <name>`.

A disable comment that names a mutator not on in this run, such as a built-in or an opt-in mutator left off, draws
Stryker's "Unused 'Stryker disable' directive" warning, and the run goes on.

## Survivors to expect and limits

These mutants survive or are missed by design. Each entry says what to do with it.

### All mutators

- A file given with a line range in `mutate`, such as `e2e/cart.spec.ts:10-20`, gets no warning when it does not look
  like Playwright test code: Stryker never shows the mutators the whole file. The Locator mutators still find their
  replacements in the whole file.

### The Action mutators

- A call on `keyboard`, `mouse` or `touchscreen`, such as `await page.keyboard.press('Enter');` or
  `await page.mouse.click(10, 20);`, makes no mutant, and neither does a call on Vitest's `vi` or Jest's `jest`.
- The mutators match the method name, not the type of what it is called on: an awaited `db.clear()` or
  `userEvent.click(el)` in a test file is removed like a Playwright call. Disable such a mutant with a comment, or keep
  helpers like these out of `mutate`.
- A click right before a `fill` on the same element, or a value written and overwritten before any assertion, can
  survive. The survivor shows a line that the test does not need.
- A removed `goto` or click makes the next action wait for an element that never appears. Without
  `use.actionTimeout`, it waits out the test timeout and counts as a Timeout. See
  [Set a short actionTimeout](#set-a-short-actiontimeout).

### The Wait mutators and LzPlaywrightClock

- A survivor means "not needed in this run". Run with `failOnFlakyTests: true`, as
  [above](#run-the-wait-and-clock-mutators-with-failonflakytests).
- A `waitFor` call on Vitest's `vi` or Jest's `jest` makes no mutant, since those share Playwright's method name.

### The Locator mutators

- Only string literals, template literals without expressions, and regex literals are sites and replacements. A
  value held in a variable, or a template with an expression, gets no mutant.
- A string and a regex never count as equal, so `getByText('Save')` and `getByText(/Save/)` replace each other.
- A file with one distinct value for a method, or for a role, gets no mutant for it.

### LzPlaywrightFulfill

- `status` gets a mutant only as a numeric literal from 200 to 599. A string or an expression gets none.
- A fulfill with a `response` option gets no mutant at all, its `status` included.
- A `json` value that is not a literal, such as a variable or a number, becomes `{}`.

### LzPlaywrightRouteOutcome

- It finds a handler passed inline to `<x>.route(url, handler)`, or a function whose first parameter is typed
  `Route`. A handler held in a variable whose parameter has no `Route` type gets no mutant.
- It treats any `<x>.route(url, callback)` as a Playwright route, an Express-style `app.route` included. The
  per-file warning names a file that does not look like Playwright test code.
- A `'**/*'` guard handler that only lets your own origin through survives when every test is hermetic. Leave it
  with a disable comment, or test that a third-party request is blocked.

### LzPlaywrightMountStory

- Ids where one is a path suffix of the other, such as `Button/Primary` and `components/Button/Primary`, name the
  same story and never replace each other.
- A regex id is no site.
- A swapped story often renders without the element the test waits for, so the mutant waits out the test timeout.
  See [Set a short actionTimeout](#set-a-short-actiontimeout).

### LzPlaywrightRequestData

- It follows only `request` and `<x>.request`. A context from `request.newContext()` gets no mutant, although
  `LzPlaywrightRequestUrl` follows one.
- It never empties a value or drops a key. Identifiers, raw string bodies and negative numbers get no mutant.
- Values that set up data or pick a page, such as a page size, often survive. Leave them with a disable comment.

### LzPlaywrightRequestUrl

- Only `get`, `head`, and `fetch` without a `method` option get a mutant. A `fetch` with any `method` option, even
  `method: 'GET'`, or with options given as a variable or with a spread, gets none.
- An absolute URL to a host other than `localhost`, `127.0.0.1`, `0.0.0.0` or `[::1]` gets no mutant. Other forms
  of the local address, such as `127.0.0.2`, `[::ffff:127.0.0.1]`, `[0:0:0:0:0:0:0:1]` or `[::]`, count as other
  hosts.
- An emptied URL requests the root of the base URL. A dev server that renders its root cold on the first request
  can make the request time out, and that kills the mutant even when no check would have. Warm the server before
  the run, or rerun such a kill before you trust it.
- A survivor means the test's checks also pass on the root's response, such as a status-only `toBeOK()`.
- A result that the test stores and never reads gets no mutant, but one wrapped in a type assertion, such as
  `(await request.get('/a')) as Health`, still does.

## Set a short actionTimeout

Removing an action or swapping a story often leaves the next action waiting for an element that never appears.
Playwright's default `actionTimeout` is none, so the action waits out the whole test timeout, and the mutant counts
as a Timeout instead of Killed and costs that time. Set `use.actionTimeout` low in the Playwright configuration
that the test-code Stryker run uses, and below the test timeout:

```ts
// playwright.config.ts
export default defineConfig({
  use: { actionTimeout: 5000 },
});
```

The runner's README measures the effect under
[Faster killed mutants](../stryker-playwright-runner/README.md#faster-killed-mutants).

## License

MIT
