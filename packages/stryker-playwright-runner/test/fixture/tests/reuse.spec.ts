import { expect, test } from '@playwright/test';

test('reused context, first test', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('status')).toHaveText('Hello 3');
});

test('reused context, second test', async ({ page }) => {
  await page.goto('/');

  expect(await page.evaluate(() => window.countTo(2))).toBe(2);
});
