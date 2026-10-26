// Runs the app's code in the Playwright worker itself, with no page.
import { expect, test } from '@playwright/test';

import { add, countTo } from '../public/lib.js';
import '../public/node-only.js';

test('adds in the worker', () => {
  expect(add(1, 2)).toBe(3);
});

test('counts in the worker', () => {
  expect(countTo(3)).toBe(3);
});
