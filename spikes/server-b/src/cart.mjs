// Server-side pricing, the only file spike B mutates. `currency` is evaluated once, when the server starts.
export const currency = 'EUR';

export function total(mugs, posters) {
  const subtotal = mugs * 12 + posters * 20;

  return subtotal > 50 ? subtotal : subtotal + 4.95;
}

export function label(amount) {
  return `${amount.toFixed(2)} ${currency}`;
}
