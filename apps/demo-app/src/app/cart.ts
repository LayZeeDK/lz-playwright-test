export interface CartLine {
  name: string;
  priceCents: number;
  quantity: number;
}

export const FREE_SHIPPING_THRESHOLD_CENTS = 50_00;
const SHIPPING_CENTS = 4_95;
const DISCOUNT_CODES: Record<string, number> = { SAVE10: 10, HALF: 50 };

export function lineTotal(line: CartLine): number {
  if (line.quantity <= 0) {
    return 0;
  }

  return line.priceCents * line.quantity;
}

export function subtotal(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + lineTotal(line), 0);
}

export function discountPercent(code: string): number {
  return DISCOUNT_CODES[code.trim().toUpperCase()] ?? 0;
}

export function shipping(subtotalCents: number): number {
  return subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS || subtotalCents === 0
    ? 0
    : SHIPPING_CENTS;
}

export function total(lines: CartLine[], code: string): number {
  const sub = subtotal(lines);
  const discounted = Math.round((sub * (100 - discountPercent(code))) / 100);

  return discounted + shipping(sub);
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
