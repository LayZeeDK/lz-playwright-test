import type { Case } from './cases.ts';

const sleep = 'LzPlaywrightSleepWait';
const state = 'LzPlaywrightStateWait';
const network = 'LzPlaywrightNetworkWait';
const clock = 'LzPlaywrightClock';

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
  ['runFor-page-clock', clock, 'page.clock.runFor(1000)'],
  ['fastForward-page-clock', clock, 'page.clock.fastForward(1000)'],
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
    id: 'runFor-destructured-clock',
    title: 'an awaited runFor on a clock destructured from page is removed',
    source: inTest('const { clock } = page;\n\n  await clock.runFor(1000);'),
    expect: [[clock, ';']],
  },
  {
    id: 'runFor-optional-page-clock',
    title: 'an awaited runFor on page?.clock is removed',
    source: inTest('await page?.clock.runFor(1_000);'),
    expect: [[clock, ';']],
  },
  {
    id: 'runFor-other-receiver',
    title: 'an awaited runFor on a receiver that is no clock makes no mutant',
    source: inTest(
      'const timer = { runFor: async (ms: number) => ms };\n\n  await timer.runFor(1000);',
    ),
    expect: [],
  },
  {
    id: 'waitFor-test-runner-globals',
    title: "an awaited waitFor of Vitest's vi or Jest's jest makes no mutant",
    source: inTest(
      'await vi.waitFor(() => true);\n  await jest.waitFor(() => true);',
    ),
    expect: [],
  },
  {
    id: 'waitForResponse-result-used',
    title: 'a waitForResponse whose result is assigned makes no mutant',
    source: inTest(
      "const response = await page.waitForResponse('/api');\n\n  expect(response.ok()).toBe(true);",
    ),
    expect: [],
  },
];
