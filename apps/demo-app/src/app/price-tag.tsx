import { formatPrice } from './cart';

export interface PriceTagProps {
  cents: number;
  compareAtCents?: number;
}

export function percentOff(cents: number, compareAtCents: number): number {
  if (compareAtCents <= cents) {
    return 0;
  }

  return Math.round(((compareAtCents - cents) / compareAtCents) * 100);
}

export function PriceTag({ cents, compareAtCents }: PriceTagProps) {
  const off =
    compareAtCents === undefined ? 0 : percentOff(cents, compareAtCents);

  return (
    <p>
      <span data-testid="price">{formatPrice(cents)}</span>
      {off > 0 && (
        <>
          {' '}
          <s data-testid="compare-at">
            {formatPrice(compareAtCents ?? cents)}
          </s>{' '}
          <strong data-testid="badge">
            {off >= 50 ? 'Half price or better' : `${off}% off`}
          </strong>
        </>
      )}
    </p>
  );
}
