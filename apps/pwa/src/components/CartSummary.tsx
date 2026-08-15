import { formatPrice } from '../utils/format';
import type { CartPayload } from '../types/chat';

/** READ-ONLY cart summary (Step 5).
 *  No add/remove/change. No product lookup (cart items have no productId).
 *  total is authoritative from the backend — never recalculated client-side. */
export default function CartSummary({ cart }: { cart: CartPayload }) {
  const { items, total } = cart;

  const list = Array.isArray(items) ? items : [];

  return (
    <div className="receipt-edge w-[250px] bg-white rounded-2xl border border-border shadow-lg overflow-visible">
      <div className="p-4 pb-5">
        {/* Receipt header */}
        <div className="flex items-center gap-2 pb-3 mb-3 border-b border-dashed" style={{ borderColor: 'var(--line)' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--ink-soft)' }}>
            <path d="M9 14l2 2 4-4" />
            <rect x="3" y="4" width="18" height="17" rx="2" />
            <path d="M3 9h18" />
          </svg>
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-soft)' }}>
            Ringkasan Pesanan
          </span>
        </div>

        {/* Items */}
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keranjang kosong</p>
        ) : (
          <div className="space-y-2">
            {list.map((it) => (
              <div key={it.id} className="flex justify-between text-xs">
                <span className="break-words text-foreground">
                  {it.productName} ×{it.quantity}
                </span>
                <span className="text-right font-mono font-semibold text-foreground">{formatPrice(it.subtotal)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Shipping */}
        <div className="flex justify-between text-xs mt-3 pt-2 border-t border-dashed" style={{ borderColor: 'var(--line)' }}>
          <span className="text-foreground">Ongkos kirim</span>
          <span className="font-mono font-semibold text-foreground">Rp 0</span>
        </div>

        {/* Total */}
        <div className="flex justify-between items-baseline mt-3 pt-2 border-t border-dashed" style={{ borderColor: 'var(--line)' }}>
          <span className="text-xs font-bold text-foreground">Grand Total</span>
          <span className="font-mono text-base font-bold" style={{ color: 'var(--clay)' }}>{formatPrice(total ?? 0)}</span>
        </div>

        {/* Checkout button */}
        <button
          type="button"
          className="w-full mt-4 py-2.5 rounded-xl text-xs font-extrabold border-0 cursor-pointer transition-all hover:brightness-110 active:scale-[0.98]"
          style={{ background: 'var(--marigold)', color: '#241505' }}
        >
          Checkout Sekarang
        </button>
      </div>
    </div>
  );
}
