import { expect, test } from '@playwright/test';

test.describe('shop', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('shows the heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Shop' })).toBeVisible();
  });

  test('is ready after a sleep', async ({ page }) => {
    await page.getByRole('button', { name: 'Start' }).click();
    // eslint-disable-next-line playwright/no-wait-for-timeout -- the statement LzPlaywrightSleepWait removes
    await page.waitForTimeout(1_000);

    // eslint-disable-next-line playwright/prefer-web-first-assertions -- a check that does not retry, so it fails without the wait
    expect(await page.getByText('Ready').isVisible()).toBe(true);
  });

  test('titles the page when done', async ({ page }) => {
    await page.getByRole('button', { name: 'Start' }).click();
    await page.waitForFunction('document.title === "Done"');

    expect(await page.title()).toBe('Done');
  });

  test('records a visit', async ({ page, request }) => {
    await page.getByRole('button', { name: 'Visit' }).click();
    await page.waitForResponse('**/api/visit');
    const visits = await request.get('/api/visits');

    expect(await visits.text()).toBe('1');
  });
});

test('expires the offer on the clock', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.clock.runFor(5_000);

  // eslint-disable-next-line playwright/prefer-web-first-assertions -- a check that does not retry, so it fails without the clock run
  expect(await page.getByText('Expired').isVisible()).toBe(true);
});
