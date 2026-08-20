import { ResponseSource } from '../domain/types.js';
import type {
  ClarificationOption,
  OrderItem,
  ResponseResult,
} from '../domain/types.js';
import { conversationContextService } from '../business/conversation-context.service.js';
import { canonicalConversationStateService } from '../business/canonical-context.service.js';
import { orderService } from '../business/order.service.js';
import { productService } from '../business/product.service.js';
import { adapters } from '../adapters/container.js';

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

export type StructuredMessageType =
  | 'text'
  | 'product'
  | 'product_list'
  | 'cart'
  | 'quick_reply'
  | 'button'
  | 'order'
  | 'checkout'
  | 'image'
  | 'system'
  | 'handoff'
  | 'payment'
  | 'notification';

export interface StructuredMessage {
  messageType: StructuredMessageType;
  messagePayload: Record<string, unknown> | null;
}

/** Ringkasan keranjang dari draft order (authoritative). */
interface CartSummary {
  items: Array<{
    id: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }>;
  total: number | null;
  orderId?: string;
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.length > 0;
}
function toArray<T>(x: unknown): T[] {
  if (Array.isArray(x)) return x as T[];
  return x ? [x as T] : [];
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
export function classifyStructured(
  result: ResponseResult | null,
): { messageType: StructuredMessageType; basePayload: Record<string, unknown> | null } {
  if (!result || !result.message?.content) {
    return { messageType: 'text', basePayload: null };
  }
  const meta = result.metadata || {};
  const reason = isNonEmptyString(meta.reason) ? (meta.reason as string) : undefined;
  const content = result.message.content;

  if (reason === 'escalation_clarification_retry_exceeded') {
    return { messageType: 'handoff', basePayload: { reason, content } };
  }
  if (reason === 'clarification_asked') {
    return { messageType: 'quick_reply', basePayload: { reason, question: content } };
  }
  if (reason === 'modify_cart') {
    return {
      messageType: 'cart',
      basePayload: { reason, cartOpsExecuted: Number(meta.cartOpsExecuted ?? 0) },
    };
  }

  if (result.source === ResponseSource.PRODUCT && meta.matchedNames) {
    const names = toArray<string>(meta.matchedNames);
    const ids = toArray<string>(meta.productIds);
    const prices = toArray<number | null>(meta.matchedPrices);
    if (names.length >= 2) {
      return {
        messageType: 'product_list',
        basePayload: {
          items: names.map((n, i) => ({ id: ids[i] ?? null, name: n, price: prices[i] ?? null })),
        },
      };
    }
    if (names.length === 1) {
      return { messageType: 'product', basePayload: { id: ids[0] ?? null, name: names[0], price: prices[0] ?? null } };
    }
  }

  // CATALOG intent (engine-authored: ResponseSource.CATALOG from tryCatalog) WITH a
  // structured `items` array authored by tryCatalog from productService.listActiveProducts
  // → product_list (>=2) / product (1). HARD RULE #5/#16: hanya sinyal engine-authored
  // (result.source + meta.items yang di-generate DB, bukan keyword/regex/AI-source).
  if (result.source === ResponseSource.CATALOG && Array.isArray(meta.items)) {
    const items = toArray<Record<string, unknown>>(meta.items);
    if (items.length >= 2) {
      return {
        messageType: 'product_list',
        basePayload: {
          items: items.map((it) => ({ id: it.id ?? null, name: it.name ?? null, price: it.price ?? null })),
        },
      };
    }
    if (items.length === 1) {
      return { messageType: 'product', basePayload: { id: items[0].id ?? null, name: items[0].name ?? null, price: items[0].price ?? null } };
    }
  }

  // resolver_retry | resolver_no_llm | rollback | dead_end_fallback | dead_end_detected
  // | AI reply_draft (reason undefined, hanya content+source+intent)
  // | catalog (productCount only, TANPA items array) | order_status/total/shipping/payment/faq/cache/knowledge/sop
  // -> text (intent/source tidak dipakai klasifikasi; HARD RULE #16/#5).
  return { messageType: 'text', basePayload: null };
}

/**
 * Enrichment read-only (DB) untuk melengkapi `basePayload` dengan state
 * authoritative engine yang sudah persisted. Jika gagal → text
 * (failure-safe, HARD RULE #9: tidak ada INSERT kedua, tidak boleh gagalkan request).
 */
export async function mapStructured(
  result: ResponseResult | null,
  conversationId: string,
): Promise<StructuredMessage> {
  if (!result || !result.message?.content) {
    return { messageType: 'text', messagePayload: null };
  }

  const classified = classifyStructured(result);
  const base = classified.basePayload ?? {};

  try {
    switch (classified.messageType) {
      case 'quick_reply': {
        const options = await fetchClarificationOptions(conversationId);
        // HARD RULE (patch FINAL): quick_reply hanya valid bila authoritative options tersedia.
        // options undefined / kosong → text (JANGAN fabricate options dari content/keyword/regex/LLM).
        if (!options || options.length === 0) return { messageType: 'text', messagePayload: null };
        return { messageType: 'quick_reply', messagePayload: { reason: base.reason, question: base.question, options } };
      }
      case 'cart': {
        const cart = await fetchCart(conversationId);
        // HARD RULE: cart hanya boleh menjadi `cart` bila ada items valid; kosong → text.
        if (!cart.items.length) return { messageType: 'text', messagePayload: null };
        return { messageType: 'cart', messagePayload: { ...base, items: cart.items, total: cart.total, orderId: cart.orderId } };
      }
      case 'product': {
        return { messageType: 'product', messagePayload: await enrichProduct(base) };
      }
      case 'product_list': {
        const items = Array.isArray(base.items) ? (base.items as Array<Record<string, unknown>>) : [];
        const enriched = await Promise.all(items.map((it) => enrichProduct(it)));
        return { messageType: 'product_list', messagePayload: { items: enriched } };
      }
      case 'handoff':
        return { messageType: 'handoff', messagePayload: base };
      default:
        return { messageType: 'text', messagePayload: null };
    }
  } catch (e) {
    adapters.logger.warn('FASE 2 enrichment failed — falling back to text', {
      conversationId,
      reason: classified.messageType === 'text' ? undefined : classified.basePayload?.reason,
      error: e instanceof Error ? e.message : String(e),
    });
    return { messageType: 'text', messagePayload: null };
  }
}

// ── Read-only enrichment helpers (authoritative engine state) ──────────────

/** quick_reply options: baca PendingClarification dari canonical state (read-only, G2-D.2). */
async function fetchClarificationOptions(conversationId: string): Promise<ClarificationOption[]> {
  const pending = await canonicalConversationStateService.getV1PendingClarification(conversationId);
  if (!pending?.options) return [];
  return pending.options;
}

/** cart state: draft order (authoritative) milik conversation. */
async function fetchCart(conversationId: string): Promise<CartSummary> {
  const orders = await orderService.getOrdersByConversation(conversationId);
  const active = orders.find((o) => o.orderStatus === 'draft') ?? orders[0];
  if (!active) return { items: [], total: null };
  const items = (active.items ?? []).map((it: OrderItem) => ({
    id: it.id,
    productName: it.productName,
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    subtotal: it.subtotal,
  }));
  const total = active.totalPrice ?? items.reduce((s, it) => s + Number(it.subtotal ?? 0), 0);
  return { items, total, orderId: active.id };
}

/** product public fields: id/name/price dari result metadata, stock+imageUrl dari DB (1 fetch). */
async function enrichProduct(base: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = base.id;
  const price = base.price ?? null;
  const name = base.name;
  const prod = isNonEmptyString(id) ? await productService.getProductById(id as string) : null;
  return {
    id: prod?.id ?? id ?? null,
    name: prod?.name ?? name ?? null,
    price: prod?.price ?? price ?? null,
    stock: prod?.stock ?? null,
    imageUrl: prod?.primaryImageUrl ?? null,
  };
}
