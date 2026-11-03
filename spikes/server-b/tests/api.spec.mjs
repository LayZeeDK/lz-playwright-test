import { expect, test } from '@playwright/test';

test('the API charges no shipping on a cart over 50', async ({ request }) => {
  const response = await request.get('/api/total?mugs=3&posters=1');

  expect(await response.json()).toEqual({ total: 56, label: '56.00 EUR' });
});

test('the API adds shipping to a cart of 50 or less', async ({ request }) => {
  const response = await request.get('/api/total?mugs=1&posters=1');
  const body = await response.json();

  expect(body.total).toBeCloseTo(36.95);
  expect(body.label).toBe('36.95 EUR');
});
