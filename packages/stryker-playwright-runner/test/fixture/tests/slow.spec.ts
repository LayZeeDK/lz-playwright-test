import { expect, test } from '@playwright/test';

// Outranks the per-test timeout the runner sets, so only the runner's deadline ends a loop here.
const RAISED_TIMEOUT_MS = 60_000;

test('counts to three under a raised timeout', async ({ page }) => {
  test.setTimeout(RAISED_TIMEOUT_MS);
  await page.goto('/');

  expect(await page.evaluate(() => window.countTo(3))).toBe(3);
});
