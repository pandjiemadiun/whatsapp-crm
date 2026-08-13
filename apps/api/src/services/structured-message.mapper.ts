import type { ResponseResult } from '../domain/types.js';

/**
 * FASE 2 — Structured Message mapping (Web delivery).
 *
 * AUTHORITATIVE-ONLY (HARD RULE #5/#15/#16).
 *
 * `mapStructured` adalah pure function: TIDAK mengakses DB, TIDAK memanggil
 * engine, TIDAK melakukan string/keyword/regex/AI-source heuristic. Ia HANYA
 * memetakan sinyal yang DIDESHKAN engine ke `result.metadata` — khususnya
 * `reason`, sebuah closed-set yang di-authoring engine melalui `buildResult`
 * (business/conversation.service.ts).
 *
 * Inventory otoritatif (inspection repositori):
 * - Engine TIDAK PERNAH menulis `conversation_history.messageType` (schema:176 —
 *   selalu NULL sekarang). Kolom ada; delivery yang mungkin mengisinya (HARD RULE #4).
 * - Engine TIDAK mengekspor product/cart/order/checkout/button/image payload pada
 *   `result` atau `result.message.metadata`:
 *     * `buildResult` (:1008) tidak set `msg.metadata`; `InterpreterResult.cart_ops`
 *       dan `llmResult.clarification.options` dieksekusi/dipersisted ke *context*
   *   (bukan result), lalu hanya `content` (teks balasan) + `metadata.reason`
   *   yang sampai ke caller.
 * - Sinyal authoritatif tunggal pada Web path = `result.metadata.reason`:
 *     'clarification_asked' | 'modify_cart' | 'escalation_clarification_retry_exceeded'
 *     | 'resolver_retry' | 'resolver_no_llm' | 'rollback' | 'dead_end_fallback'
 *
 * Mapped (otoritatif, 1:1 dengan engine-authored reason):
 *   clarification_asked                        -> quick_reply  (engine bertanya + pilihan di context)
 *   modify_cart                                -> cart         (engine eksekusi cart_ops; state di DB)
 *   escalation_clarification_retry_exceeded    -> handoff      (engine serahkan ke manusia)
 * Semua sisa reason + setiap reason AI reply_draft (hanya content+source+intent,
 * tanpa reason) -> text. product/product_list/order/checkout/button/image/
 * payment/notification -> text (tidak ada authoritative payload; jangan heuristic).
 *
 * Karena tidak ada payload struktural product/cart yang terbawa ke result,
 * `messagePayload` hanya berisi data otoritatif yang ADA di result (reason/content/
 * cartOpsExecuted). Enrichment payload yang kaya (ops quick_reply, item cart dari DB)
 * disoroti sebagai FASE 2+ bila dibutuhkan, dengan tetap dibatasi pada authoritative source.
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
  /**
   * `messageType` = nilai yang akan ditulis ke `conversation_history.messageType`
   * (UPDATE same row). 'text' adalah fallback otoritatif ketiada sinyal lain.
   */
  messageType: StructuredMessageType;
  /**
   * `messagePayload` = nilai yang akan ditulis ke
   * `conversation_history.metadata.messagePayload` (merge-preserve existing metadata).
   * Berisi data otoritatif yang tersedia di result; null bila tidak ada (text).
   */
  messagePayload: Record<string, unknown> | null;
}

const AUTHORITATIVE_REASONS: Record<string, StructuredMessageType> = {
  clarification_asked: 'quick_reply',
  modify_cart: 'cart',
  escalation_clarification_retry_exceeded: 'handoff',
};

/**
 * Canonical structured mapping.
 *
 * - result null/empty (human_takeover) → text (delivery handle null terpisah pada
 *   `pending_human`; mapper tetap aman untuk null).
 * - reason authoritatif → type berkorespondensi; payload = data otoritatif di result.
 * - selain itu → text (HARD RULE #5/#14: tidak ada authoritative source = text yang benar).
 */
export function mapStructured(result: ResponseResult | null): StructuredMessage {
  if (!result || !result.message?.content) {
    return { messageType: 'text', messagePayload: null };
  }

  const meta = result.metadata || {};
  const reason = typeof meta.reason === 'string' ? (meta.reason as string) : undefined;
  const mapped = reason ? AUTHORITATIVE_REASONS[reason] : undefined;

  if (!mapped) {
    // termasuk reason: resolver_retry | resolver_no_llm | rollback | dead_end_fallback,
    // dan AI reply_draft (reason undefined, hanya content+source+intent).
    // intent/source TIDAK dipakai untuk klasifikasi (HARD RULE #16: source==='ai' bukan bukti).
    return { messageType: 'text', messagePayload: null };
  }

  const content = result.message.content;
  const payload: Record<string, unknown> = { reason, content };
  if (reason === 'modify_cart') {
    payload.cartOpsExecuted = Number(meta.cartOpsExecuted ?? 0);
  }

  return { messageType: mapped, messagePayload: payload };
}
