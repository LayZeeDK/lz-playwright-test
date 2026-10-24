import { expect, test } from '@playwright/test';

test('navigates to the about page and back', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'About' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('About');

  await page.getByRole('link', { name: 'Back to cart' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cart');
});
