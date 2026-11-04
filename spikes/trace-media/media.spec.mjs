import { expect, test } from '@playwright/test';

test('a page with a 2D canvas, a WebGL canvas and a playing video', async ({ page }) => {
  await page.goto('/page.html');
  await expect.poll(() => page.locator('video').evaluate((v) => v.currentTime)).toBeGreaterThan(0.5);
  await page.locator('#go').click();
  await page.waitForTimeout(500);
  await page.locator('#go').click();
});
