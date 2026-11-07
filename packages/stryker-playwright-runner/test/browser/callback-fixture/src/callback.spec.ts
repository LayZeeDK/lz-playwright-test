import { expect, test } from '@playwright/test';

test('doubles in the page', async ({ page }) => {
  expect(await page.evaluate(() => 21 * 2)).toBe(42);
});
