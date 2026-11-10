import { expect, test } from '@playwright/test';

test('opens a frame and a popup on pages without instrumented code', async ({
  page,
}) => {
  await page.goto('/plain.html');
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open' }).click();

  await expect(await popup).toHaveTitle('blank');
  await expect
    .poll(() => page.frame({ url: /\/blank\.html$/ })?.title())
    .toBe('blank');
});
