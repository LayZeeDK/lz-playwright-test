import type { Case } from './cases.ts';

const sleep = 'LzPlaywrightSleepWait';
const state = 'LzPlaywrightStateWait';
const network = 'LzPlaywrightNetworkWait';

function inTest(statement: string): string {
  return `test('case', async ({ page }) => {\n  ${statement}\n});`;
}

// [id, mutator, awaited call]
const removedWaits: readonly (readonly [string, string, string])[] = [
  ['waitForTimeout-page', sleep, 'page.waitForTimeout(100)'],
  ['waitForLoadState-page', state, 'page.waitForLoadState()'],
  ['waitForURL-page', state, "page.waitForURL('/a')"],
  ['waitFor-locator', state, "page.locator('#a').waitFor()"],
  ['waitForSelector-page', state, "page.waitForSelector('#a')"],
  ['waitForFunction-page', state, 'page.waitForFunction(() => true)'],
  ['waitForResponse-page', network, "page.waitForResponse('/api')"],
  ['waitForRequest-page', network, "page.waitForRequest('/api')"],
];

export const waitCases: readonly Case[] = [
  ...removedWaits.map(
    ([id, mutator, call]): Case => ({
      id,
      title: `an awaited ${call} is removed`,
      source: inTest(`await ${call};`),
      expect: [[mutator, ';']],
    }),
  ),
  ...removedWaits.map(
    ([id, , call]): Case => ({
      id: `${id}-afterEach`,
      title: `an awaited ${call} in test.afterEach makes no mutant`,
      source: `test.afterEach(async ({ page }) => {\n  await ${call};\n});`,
      expect: [],
    }),
  ),
  {
    id: 'waitForResponse-result-used',
    title: 'a waitForResponse whose result is assigned makes no mutant',
    source: inTest(
      "const response = await page.waitForResponse('/api');\n\n  expect(response.ok()).toBe(true);",
    ),
    expect: [],
  },
];
