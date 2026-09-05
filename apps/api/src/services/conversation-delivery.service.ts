import { conversationService } from '../business/conversation.service.js';
import { messageQueueService } from './message-queue.service.js';
import { eventBus } from './event-bus.service.js';
import { adapters } from '../adapters/container.js';
import { prisma } from '../infrastructure/prisma.js';
import {
  mapStructured,
  type StructuredMessage,
  type StructuredMessageType,
} from './structured-message.mapper.js';
import type { ResponseResult, ResponseSource } from '../domain/types.js';
import { fireShadowV2Call } from '../services/chat/v2-engine/shadow-wiring.js';

/**
 * FASE 1 — Web realtime foundation.
 *
 * `conversationDeliveryService` adalah SEPUTTER wrapper di LUAR Conversation Engine.
 *
 * HARD RULE (owner):
 *  - Hanya ada SATU `acquireLock()` per Web request, dan LOCK OWNER adalah service
 *    ini — bukan `routes/pwa.ts`. pwa.ts hanya meneruskan request ke sini.
 *  - Engine tetap satu‑satunya yang compose+persist (processCustomerMessage /
 *    saveMessage). Delivery layer HANYA *mengamati* result, publish event,
 *    dan mengembalikan messageId.
 *  - Tidak ada persistence kedua: `message.id` (conversation_history.id) tetap
 *    satu identity = HTTP messageId = WS event.data.id.
 *  - Event dipublish SETELAH release lock (persist sudah selesai) sehingga tidak
 *    menyebabkan re‑entry processing dan tidak memleak lock.
 */

export interface MessageCreatedData {
  id: string;
  conversationId: string;
  sender: 'assistant' | 'customer' | 'human_agent';
  type: StructuredMessageType;
  /**
   * Structured payload (FASE 2) — berasal dari `StructuredMessage.messagePayload`,
   * sama persis di HTTP response dan WS `message.created` (HARD RULE #11/#12 kanonis).
   * null bila tidak ada (text).
   */
  payload: Record<string, unknown> | null;
  content: string;
  source: ResponseSource;
  confidence: number | null;
  createdAt: Date;
}

export type DeliveryResult =
  | {
      kind: 'ok';
      conversationId: string;
      messageId: string;
      content: string;
      source: ResponseSource;
      confidence: number | null;
      createdAt: Date;
      /** FASE 2: canonical structured type/payload (sama HTTP + WS). */
      type: StructuredMessageType;
      payload: Record<string, unknown> | null;
    }
  | { kind: 'locked'; conversationId: string }
  | { kind: 'pending_human'; conversationId: string };

export interface WebRequestProps {
  storeId: string;
  customerId: string;
  conversationId: string;
  message: string;
}

export const conversationDeliveryService = {
  /**
   * Web request path: acquireLock (SATU) -> engine (persist) -> release -> publish.
   * pwa.ts MUST NOT call acquireLock() directly.
   */
  async processWebRequest(props: WebRequestProps): Promise<DeliveryResult> {
    const { storeId, customerId, conversationId, message } = props;

    // --- SATU LOCK, dimiliki delivery service ---
    const release = messageQueueService.acquireLock(conversationId);
    if (!release) {
      return { kind: 'locked', conversationId };
    }

    let result: ResponseResult | null;
    // CRITICAL RULE #3 (FASE 3): identify the customer message WHILE the lock is still held.
    // The engine (processCustomerMessage) persists the customer message (role='user') but
    // its return value only carries the assistant reply — it does NOT expose the customer
    // message id. We read that row here, inside the lock boundary (release() is still in the
    // `finally` below), so a concurrent request for the SAME conversation cannot win the race
    // and return a different "latest" message. Doing the query AFTER release() would be
    // racy (forbidden by the contract WARNING).
    let customerMsg: { id: string; content: string; createdAt: Date } | null = null;
    try {
      // ENGINE: compose + persist (saveMessage :1074 memakai id=message.id :1078).
      // Delivery TIDAK memanggil engine dengan cara lain & TIDAK menambah lock.
      result = await conversationService.processCustomerMessage(
        storeId,
        customerId,
        conversationId,
        message,
        'web',
      );
      // Read the customer message persisted by THIS request — safe karena lock masih
      // dipegang (acquireLock di atas, release() di finally di bawah).
      customerMsg = await prisma.conversationHistory.findFirst({
        where: { conversationId, role: 'user' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, content: true, createdAt: true },
      });
    } finally {
      // Release SELESAI setelah persist (engine sudah commit). Order target:
      // process -> persist -> release -> publish -> response
      release();
    }

    // --- post-lock: publish domain event (tidak re-enter processing) ---
    if (!result || !result.message?.content) {
      // human_takeover guard (conversation.service.ts:81) — tidak ada balasan AI.
      // FASE 3: publish the customer message that triggered the escalation, THEN handoff.
      // customerMsg was identified while-locked above (deterministic, no race).
      if (customerMsg) {
        eventBus.publish({
          event: 'message.created',
          storeId,
          data: {
            id: customerMsg.id,
            conversationId,
            sender: 'customer',
            type: 'text',
            payload: null,
            content: customerMsg.content,
            source: 'customer',
            confidence: null,
            createdAt: customerMsg.createdAt,
          },
          ts: Date.now(),
        });
      }
      eventBus.publish({
        event: 'conversation.handoff',
        storeId,
        data: { conversationId, status: 'human_takeover' },
        ts: Date.now(),
      });
      eventBus.publish({
        event: 'conversation.updated',
        storeId,
        data: {
          conversationId,
          status: 'human_takeover',
          lastMessageAt: customerMsg?.createdAt ?? new Date(),
        },
        ts: Date.now(),
      });
      return { kind: 'pending_human', conversationId };
    }

    const msg = result.message;

    // ── FASE 2: Structured enrichment — UPDATE baris YANG SAMA (id = msg.id) ──
    // HARD RULE #3/#4/#7/#9: satu INSERT (oleh engine); delivery UPDATE same row
    // SET messageType + metadata.messagePayload (merge-preserve existing metadata).
    // Sumber otoritatif SATU‑SATUNYA = result.metadata.reason (engine-authored lewat
    // buildResult). Tidak ada → text. Jika UPDATE gagal → tetap text, TIDAK ada INSERT
    // kedua, dan request tidak gagal (failure-safe).
    // FASE 2 (patch): mapStructured async — classify (pure) + enrichment read-only
    // (conversationContext.orderService/productService) untuk options/cart items/stock+imageUrl.
    // Enrichment throw → text (failure-safe). Tetap tiada lock tambahan, tiada INSERT kedua.
    const structured: StructuredMessage = await mapStructured(result, conversationId);
    let messageType = structured.messageType;
    let messagePayload: Record<string, unknown> | null = structured.messagePayload;
    try {
      const existing = await prisma.conversationHistory.findUnique({
        where: { id: msg.id },
        select: { metadata: true },
      });
      const existingMeta =
        existing && existing.metadata && typeof existing.metadata === 'object'
          ? (existing.metadata as Record<string, unknown>)
          : {};
      // merge-preserve: jangan overwrite existing metadata (HARD RULE #7).
      const mergedMeta: Record<string, unknown> = { ...existingMeta };
      if (messagePayload !== null) {
        mergedMeta.messagePayload = messagePayload;
      }
      await prisma.conversationHistory.update({
        where: { id: msg.id },
        data: {
          messageType,
          // mergedMeta berisi nilai JSON (dari row existing + messagePayload);
          // Prisma JSON input menolak `Record<string,unknown>` secara tipis → cast.
          metadata: mergedMeta as any,
        },
      });
    } catch (e) {
      // Failure-safe (HARD RULE #9): jangan INSERT kedua; baris engine tetap ada
      // sebagai text. Paksa type=text agar HTTP + WS konsisten dengan state row.
      adapters.logger.warn('FASE 2 structured update failed — falling back to text', {
        messageId: msg.id,
        error: e instanceof Error ? e.message : String(e),
      });
      messageType = 'text';
      messagePayload = null;
    }

    const eventData: MessageCreatedData = {
      id: msg.id, // = conversation_history.id (SAVE satu baris oleh engine)
      conversationId,
      sender: 'assistant',
      type: messageType, // FASE 2: otoritatif dari engine (reason), bukan aman default
      payload: messagePayload,
      content: msg.content,
      source: result.source,
      confidence: result.confidence,
      createdAt: msg.createdAt,
    };

    // FASE 3: publish the customer message.created FIRST (deterministic id captured while
    // lock was held), then the assistant reply, then conversation.updated — order per
    // CRITICAL RULE #3 (customer -> assistant -> conversation.updated).
    if (customerMsg) {
      eventBus.publish({
        event: 'message.created',
        storeId,
        data: {
          id: customerMsg.id,
          conversationId,
          sender: 'customer',
          type: 'text',
          payload: null,
          content: customerMsg.content,
          source: 'customer',
          confidence: null,
          createdAt: customerMsg.createdAt,
        },
        ts: Date.now(),
      });
    }

    try {
      // PENTING: UPDATE row harus selesai SEBELUM publish (HARD RULE #19) —
      // klien tidak pernah melihat type=text lalu berubah ke product untuk id yang sama.
      eventBus.publish({
        event: 'message.created',
        storeId,
        data: eventData,
        ts: Date.now(),
      });
    } catch (e) {
      // Event tidak boleh menggagalkan HTTP response — persist (engine) adalah
      // sumber kebenaran; WS hanya transport. Client catchup via GET /history.
      adapters.logger.error('delivery message.created publish failed', e as Error);
    }

    try {
      eventBus.publish({
        event: 'conversation.updated',
        storeId,
        data: {
          conversationId,
          status: 'open',
          lastMessageAt: msg.createdAt,
          lastMessageId: msg.id,
        },
        ts: Date.now(),
      });
    } catch (e) {
      adapters.logger.error('delivery conversation.updated publish failed', e as Error);
    }

    // ─────────────────────────────────────────────────────────────────
    // P2-UNIT5: Fire-and-forget V2 shadow call
    // AFTER V1 reply is fully processed (persist + publish). Never blocks,
    // never affects V1 customer response. Total try-catch inside
    // fireShadowV2Call. Only fires for chatEngine.v2Mode==='shadow'
    // AND storeId === store-4f4f67bd.
    // ─────────────────────────────────────────────────────────────────
    fireShadowV2Call({
      storeId,
      conversationId,
      customerMessage: message, // original request from PWA
      v1Reply: msg.content,     // V1's actual reply (already persisted + published)
    }).catch((err) => {
      adapters.logger.error('P2-UNIT5 shadow wiring: unhandled rejection (PWA)', err as Error);
    });

    return {
      kind: 'ok',
      conversationId,
      messageId: msg.id,
      content: msg.content,
      source: result.source,
      confidence: result.confidence,
      createdAt: msg.createdAt,
      type: messageType,
      payload: messagePayload,
    };
  },
};
