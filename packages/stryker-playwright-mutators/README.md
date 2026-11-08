# @layzee/stryker-playwright-mutators

StrykerJS mutators for Playwright test code. The package is private and not finished: it removes Stryker's 17
built-in mutators for every file in a run and installs its own mutators, and it has none yet.

```ts
// stryker.test-code.config.mjs
import { lzPlaywrightMutators } from '@layzee/stryker-playwright-mutators';

await lzPlaywrightMutators();
```

Await the call in the Stryker configuration file, so that an error stops the run.

A second call replaces the mutators of the first. The call prints one line:

```text
@layzee/stryker-playwright-mutators: Stryker's 17 built-in mutators are off for every file in this run; 0 LzPlaywright mutators on.
```

## Requirements

- `@stryker-mutator/core` 10.1, tested on 10.1.1. The call warns when it finds another version.
- Node.js 22 or later.
