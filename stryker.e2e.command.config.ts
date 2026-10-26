import type { PartialStrykerOptions } from '@stryker-mutator/api/core';

// Baseline: Stryker's command runner. STRYKER_BASELINE=define activates mutants through a Vite define
// (the stryker-playwright-hello-world pattern); without it nothing reaches the browser.
const define = process.env.STRYKER_BASELINE === 'define';

export default {
  testRunner: 'command',
  commandRunner: {
    command:
      'npx playwright test -c apps/demo-app-e2e/playwright.config.mts --retries=0 --workers=1 -x --reporter=dot',
  },
  mutate: ['apps/demo-app/src/app/cart.ts'],
  coverageAnalysis: 'off',
  concurrency: 1,
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: {
    fileName: `reports/e2e-command-${define ? 'define' : 'off'}/mutation.json`,
  },
  tempDirName: '.stryker-tmp',
} satisfies PartialStrykerOptions;
