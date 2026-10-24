import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('shows line totals and subtotal', async ({ page }) => {
  await page.getByLabel('Mug quantity').fill('3');

  await expect(page.getByLabel('Mug total')).toHaveText('$36.00');
  await expect(page.getByTestId('subtotal')).toHaveText('$56.00');
});

test('a zero quantity costs nothing', async ({ page }) => {
  await page.getByLabel('Poster quantity').fill('0');

  await expect(page.getByLabel('Poster total')).toHaveText('$0.00');
});

test('charges shipping below the free-shipping threshold', async ({ page }) => {
  await expect(page.getByTestId('shipping')).toHaveText('$4.95');
  await expect(page.getByTestId('total')).toHaveText('$36.95');
});

test('ships for free at the threshold', async ({ page }) => {
  await page.getByLabel('Mug quantity').fill('0');
  await page.getByLabel('Poster quantity').fill('2');
  await page.getByLabel('Mug quantity').fill('1');

  await expect(page.getByTestId('subtotal')).toHaveText('$52.00');
  await expect(page.getByTestId('shipping')).toHaveText('$0.00');
});

test('applies a discount code case-insensitively', async ({ page }) => {
  await page.getByLabel('Discount code').fill(' save10 ');

  await expect(page.getByTestId('total')).toHaveText('$33.75');
});
