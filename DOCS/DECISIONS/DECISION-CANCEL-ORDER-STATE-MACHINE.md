# DECISION LOG: Cancel Order State Machine Amendments

> Last amended: 29 Agu 2026 — Stock integrity fix (PV-P1-08)

---

## Amandemen 2026-08-29: handleCancelOrder → cancelOrder Flow (P7 → P1-08)

### Latar Belakang
Sejak implementasi **Stock Integrity Fix** (PV-P1-08), `handleCancelOrder` TIDAK LAGI
delegasi langsung ke `transitionOrder(orderId, 'cancelled', ...)`. Alur baru:

```
handleCancelOrder (action-registry.ts)
    ↓ tx (idempotency transaction)
orderService.cancelOrder(orderId, storeId, customerId, { tx })
    ↓
restoreStockForOrderItems(orderItems, tx)   ← NEW (P1-08)
    ↓
transitionOrder(orderId, 'cancelled', { tx, actor })
```

### Pertukaran
| Sebelum | Sesudah |
|---------|---------|
| `handleCancelOrder → transitionOrder` | `handleCancelOrder → cancelOrder → restore + transitionOrder` |
| Stock tidak pernah dikembalikan pada cancel | Stock otomatis dikembalikan sesuai `shouldRestoreStock(orderStatus)` |
| `waiting_address`/`waiting_payment` cancel → stock -1 | Stock dikembalikan ke produk/varian |

### Syarat Stock Restore
Fungsi `restoreStockForOrderItems` hanya increment bila:

1. **Pre-shipment status**: `orderStatus` ada di `PRE_SHIPMENT_STATUSES`
   - `waiting_address`, `waiting_payment`, `confirmed`, `paid`, `packing`
2. **Stock bukan NULL** (unlimited)
3. **OrderId ada** (orderItems tersedia)

### Kontrak Struktural
- `cancelOrder()` mengembalikan `OrderWithItems` (termasuk `orderItems`)
- `restoreStockForOrderItems()` menggunakan `updateMany` dengan `stock: { not: null }`
  sebagai guard anti-increment stock `null` (unlimited) → tidak boleh di-decrement,
  jadi tidak boleh di-increment.

---

## Keputusan Lama (Sebelum 2026-08-29)

| ID | Keputusan | Lokasi |
|----|-----------|--------|
| OLD-1 | Draft → waiting_address via transitionOrder | cart-authority.ts:checkout(), order-transition.ts |
| OLD-2 | Admin cancel via PUT /:id/status | routes/orders.ts:143 |
| OLD-3 | Structured CANCEL_ORDER via handleCancelOrder | action-registry.ts:1014 |

Semua tiga titik **hanya** melakukan `transitionOrder(..., 'cancelled')` tanpa
restore stock. **INI YANG BARU DIKORRIGSI OLEH P1-08**.

---

## Referensi Terkait
- RAILS.md §4.2: State machine invariance (cancel as terminal)
- order.service.ts: `PRE_SHIPMENT_STATUSES`, `shouldRestoreStock()`, `restoreStockForOrderItems()`
- BUG-BELUM-DIBERESKAN.md §VI: Stock Integrity Fix