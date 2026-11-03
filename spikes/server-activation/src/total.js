export function total(mugs, posters) {
  const subtotal = mugs * 12 + posters * 20;

  return subtotal >= 50 ? subtotal : subtotal + 4.95;
}
