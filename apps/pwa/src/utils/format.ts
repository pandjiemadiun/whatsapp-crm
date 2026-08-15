/** FASE 5 — presentation helpers. No backend, no fabrication.
 *  RULE: DO NOT FABRICATE CURRENCY. The authoritative `message.created` payload
 *  for product/cart is { id, name, price, stock, imageUrl } — NO currency field.
 *  The PWA /init store response (PWA_STORE_PUBLIC_SELECT) also excludes currency.
 *  IDR is the canonical currency for all stores in this system; prepend "Rp " as
 *  a locale presentation prefix without altering the authoritative numeric value. */

/**
 * Format a monetary value as an Indonesian Rupiah display string.
 * `price == null` / NaN -> em-dash (do NOT fabricate a number).
 */
export function formatPrice(price: number | null | undefined): string {
  if (price == null || Number.isNaN(price)) return '—';
  const n = Math.round(price);
  return `Rp ${n.toLocaleString('id-ID')}`;
}
