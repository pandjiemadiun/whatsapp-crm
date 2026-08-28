import { formatPrice } from '../utils/format';
import type { CartPayload } from '../types/chat';

/** READ-ONLY cart summary — presentation only (G2-E.3.3, visual).
 *
 *  Renders the authoritative `payload` VERBATIM. No product lookup (cart items
 *  have `productName`, not a productId join), no client-side subtotal/total
 *  calculation, no localStorage, no cart mutation, no CartAuthority touch.
 *
 *  Handlers are OPTIONAL props wired only by an existing upstream handler —
 *  never fabricated. If a caller passes none, the checkout button / reply chips
 *  are hidden (the payload + `formatPrice` do all rendering).
 */
export interface CartSummaryProps {
  cart: CartPayload;
  /** Shipping cost — rendered ONLY when the payload/caller provides it.
   *  If absent: do NOT fabricate "Rp 0". */
  shipping?: number | null;
  /** Wired upstream only if an existing checkout handler exists. Receives the orderId. */
  onCheckout?: (orderId: string) => void;
  /** "Tambah produk lain" — wired upstream only if an existing handler exists. */
  onAddProduct?: () => void;
  /** "Ubah alamat" — wired upstream only if an existing handler exists. */
  onAddressChange?: () => void;
}

export default function CartSummary({
  cart,
  shipping,
  onCheckout,
  onAddProduct,
  onAddressChange,
}: CartSummaryProps) {
  const { items, total } = cart;
  const list = Array.isArray(items) ? items : [];

  return (
    <>
      <div className="receipt">
        <div className="receipt-head">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{ color: 'var(--ink-soft)' }}
            aria-hidden="true"
          >
            <path d="M9 14l2 2 4-4" />
            <rect x="3" y="4" width="18" height="17" rx="2" />
            <path d="M3 9h18" />
          </svg>
          <span>RINGKASAN PESANAN</span>
        </div>

        {list.map((item) => (
          <div className="receipt-row" key={item.id}>
            <span>
              {item.productName}
              {item.variantLabel ? ` (${item.variantLabel})` : ''}
              {' × '}
              {item.quantity}
            </span>
            <span>{formatPrice(item.subtotal)}</span>
          </div>
        ))}

        {/* Shipping: render ONLY when provided — never fabricate "Rp 0". */}
        {shipping != null && (
          <div className="receipt-row">
            <span>Ongkos kirim</span>
            <span>{formatPrice(shipping)}</span>
          </div>
        )}

        <div className="receipt-total">
          <span className="label">Grand Total</span>
          <span className="amount">{formatPrice(total)}</span>
        </div>

        {onCheckout && cart.orderId && (
          <button
            type="button"
            className="checkout-btn"
            onClick={() => onCheckout(cart.orderId as string)}
          >
            Checkout Sekarang
          </button>
        )}
      </div>

      {(onAddProduct || onAddressChange) && (
        <div className="chip-row">
          {onAddProduct && (
            <button type="button" className="reply-chip" onClick={onAddProduct}>
              Tambah produk lain
            </button>
          )}
          {onAddressChange && (
            <button type="button" className="reply-chip" onClick={onAddressChange}>
              Ubah alamat
            </button>
          )}
        </div>
      )}
    </>
  );
}
