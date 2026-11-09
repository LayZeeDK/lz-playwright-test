import { expect, test } from '@playwright/test';

test.describe('shop', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('shows the heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Shop' })).toBeVisible();
  });

  test('adds an item', async ({ page }) => {
    await page.getByRole('button', { name: 'Add' }).click();

    await expect(page.getByTestId('count')).toHaveText('1');
  });

  test('greets by name', async ({ page }) => {
    await page.getByLabel('Name').fill('Ada');

    await expect(page.getByTestId('greeting')).toHaveText('Hello, Ada');
  });

  test('shows the tips on hover', async ({ page }) => {
    await page.getByText('Help').hover();

    await expect(page.getByText('Tips')).toBeVisible();
  });

  test('loads the user', async ({ page }) => {
    await page.route('**/api/user', (route) =>
      route.fulfill({ json: { name: 'Grace' } }),
    );
    await page.getByRole('button', { name: 'Load user' }).click();

    await expect(page.getByTestId('user')).toHaveText('Grace');
  });

  test('reports a failed ping as offline', async ({ page }) => {
    await page.route('**/api/ping', (route) => route.abort());
    await page.getByRole('button', { name: 'Ping' }).click();

    await expect(page.getByTestId('network')).toHaveText('offline');
  });
});

test('stores a note', async ({ request }) => {
  await request.post('/api/note', { data: 'kept' });
  const note = await request.get('/api/note');

  expect(await note.text()).toBe('kept');
});
