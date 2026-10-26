import { expect, test } from '@playwright/test';

test('shows the price without a badge', async ({ mount }) => {
  const component = await mount('app/price-tag/Regular');

  await expect(component.getByTestId('price')).toHaveText('$12.00');
  await expect(component.getByTestId('badge')).toHaveCount(0);
});

test('shows the discount percentage on sale', async ({ mount }) => {
  const component = await mount('app/price-tag/OnSale');

  await expect(component.getByTestId('compare-at')).toHaveText('$20.00');
  await expect(component.getByTestId('badge')).toHaveText('25% off');
});

test('calls out half price', async ({ mount }) => {
  const component = await mount('app/price-tag/HalfPrice');

  await expect(component.getByTestId('badge')).toHaveText(
    'Half price or better',
  );
});

test('hides the badge when the compare-at price is not higher', async ({
  mount,
}) => {
  const component = await mount('app/price-tag/Configurable', {
    cents: 20_00,
    compareAtCents: 20_00,
  });

  await expect(component.getByTestId('badge')).toHaveCount(0);
});
