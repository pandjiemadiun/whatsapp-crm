import type { ConfirmedItem } from '../domain/types.js';
import type { CartOp } from '../domain/types.js';
/**
 * A single line item in the cart. Maps to OrderItem relation row.
 */
export interface CartLine {
    id: string;
    productId: string | null;
    variantId: string | null;
    productName: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
}
/**
 * Summary of cart for UI delivery (structured-message.mapper).
 */
export interface CartSummary {
    items: CartLine[];
    total: number | null;
    orderId?: string;
}
export declare class CartError extends Error {
    constructor(message: string);
}
/**
 * Thrown when a cart operation violates an invariant (invalid product,
 * cross-tenant access, insufficient stock, etc.).
 */
export declare class CartInvariantError extends CartError {
    readonly code: string;
    constructor(message: string, code: string);
}
/**
 * Thrown when product name resolution is ambiguous — multiple products
 * match the substring fallback and the correct one cannot be determined.
 */
export declare class ProductAmbiguousError extends CartError {
    readonly candidates: string[];
    constructor(productName: string, candidates: string[]);
}
export declare class CartAuthority {
    /**
     * Get cart line items (OrderItem relation rows) for a conversation's
     * draft order. Returns empty array if no draft order exists.
     */
    getCart(conversationId: string): Promise<CartLine[]>;
    /**
     * Get cart summary (items + total) for structured-message delivery.
     * Total is authoritative from Order.totalPrice if available, else computed.
     */
    getCartSummary(conversationId: string): Promise<CartSummary>;
    /** Check whether a draft order (cart) exists for this conversation. */
    hasCart(conversationId: string): Promise<boolean>;
    /**
     * Add a product to the cart (or increment quantity if already present).
     *
     * Invariants:
     * - product valid (not deleted, belongs to store)
     * - quantity > 0
     * - tenant correct (storeId check)
     * - customer correct (customerId check)
     * - price from DB (authoritative, not from caller)
     */
    addLine(conversationId: string, storeId: string, customerId: string, productId: string, qty?: number, variantId?: string | null): Promise<CartLine[]>;
    /**
     * Remove a line item from the cart by lineItemId.
     * Invariant: line item belongs to this conversation's draft order.
     */
    removeLine(conversationId: string, lineItemId: string, tx?: any): Promise<CartLine[]>;
    /**
     * Update quantity of a line item. qty = 0 deletes the line item.
     * Invariant: quantity >= 0; line item belongs to cart.
     */
    updateQuantity(conversationId: string, lineItemId: string, qty: number, tx?: any): Promise<CartLine[]>;
    /**
     * Clear all items from the cart. Deletes all OrderItem rows for the
     * conversation's draft order. Does NOT delete the Order row itself
     * (preserves conversation linkage + status).
     */
    clearCart(conversationId: string): Promise<void>;
    /**
     * Checkout: transition draft Order → waiting_address via state machine.
     * The draft Order becomes an immutable snapshot (post-checkout states
     * managed by G2-B.6 state machine).
     *
     * Stock invariant (PV-P1-08):
     *   The cart→order boundary is the SINGLE atomic stock-deducting point.
     *   The entire checkout — stock validation, stock DECREMENT, autoCancelAt
     *   stamping, state-machine transition, and cart-scratchpad clear — runs
     *   inside ONE prisma.$transaction: any failure (incl. a lost stock race)
     *   rolls EVERYTHING back so stock is never decremented for a failed order.
     *
     *   Cart-level stock checks (addLine/executeOps) remain best-effort for UX.
     *   Two concurrent checkouts for the last unit cannot both succeed: the
     *   decrement uses an atomic compare-and-swap (updateMany WHERE stock >= qty);
     *   the loser's updateMany returns count===0 → CartInvariantError(INSUFFICIENT_STOCK)
     *   → transaction rollback. This replaces the old "best-effort, not locked"
     *   comment — stock is now truly reserved at checkout.
     *
     *   Stock is restored on cancellation (see OrderService.cancelOrder + the
     *   AutoCancel cron) by reversing the same per-item decrement.
     */
    checkout(conversationId: string, storeId: string): Promise<string>;
    /**
     * Execute a batch of CartOps atomically.
     * Resolves product names → productId via productService, reads price from DB.
     * This replaces the current pattern of:
     *   modifyCart (writes confirmedItems) + syncCartStateToDraftOrder (writes Order.items)
     *
     * If `tx` is provided (from caller's existing transaction), uses it directly.
     * Otherwise creates a new prisma.$transaction.
     *
     * Returns the updated cart as ConfirmedItem[] (backward compat for callers
     * that expect ConfirmedItem[] from modifyCart).
     */
    executeOps(ops: CartOp[], storeId: string, customerId: string, conversationId: string, tx?: unknown): Promise<ConfirmedItem[]>;
    /**
     * Migrate legacy confirmedItems from extractedEntities JSON to OrderItem rows.
     * Called on first cart access if no draft Order exists but confirmedItems has data.
     * After migration, confirmedItems is read-only (CartAuthority is authoritative).
     */
    migrateFromConfirmedItems(conversationId: string, storeId: string, customerId: string, confirmedItems: ConfirmedItem[]): Promise<void>;
    /**
     * Backward-compatible modifyCart that delegates to CartAuthority.
     * Kept so conversationContextService.modifyCart callers don't break.
     * Returns ConfirmedItem[] (mapped from CartLine[]).
     */
    modifyCart(conversationId: string, storeId: string, customerId: string, action: 'add' | 'remove' | 'swap', opts: {
        cancelledProduct?: string;
        addedProduct?: string;
        qty?: number;
        price?: number;
    }, tx?: unknown): Promise<ConfirmedItem[]>;
    /**
     * Backward-compatible getCartFromDb that delegates to CartAuthority.
     * If tx is provided, uses it for the read.
     */
    getCartFromDb(conversationId: string, tx?: unknown): Promise<ConfirmedItem[]>;
    /**
     * Restore cart to a previous snapshot (ROLLBACK path).
     * Clears all existing OrderItem rows and re-adds items from the snapshot.
     * This ensures OrderItem rows, Order.items JSON, and confirmedItems JSON
     * all stay consistent after a rollback.
     *
     * Uses productId if available in snapshot; falls back to name resolution.
     */
    restoreFromSnapshot(conversationId: string, storeId: string, customerId: string, snapshot: ConfirmedItem[]): Promise<void>;
    /**
     * Get cart as ConfirmedItem[] (backward compat for PipelineContext.cart).
     * Migrates from confirmedItems if no draft Order exists.
     */
    getCartAsConfirmedItems(conversationId: string, tx?: unknown): Promise<ConfirmedItem[]>;
    /**
     * Sync confirmedItems into conversationContext.extractedEntities JSON.
     * Backward-compat: existing tests and readers still read from confirmedItems
     * in extractedEntities. This keeps both in sync atomically within the tx.
     */
    private syncConfirmedItemsJson;
    /**
     * Find the conversation's draft order. Returns null if not found.
     */
    private findDraftOrder;
    /**
     * Find-or-create draft order for a conversation. Creates if absent.
     */
    private findOrCreateDraftOrder;
    private createDraftOrder;
    /**
     * Resolve a product name (from LLM) to productId + unitPrice via DB.
     *
     * Resolution order:
     * 1. Exact case-insensitive name match → deterministic, returns single result
     * 2. Substring `contains` match → count candidates:
     *    - 0 candidates → return null (not found)
     *    - 1 candidate → return it
     *    - >1 candidates → throw ProductAmbiguousError (DO NOT pick arbitrarily)
     *
     * `tx` can be null (standalone query) — used during migration.
     * StoreId is ALWAYS used as a filter (tenant isolation).
     */
    /**
     * Resolve a product by its authoritative productId (structured/validated path).
     *
     * Tenant-isolated: filters by storeId, enforces isActive + not deleted.
     * Used when a CartOp carries `productId` directly so we skip the
     * name-based round-trip (resolveProductByName). Returns null when the
     * product is missing / not accessible, mirroring resolveProductForCart.
     */
    private resolveProductById;
    /**
     * PV-P1/PV-P2 — SATU helper terpusat untuk resolve price + stock dari cart line.
     *
     * Aturan:
     * - variantId != null  → BACA DARI ProductVariant (price + stock). Product.price/
     *   Product.stock TIDAK PERNAH dipakai untuk baris ini. Variant divalidasi
     *   milik productId yang benar & aktif; kalau tidak valid → throw (sama perilaku
     *   product tidak ditemukan).
     * - variantId == null  → BACA DARI Product seperti sebelum task ini.
     *   PV-P2: kalau product.hasVariants === true → throw VARIANT_REQUIRED.
     *   Single authority untuk guard ini ada di sini (sesuai kontrak §2.3/§6A.1).
     *   Handler-layer guard di action-registry.ts tetap ada sebagai defense-in-depth.
     *
     * Semua titik yang butuh price/stock (addLine, executeOps, checkout) WAJIB pakai
     * helper ini — jangan duplikasi logika.
     */
    private resolvePriceAndStock;
    /**
     * PV-P2c-LLM-B Bagian 1.2 — Resolve a free-text variant label (warna/ukuran,
     * mis. "merah", "merah size L") ke variantId — DETERMINISTIK dari data DB
     * (ProductVariant.attributes + sku), bukan LLM/embedding (I13).
     *
     * Strategi (mengikuti pola resolveProductByName: exact → substring):
     *   1. Exact     : variantText sama persis (case-insensitive) dengan salah
     *                  satu attribute VALUE atau sku.
     *   2. Substring : semua token variantText ada di "label token" variant
     *                  (gabungan attribute key + value + sku, lowercased,
     *                  dipecah non-word boundary).
     * - 1 kandidat (exact atau substring) → kembalikan variantId.
     * - >1 kandidat (ambiguous) → kembalikan null (JANGAN throw).
     * - 0 kandidat (no match) → kembalikan null.
     *
     * null (tidak ter-resolve) disengaja dibiarkan: resolvePriceAndStock — yang
     * sudah ada & battle-tested — akan melempar CartInvariantError VARIANT_REQUIRED
     * untuk product.hasVariants. Dengan demikian ada SATU error surface yang
     * konsisten (tidak 2 pesan error berbeda untuk kasus yang sama).
     */
    private resolveVariantByLabel;
    private resolveProductByName;
    /**
     * Compute total price from OrderItem rows.
     */
    private computeTotal;
    /**
     * Export OrderItem rows to JSON array for Order.items field (backward compat).
     */
    private exportItemsJson;
    /** Convert OrderItem rows to JSON-compatible array for Order.items field. */
    private itemsToJson;
    /** Map OrderItem rows to CartLine[]. */
    private mapOrderItems;
    /** Convert CartLine[] to ConfirmedItem[] (backward compat for PipelineContext). */
    private cartLinesToConfirmedItems;
    /** Convert OrderItem rows directly to ConfirmedItem[]. */
    private orderItemsToConfirmedItems;
    /** Read legacy confirmedItems from extractedEntities JSON (migration source). */
    private readLegacyConfirmedItems;
}
export declare const cartAuthority: CartAuthority;
//# sourceMappingURL=cart-authority.d.ts.map