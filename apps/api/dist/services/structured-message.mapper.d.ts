import type { ResponseResult } from '../domain/types.js';
/**
 * FASE 2 — Structured Message mapping (Web delivery), *complete authoritative payload*.
 *
 * RULE (HARD RULE #5/#15/#16): structured type TIDAK boleh ditentukan keyword/regex/
 * AI-source. Hanya sinyal yang DI‑AUTHORING engine pada `result` yang dipakai:
 *
 *   - `result.metadata.reason` (closed set, engine-authored via `buildResult`):
 *       clarification_asked | modify_cart | escalation_clarification_retry_exceeded | ...
 *   - `result.source` (ResponseSource) + `result.metadata.matchedNames/matchedPrices/
 *     productIds` — hanya untuk produk (engine `tryProduct` DB `searchProducts` match,
 *     bukan keyword).
 *
 * Enrichment payload (options / cart items / stock+imageUrl) dibaca **read-only** dari
 * state authoritative engine yang sudah persisted:
 *   - quick_reply.options  ← canonicalConversationStateService.getV1PendingClarification (G2-D.2)
 *   - cart.items/total     ← orderService.getOrdersByConversation (draft order)
 *   - product.stock/imageUrl ← productService.getProductById
 *
 * Delivery layer HANYA *membaca* state tersebut (enrichment), TIDAK memindahkan
 * business logic, TIDAK menambah lock, TIDAK menambah DB query klasifikasi.
 */
export type StructuredMessageType = 'text' | 'product' | 'product_list' | 'cart' | 'quick_reply' | 'button' | 'order' | 'checkout' | 'image' | 'system' | 'handoff' | 'payment' | 'notification';
export interface StructuredMessage {
    messageType: StructuredMessageType;
    messagePayload: Record<string, unknown> | null;
}
/**
 * Inventory otoritatif (inspection repositori):
 *
 * - Engine TIDAK PERNAH menulis `conversation_history.messageType` (schema:176 —
 *   selalu NULL sekarang). Kolom ada; delivery yang UPDATE row (HARD RULE #4).
 * - `result.metadata.reason` adalah sumber otoritatif eksklusif untuk
 *   quick_reply/cart/handoff (closed set, engine-authored via `buildResult`):
 *     clarification_asked | modify_cart | escalation_clarification_retry_exceeded
 *   | resolver_retry | resolver_no_llm | rollback | dead_end_fallback
 * - Produk: `tryProduct` (fallback.service) memanggil `productService.searchProducts`
 *   (DB) dan mengembalikan `source: ResponseSource.PRODUCT` + metadata
 *   `{ productIds, matchedNames, matchedPrices }` — match produk otoritatif, bukan keyword.
 *   `createResult` menaruhnya di `result.metadata` (result-level) SEKALIGUS `message.metadata`
 *   (jadi persist juga pada row). `buildModifyCartResult` memakai `source: PRODUCT` tapi
 *   sudah tertangkap dulu oleh `reason: modify_cart` → cart.
 * - Catalog listing (`tryCatalog`, source=CATALOG): hanya `productCount`, tidak ada item
 *   array authoritatif → text.
 * - `result.source === 'ai'` / intent / `cartOpsExecuted` bukan bukti klasifikasi
 *   (HARD RULE #16).
 */
/**
 * Kelasifikasi **pure** (sinkron, tanpa DB) berdasarkan sinyal engine di `result`.
 * Langkah pertama `mapStructured`; dipakai juga unit-test type-decision.
 */
export declare function classifyStructured(result: ResponseResult | null): {
    messageType: StructuredMessageType;
    basePayload: Record<string, unknown> | null;
};
/**
 * Enrichment read-only (DB) untuk melengkapi `basePayload` dengan state
 * authoritative engine yang sudah persisted. Jika gagal → text
 * (failure-safe, HARD RULE #9: tidak ada INSERT kedua, tidak boleh gagalkan request).
 */
export declare function mapStructured(result: ResponseResult | null, conversationId: string): Promise<StructuredMessage>;
//# sourceMappingURL=structured-message.mapper.d.ts.map