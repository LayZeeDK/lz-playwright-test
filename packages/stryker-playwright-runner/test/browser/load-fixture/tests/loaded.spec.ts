import { expect, test } from '@playwright/test';

test('loads the app without calling it', async ({ page }) => {
  await page.goto('/loaded.html');

  await expect(page).toHaveTitle('loaded');
});
