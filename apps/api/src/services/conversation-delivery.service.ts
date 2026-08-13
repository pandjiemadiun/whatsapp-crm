import { conversationService } from '../business/conversation.service.js';
import { messageQueueService } from './message-queue.service.js';
import { eventBus } from './event-bus.service.js';
import { adapters } from '../adapters/container.js';
import type { ResponseResult, ResponseSource } from '../domain/types.js';

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
  type: 'text' | 'product' | 'product_list' | 'cart' | 'quick_reply' | 'button' |
    'order' | 'checkout' | 'image' | 'system' | 'handoff' | 'payment' | 'notification';
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
    } finally {
      // Release SELESAI setelah persist (engine sudah commit). Order target:
      // process -> persist -> release -> publish -> response
      release();
    }

    // --- post-lock: publish domain event (tidak re-enter processing) ---
    if (!result || !result.message?.content) {
      // human_takeover guard (conversation.service.ts:81) — tidak ada balasan AI.
      // Publish contract handoff (FASE 3 dashboard akan konsumsi; FASE 1 belum ada
      // subscriber UI, jadi tidak ada side effect visible). ConversationId tetap sama.
      eventBus.publish({
        event: 'conversation.handoff',
        storeId,
        data: { conversationId, status: 'human_takeover' },
        ts: Date.now(),
      });
      return { kind: 'pending_human', conversationId };
    }

    const msg = result.message;

    const eventData: MessageCreatedData = {
      id: msg.id, // = conversation_history.id (SAVE satu baris oleh engine)
      conversationId,
      sender: 'assistant',
      type: 'text', // FASE 1: aman default. Mapping structured -> FASE 2.
      content: msg.content,
      source: result.source,
      confidence: result.confidence,
      createdAt: msg.createdAt,
    };

    try {
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

    return {
      kind: 'ok',
      conversationId,
      messageId: msg.id,
      content: msg.content,
      source: result.source,
      confidence: result.confidence,
      createdAt: msg.createdAt,
    };
  },
};
