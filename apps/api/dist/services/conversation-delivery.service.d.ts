import { type StructuredMessageType } from './structured-message.mapper.js';
import type { ResponseSource } from '../domain/types.js';
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
export type DeliveryResult = {
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
} | {
    kind: 'locked';
    conversationId: string;
} | {
    kind: 'pending_human';
    conversationId: string;
};
export interface WebRequestProps {
    storeId: string;
    customerId: string;
    conversationId: string;
    message: string;
}
export declare const conversationDeliveryService: {
    /**
     * Web request path: acquireLock (SATU) -> engine (persist) -> release -> publish.
     * pwa.ts MUST NOT call acquireLock() directly.
     */
    processWebRequest(props: WebRequestProps): Promise<DeliveryResult>;
};
//# sourceMappingURL=conversation-delivery.service.d.ts.map