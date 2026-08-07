// Exchange rate approximation — not live FX (see ARCHITECTURE.md §3.7)
const USD_TO_IDR = 16000;

/**
 * Format Rupiah secara kompak untuk tampilan agregat.
 * v >= 1.000.000 → Rp X.X jt
 * v >= 1.000    → Rp X rb
 * else          → Rp X
 */
export function formatRupiahCompact(v: number): string {
  if (v >= 1e6) return `Rp ${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  if (v >= 1e3) return `Rp ${Math.round(v / 1e3)} rb`;
  return `Rp ${Math.round(v)}`;
}

/**
 * Convert AI cost (USD) to Rupiah for display only.
 * Backend stores costUSD — this is display-time conversion only.
 */
export function usdToIdr(usd: number): number {
  return usd * USD_TO_IDR;
}

export { USD_TO_IDR };
