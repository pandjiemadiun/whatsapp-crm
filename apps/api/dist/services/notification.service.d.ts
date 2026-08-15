import { type EventEnvelope } from './event-bus.service.js';
/**
 * FASE 4 — Web Push notification SIGNAL service (NOT a message transport).
 *
 * Boundary (owner rule):
 *  - Socket.IO = primary realtime message transport.
 *  - Web Push = notification signal only (title/body/deep-link).
 *  - Push MUST NOT INSERT conversation_history, MUST NOT create a message bubble,
 *    MUST NOT replace Socket.IO. A push is only fired when the customer has NO
 *    active customer Socket.IO presence in the conversation (online customers
 *    therefore never get a duplicate signal — they get the WS message.created).
 *
 * Trigger (owner rule "Primary notification-worthy event"):
 *  - HUMAN AGENT -> WEB CUSTOMER, published as `message.created` with
 *    `sender === 'human_agent'`. AI/assistant and customer-echo messages are
 *    explicitly NOT pushed (no notification storm).
 *
 * Reuses the established EventBus boundary; this service consumes `message.created`
 * (NOT a new custom event) and decides internally whether a push is warranted.
 * No `push.notification.created` / `webpush.created` events are invented.
 *
 * Delivery-layer only: imports prisma + realtimeService + eventBus + web-push.
 * It does NOT import the Conversation Engine.
 */
export interface PushPayload {
    conversationId: string;
    messageId: string;
    title: string;
    body: string;
    url: string;
    timestamp: string;
}
interface MessageCreatedLike {
    id: string;
    conversationId: string;
    sender: 'assistant' | 'customer' | 'human_agent';
    type: string;
    content: string | null;
    createdAt: Date | string;
    storeSlug?: string;
}
export declare const notificationService: {
    vapidConfigured: boolean;
    /** Configure Web Push + subscribe to message.created. Must run after RealtimeService.init. */
    init(): void;
    isVapidConfigured(): boolean;
    /** Resolve the customer's persisted push subscription (server-authoritative). */
    getSubscription(customerId: string): Promise<unknown | null>;
    /**
     * FASE 4 eligibility algorithm (owner spec).
     * Returns true ONLY when: subscription exists AND customer is NOT online on WS.
     */
    shouldPush(params: {
        storeId: string;
        conversationId: string;
        customerId: string;
    }): Promise<{
        push: boolean;
        reason: string;
    }>;
    buildPayload(d: MessageCreatedLike): PushPayload;
    handleMessageCreated(env: EventEnvelope): Promise<void>;
};
export {};
//# sourceMappingURL=notification.service.d.ts.map