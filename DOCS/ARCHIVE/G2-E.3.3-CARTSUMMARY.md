# G2-E.3.3 — Cart Summary Visual (receipt)

Scope: **one visual change only** — `CartSummary.tsx` + the `.receipt*` styling it needs.
No redesign of any other component. Layout preserved from the BUG 1–5 baseline (`9a6bfc1`)
and G2-E.3.2. Visual source of truth: `depot-kinasih-storefront-mockup.html` (lines 820–838).

## 1. Files changed
- `apps/pwa/src/components/CartSummary.tsx` — rewritten to the mockup receipt structure.
- `apps/pwa/src/index.css` — appended the `.receipt` / `.receipt-head` / `.receipt-row` /
  `.receipt-total` / `.checkout-btn` / `.chip-row` / `.reply-chip` visual rules (exact mockup
  values, using existing design tokens `--ink`, `--ink-soft`, `--clay`, `--marigold`, `--line`,
  `--forest`, `--font-mono`, `--font-sans`). Unique class names → **zero style change to any
  other component** (verified: `git diff --stat HEAD` is only these 2 files).
- `apps/pwa/screenshot-output/after-g2-cart/*.png` — regression + visual screenshots.

No change to `MessageRenderer`, `MessageList`, `ChatBubble`, `ChatPage`, `ProductCard`,
`EmptyState`, header, composer, menu, `CartAuthority`, backend, or conversation engine
(verification: `git diff --stat HEAD` = `CartSummary.tsx` + `index.css` only).

## 2. Visual structure implemented (matches mockup §TARGET STRUCTURE)
```
<div className="receipt">                       /* 250px box, torn-edge ::after */
  <div className="receipt-head">                 /* RINGKASAN PESANAN + receipt icon */
    <svg>... M9 14l2 2 4-4 / rect / M3 9h18 ...</svg>
    <span>RINGKASAN PESANAN</span>
  </div>
  {items.map(item =>                             /* receipt-row: "name × qty" | subtotal */
    <div className="receipt-row">
      <span>{item.productName} × {item.quantity}</span>
      <span>{formatPrice(item.subtotal)}</span>
    </div>
  )}
  {shipping != null &&                           /* Ongkos kirim row, ONLY if provided */
    <div className="receipt-row">…</div>}
  <div className="receipt-total">                /* Grand Total | amount (clay #B5502E) */
    <span className="label">Grand Total</span>
    <span className="amount">{formatPrice(total)}</span>
  </div>
  {onCheckout && <button className="checkout-btn">Checkout Sekarang</button>}
</div>
{(onAddProduct||onAddressChange) &&
  <div className="chip-row">                     /* reply chips, conditional */
    {onAddProduct && <button className="reply-chip">Tambah produk lain</button>}
    {onAddressChange && <button className="reply-chip">Ubah alamat</button>}
  </div>}
```
- Item field mapping adapts to the **existing** `CartItem` type (`productName`, `quantity`,
  `subtotal`) — contract unchanged.
- Currency uses the **existing** `formatPrice` (id-ID `Rp …`); no `formatCurrency` duplicate.
- Responsive: `width: 250px; max-width: min(250px, calc(100vw - 64px))` — compact on both
  mobile (390×844) and desktop (1280×800); verified width = 250px on desktop (NOT full-width).

## 3. Behavior preserved
`CartSummary` remains **presentation-only**: renders the authoritative `payload` verbatim,
reuses `formatPrice`, no product lookup (no productId join), no subtotal/total recalculation,
no localStorage, no cart mutation, no `CartAuthority` touch, no API/contract change.
MessageRenderer still calls `<CartSummary cart={payload as CartPayload} />` (no handler props
passed yet → checkout button + reply chips are hidden, not faked).

## 4. Ancillary fix (LOCAL + SAFE, in CartSummary)
- Removed hardcoded shipping `"Rp 0"`: shipping row now renders **only** when a `shipping`
  value is provided (`{shipping != null && …}`); if absent → hidden (no fabricated `Rp 0`).
- Removed `total ?? 0` fabrication: now `formatPrice(total)` (`formatPrice(null)` → `—`, no `0`).
- Removed the dead (no-`onClick`) checkout button's unconditional render; it is now wired to
  the `onCheckout` prop (conditional) — same click target, no fake handler.

## 5. Deferred finding (OUT OF SCOPE — NOT fixed)
- **Checkout / "Tambah produk lain" / "Ubah alamat" handlers are not wired.** `MessageRenderer`
  exposes `onAddToCart`, `onShowRelated`, `onQuickReply`, `onProductTap` — but none of these map
  to a cart checkout, an "add another product" browse action, or an address change (they are
  product-scoped / quick-reply-scoped). Wiring them to CartSummary requires editing
  `MessageRenderer.tsx` (+ `ChatPage` handlers), which is **outside** "CartSummary visual only".
  Per the rule ("JANGAN membuat handler baru / fake behavior"), the checkout button + reply chips
  are rendered **conditionally** and currently hidden (no handler passed). This is reported, not
  worked around. (The receipt itself — head/items/shipping/total — is complete.)

## 6. Typecheck
```
$ cd apps/pwa && ./node_modules/.bin/tsc --noEmit -p tsconfig.app.json
(no output)  TSC_EXIT=0
```

## 7. Build
```
$ cd apps/pwa && npm run build   # tsc -b && vite build
> pwa@0.0.0 build
> tsc -b && vite build
vite v8.2.1 building client environment for production...
transforming...✓ 124 modules transformed.
dist/assets/index-*-css   46.31 kB │ gzip: 8.91 kB
dist/assets/index-*-.js   361.86 kB │ gzip: 114.05 kB
✓ built in 826ms   BUILD_EXIT=0
```

## 8. Screenshot path
`apps/pwa/screenshot-output/after-g2-cart/` (5 shots, captured by a throwaway harness that
rendered the **real** `CartSummary` via a Vite entry — deleted, not committed — because
`CartSummary` only renders on backend `type:'cart'`, which never fires in this env as the V2
engine is down; the harness passed representative payloads + no-op handlers to prove the visual):
| file | proves |
|---|---|
| `1-chat-no-cartsummary-mobile.png` | Regression: live chat (`/c/kinasih2/`) has **0** `.receipt` (chat UI unchanged; cart never rendered live) |
| `2-1item-mobile.png` | Receipt: 1 item (`Kacang Tanah × 1` / `Rp 20.000`), shipping `Rp 0`, Grand Total `Rp 20.000`, Checkout Sekarang + 2 reply chips |
| `3-2items-mobile.png` | Receipt: 2 items, shipping `Rp 15.000`, Grand Total `Rp 58.000` (no handlers → button/chips hidden) |
| `4-mobile-fullpage.png` | Mobile layout: receipt stays compact (250px), torn-edge `::after` visible |
| `5-desktop-1item.png` | Desktop: receipt width = **250px** (not full-width); responsive `min(250px, 100vw-64px)` confirmed |

## Commit
Code+proof commit: `2d186d3b54d38d880fead9f9537785787ee5927f` (H3; parent `9787f79` G2-E.3.2).
This G2-E.3.3 report is committed on top of H3 (see `git log`):
```
0377817 G2-E.3.3: add visual report (CartSummary receipt)
2d186d3 G2-E.3.3: CartSummary visual -> mockup receipt structure
9787f79 G2-E.3.2: multi-tenant data integrity, cart authority, menu/avatar corrections
9a6bfc1 fix(pwa): resolve 5 critical chat UI bugs
```
