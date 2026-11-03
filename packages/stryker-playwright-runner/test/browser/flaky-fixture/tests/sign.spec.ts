// Runs the app's code in the Playwright worker, so no browser starts.
import { expect, test } from '@playwright/test';

import { sign } from '../public/sign.js';

test('names a positive sign, after a failed first attempt', () => {
  expect(sign(1)).toBe('positive');
  // Fails every first attempt, as a flaky test can.
  expect(test.info().retry).toBeGreaterThan(0);
});

test('names a negative sign', () => {
  expect(sign(-1)).toBe('negative');
});
