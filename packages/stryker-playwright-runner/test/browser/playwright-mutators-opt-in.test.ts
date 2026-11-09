import { fileURLToPath } from 'node:url';

import { playwrightMutatorRows } from './support/mutants.ts';

const fixture = (file: string) =>
  fileURLToPath(
    new URL(`./playwright-mutators-fixture/${file}`, import.meta.url),
  );

playwrightMutatorRows(
  {
    spec: fixture('src/waits.spec.ts'),
    testDir: fixture('opt-in/public'),
    configFile: fixture('opt-in.config.ts'),
    testCount: 5,
    options: { extended: true },
  },
  [
    {
      mutator: 'LzPlaywrightSleepWait',
      original: 'await page.waitForTimeout(2_000);',
      replacement: ';',
      killer: 'is ready after a sleep',
      bystander: 'shows the heading',
    },
    {
      mutator: 'LzPlaywrightStateWait',
      original: 'await page.waitForFunction(\'document.title === "Done"\');',
      replacement: ';',
      killer: 'titles the page when done',
      bystander: 'shows the heading',
    },
    {
      mutator: 'LzPlaywrightNetworkWait',
      original: "await page.waitForResponse('**/api/visit');",
      replacement: ';',
      killer: 'records a visit',
      bystander: 'shows the heading',
    },
    {
      mutator: 'LzPlaywrightClock',
      original: 'await page.clock.runFor(5_000);',
      replacement: ';',
      killer: 'expires the offer on the clock',
      bystander: 'shows the heading',
    },
  ],
);
