import type {
  MutatorOptions,
  MutatorSets,
  SampledMutator,
} from '@layzee/stryker-mutator-install';

import type { BabelTypes } from './install.ts';
import { fulfillMutator } from './route-mocks.ts';
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
    fulfillMutator(
      'LzPlaywrightFulfill',
      sampleOf(
        "await page.route('**/api', (route) => route.fulfill({ json: { a: 1 } }));",
      ),
    ),
  ],
  optIn: [],
  experimental: [],
});

type NamesIn<TTier extends readonly SampledMutator[]> = TTier[number]['name'];

export type LzPlaywrightMutatorOptions = MutatorOptions<
  NamesIn<(typeof mutatorSets)['optIn']>,
  NamesIn<(typeof mutatorSets)['experimental']>
>;
