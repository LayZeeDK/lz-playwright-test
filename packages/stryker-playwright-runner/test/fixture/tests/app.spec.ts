import { expect, type Page, test } from '@playwright/test';

test('shows the greeting', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#out')).toHaveText('Hello 3', { timeout: 1000 });
});

test('counts to three', async ({ page }) => {
  await page.goto('/');

  expect(await page.evaluate(() => window.countTo(3))).toBe(3);
});

test.describe.serial('with a page shared from beforeAll', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto('/');
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('first user of the shared page', async () => {
    expect(await page.evaluate(() => window.countTo(1))).toBe(1);
  });

  test('second user of the shared page', async () => {
    expect(await page.evaluate(() => window.countTo(2))).toBe(2);
  });
});

test('keeps coverage across a navigation to a page without the app', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#out')).toHaveText('Hello 3', { timeout: 1000 });
  await page.goto('/blank.html');

  await expect(page).toHaveTitle('blank');
});

test.describe.serial('with a page from beforeAll that is never closed', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto('/');
  });

  test('doubles on a page the worker closes', async () => {
    expect(await page.evaluate(() => window.double(2))).toBe(4);
  });
});

test('halves on a second page it closes before the test ends', async ({
  context,
}) => {
  const second = await context.newPage();
  await second.goto('/');

  expect(await second.evaluate(() => window.half(4))).toBe(2);

  await second.close();
});
