import { expect, test } from '@playwright/test';

test('the page shows a cart over 50 without shipping', async ({ page }) => {
  await page.goto('/?mugs=3&posters=1');

  await expect(page.getByTestId('total')).toHaveText('56.00 EUR');
});

test('the page recounts a cart of 50 or less with shipping', async ({
  page,
}) => {
  await page.goto('/?mugs=1&posters=1');
  await page.getByRole('button', { name: 'Recount' }).click();

  await expect(page.getByTestId('recount')).toHaveText('36.95 EUR');
});
