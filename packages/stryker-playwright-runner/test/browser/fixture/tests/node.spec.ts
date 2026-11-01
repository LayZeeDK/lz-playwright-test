// Runs the app's code in the Playwright worker itself, with no page.
import { expect, test } from '@playwright/test';

import { add, countTo } from '../public/lib.js';
import { decrement, increment, isSlow } from '../public/node-only.js';

test('adds in the worker', () => {
  expect(add(1, 2)).toBe(3);
});

test('counts in the worker', () => {
  expect(countTo(3)).toBe(3);
});

test.describe('after a beforeAll that runs app code', () => {
  let incremented = 0;

  test.beforeAll(() => {
    incremented = increment(1);
  });

  test('reads what the beforeAll hook computed', () => {
    expect(incremented).toBe(2);
  });
});

const withWorkerFixture = test.extend<object, { decremented: number }>({
  decremented: [
    async ({ browserName }, use) => {
      await use(decrement(browserName.length));
    },
    { scope: 'worker' },
  ],
});

withWorkerFixture('reads what a worker fixture computed', ({ decremented }) => {
  expect(decremented).toBe('chromium'.length - 1);
});

async function waitPastTimeoutWhenSlow(): Promise<boolean> {
  const slow = isSlow();

  if (slow) {
    await new Promise((resolve) =>
      setTimeout(resolve, test.info().timeout + 1000),
    );
  }

  return slow;
}

test.describe.serial('with a test that is slow under one mutant', () => {
  test('passes under any mutant', () => {
    expect(add(1, 2)).toBe(3);
  });

  test('waits past its timeout under the slow mutant', async () => {
    expect(await waitPastTimeoutWhenSlow()).toBe(false);
  });
});
