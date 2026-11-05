import { expect, test } from '@playwright/test';

test('joins in the page', async ({ page }) => {
  const joined = await page.evaluate(() => {
    const parts = ['ab', 'c'];

    return parts.join('-');
  });

  expect(joined).toBe('ab-c');
});
