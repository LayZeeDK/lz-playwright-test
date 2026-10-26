import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('shows the heading', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
});

test('closes the dialog', async ({ page }) => {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Close' }).click();

  await expect(page.getByRole('dialog')).toBeHidden();
});

test('reveals the status', async ({ page }) => {
  await page.getByRole('button', { name: 'Show' }).click();

  await expect(page.getByRole('status')).toHaveText('Revealed');
});

test('panel starts hidden', async ({ page }) => {
  await expect(page.getByText('Details panel')).toBeHidden();
});

test('navigates to done', async ({ page }) => {
  await page.getByRole('link', { name: 'Done' }).click();

  await expect(page).toHaveURL(/#\/done$/);
});

test('submit is disabled while busy', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Submit' })).toBeDisabled();
});

test('region hidden until opened', async ({ page }) => {
  await expect(page.getByText('Region content')).toBeHidden();
  await page.getByRole('button', { name: 'Menu' }).click();

  await expect(page.getByText('Region content')).toBeVisible();
});

test('opens the dialog', async ({ page }) => {
  await page.getByRole('button', { name: 'Menu' }).click();

  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
});

test('shows the total', async ({ page }) => {
  await expect(page.getByTestId('total')).toHaveText('42');
});

test('toggle reports expanded', async ({ page }) => {
  await page.getByRole('button', { name: 'Menu' }).click();

  await expect(
    page.getByRole('button', { name: 'Menu', expanded: true }),
  ).toBeVisible();
});
