import { fileURLToPath } from 'node:url';

import { playwrightMutatorRows } from './support/mutants.ts';

const fixture = (file: string) =>
  fileURLToPath(
    new URL(`./playwright-mutators-fixture/${file}`, import.meta.url),
  );

playwrightMutatorRows(
  {
    spec: fixture('src/app.spec.ts'),
    testDir: fixture('public'),
    configFile: fixture('playwright.config.ts'),
    testCount: 7,
  },
  [
    {
      mutator: 'LzPlaywrightClickAction',
      original: "await page.getByRole('button', { name: 'Add' }).click();",
      replacement: ';',
      killer: 'adds an item',
      bystander: 'greets by name',
    },
    {
      mutator: 'LzPlaywrightInputAction',
      original: "await page.getByLabel('Name').fill('Ada');",
      replacement: ';',
      killer: 'greets by name',
      bystander: 'adds an item',
    },
    {
      mutator: 'LzPlaywrightInputAction',
      original: "await request.post('/api/note', { data: 'kept' });",
      replacement: ';',
      killer: 'stores a note',
      bystander: 'shows the heading',
    },
    {
      mutator: 'LzPlaywrightFocusAction',
      original: "await page.getByText('Help').hover();",
      replacement: ';',
      killer: 'shows the tips on hover',
      bystander: 'adds an item',
    },
    {
      mutator: 'LzPlaywrightNavigationAction',
      original: "await page.goto('/');",
      replacement: ';',
      killer: 'shows the heading',
      bystander: 'stores a note',
    },
    {
      mutator: 'LzPlaywrightTestIdLocator',
      original: "'count'",
      replacement: "'greeting'",
      killer: 'adds an item',
      bystander: 'greets by name',
    },
    {
      mutator: 'LzPlaywrightRoleLocator',
      original: "'Add'",
      replacement: "'Load user'",
      killer: 'adds an item',
      bystander: 'shows the heading',
    },
    {
      mutator: 'LzPlaywrightTextLocator',
      original: "'Help'",
      replacement: "'Tips'",
      killer: 'shows the tips on hover',
      bystander: 'adds an item',
    },
    {
      mutator: 'LzPlaywrightFulfill',
      original: "{ name: 'Grace' }",
      replacement: '{}',
      killer: 'loads the user',
      bystander: 'shows the heading',
    },
    {
      mutator: 'LzPlaywrightRouteOutcome',
      original: 'route.abort()',
      replacement: 'route.continue()',
      killer: 'reports a failed ping as offline',
      bystander: 'loads the user',
    },
  ],
);
