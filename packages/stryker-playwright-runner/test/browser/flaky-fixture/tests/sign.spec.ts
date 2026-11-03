import { expect, test } from '@playwright/test';

import { sign } from '../public/sign.js';

test('names a positive sign, after a failed first attempt', () => {
  expect(sign(1)).toBe('positive');
  expect(test.info().retry).toBeGreaterThan(0);
});

test('names a negative sign', () => {
  expect(sign(-1)).toBe('negative');
});
