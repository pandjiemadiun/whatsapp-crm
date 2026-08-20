import type { OrderWithItems, OrderItemInput, ConfirmedItem } from '../domain/types.js';
export declare class OrderService {
    private static readonly DONE_ORDERING_KEYWORDS;
    /**
     * Deteksi sinyal "selesai pesan".
     * Tidak perlu LLM — keyword heuristic cukup untuk phrase idiomatik.
     */
    detectDoneOrdering(message: string): boolean;
    /**
     * Add a single confirmed item to the conversation's draft order.
     * - If no draft order exists for this conversation, create one.
     * - If a draft exists, append the item to the existing items array.
     * Uses prisma.order.findFirst + conditional create/update via transaction.
     */
    addConfirmedItemToOrder(conversationId: string, storeId: string, customerId: string, item: ConfirmedItem): Promise<void>;
    /**
     * Sync complete cart state (confirmedItems array) to draft order.
     * Replaces or updates existing draft order items with current confirmedItems.
     */
    syncCartStateToDraftOrder(conversationId: string, storeId: string, customerId: string, confirmedItems: ConfirmedItem[], shippingAddress?: string | null): Promise<void>;
    /**
     * Check-out: transition draft order → waiting_address.
     * Called when done-ordering signal detected.
     * Delegates to CartAuthority.checkout which enforces stock validation,
     * storeId filtering, and state machine transition via transitionOrder.
     */
    finalizeDraftOrder(conversationId: string, storeId: string): Promise<string>;
    /**
     * Ambil pesanan lengkap (termasuk items) by ID.
     */
    getOrderById(orderId: string): Promise<OrderWithItems>;
    /**
     * Ambil semua pesanan milik satu percakapan, urut createdAt DESC.
     */
    getOrdersByConversation(conversationId: string): Promise<OrderWithItems[]>;
    /**
     * Buat pesanan dari daftar productId + qty.
     * 1. Validasi produk & stok
     * 2. Hitung totalPrice
     * 3. Buat order + orderItem (snapshot nama & harga)
     * 4. Update extractedEntities di context (type: order, product)
     */
    createOrder(storeId: string, conversationId: string, customerId: string, items: OrderItemInput[]): Promise<OrderWithItems>;
    /**
     * Update status pesanan via state machine otoritatif (order-transition).
     *
     * FIX (G2-F1): sebelumnya pakai `prisma.order.update` mentah yang BYPASS
     * `transitionOrder()` — melanggar invarian single-source-of-truth
     * (order-transition.ts:8-10). Sekarang delegasi penuh ke transitionOrder
     * agar validasi ALLOWED_TRANSITIONS + invariant confirmedAt tetap berlaku.
     * Signature dipertahankan (dipakai oleh test integration).
     */
    updateOrderStatus(orderId: string, status: string): Promise<OrderWithItems>;
    /**
     * Tambah item ke pesanan berstatus pending.
     */
    addOrderItem(orderId: string, productId: string, quantity: number, customizations?: Record<string, unknown>): Promise<OrderWithItems>;
    /**
     * Hapus item dari pesanan, kurangi totalPrice.
     */
    removeOrderItem(orderId: string, orderItemId: string): Promise<OrderWithItems>;
    /**
     * Cancel an order via the authoritative state machine (order-transition).
     *
     * Business invariant: only transitions present in ALLOWED_TRANSITIONS are
     * permitted. Per the existing single-source-of-truth state machine this
     * means draft / waiting_address / waiting_payment / pending / confirmed /
     * packing / paid / shipped MAY cancel, while completed / refunded /
     * cancelled are terminal and are REJECTED.
     *
     * Ownership (store + customer) is validated here — order-transition.ts
     * documents that "Ownership is validated by the caller". Runs inside an
     * optional tx so it can participate in the structured-action idempotency
     * transaction (FOR UPDATE + SAVEPOINT). Business rejections are thrown as
     * plain errors with an INVALID_-prefixed code so the action registry's
     * executeClaimedAction records them as FAILED (not an infra abort).
     */
    cancelOrder(orderId: string, storeId: string, customerId: string, options?: {
        tx?: any;
    }): Promise<OrderWithItems>;
    private mapOrderWithItems;
}
export declare const orderService: OrderService;
//# sourceMappingURL=order.service.d.ts.map