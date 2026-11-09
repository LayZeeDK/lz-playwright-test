import type {
  MutatorOptions,
  MutatorSets,
  SampledMutator,
} from '@layzee/stryker-mutator-install';

import type { BabelTypes } from './install.ts';
import {
  roleSite,
  swapMutator,
  testIdSite,
  textSite,
} from './same-file-swap.ts';
import { removalMutator } from './statement-removal.ts';

export interface LzPlaywrightMutator extends SampledMutator {
  mutate(path: unknown, t: BabelTypes): Iterable<unknown>;
}

function sampleOf(statement: string): string {
  return `test('a', async ({ page }) => {\n  ${statement}\n});\n`;
}

// In place of `as const`: Stryker mutates nothing inside an `as` expression, which would leave the roster out of a
// mutation run. The literal names are what the option type reads.
function roster<const T extends MutatorSets<LzPlaywrightMutator>>(sets: T): T {
  return sets;
}

export const mutatorSets = roster({
  defaults: [
    removalMutator(
      'LzPlaywrightClickAction',
      sampleOf("await page.locator('#a').click();"),
    ),
    removalMutator(
      'LzPlaywrightInputAction',
      sampleOf("await page.locator('#a').fill('x');"),
    ),
    removalMutator(
      'LzPlaywrightFocusAction',
      sampleOf("await page.locator('#a').hover();"),
    ),
    removalMutator(
      'LzPlaywrightNavigationAction',
      sampleOf("await page.goto('/');"),
    ),
    swapMutator(
      'LzPlaywrightTestIdLocator',
      sampleOf("page.getByTestId('a');\n  page.getByTestId('b');"),
      testIdSite,
    ),
    swapMutator(
      'LzPlaywrightRoleLocator',
      sampleOf(
        "page.getByRole('button', { name: 'a' });\n  page.getByRole('button', { name: 'b' });",
      ),
      roleSite,
    ),
    swapMutator(
      'LzPlaywrightTextLocator',
      sampleOf("page.getByText('a');\n  page.getByText('b');"),
      textSite,
    ),
  ],
  optIn: [
    removalMutator(
      'LzPlaywrightSleepWait',
      sampleOf('await page.waitForTimeout(100);'),
    ),
    removalMutator(
      'LzPlaywrightStateWait',
      sampleOf('await page.waitForLoadState();'),
    ),
    removalMutator(
      'LzPlaywrightNetworkWait',
      sampleOf("await page.waitForResponse('/a');"),
    ),
  ],
  experimental: [],
});

type NamesIn<TTier extends readonly SampledMutator[]> = TTier[number]['name'];

export type LzPlaywrightMutatorOptions = MutatorOptions<
  NamesIn<(typeof mutatorSets)['optIn']>,
  NamesIn<(typeof mutatorSets)['experimental']>
>;
