import { type EventEnvelope } from './event-bus.service.js';
/**
 * Merchant-side Web Push notification service.
 *
 * Boundary:
 *  - Scoped to Store sessions (authMiddleware, req.user.storeId).
 *  - Fires ONLY for a store's OWN events — strict tenant isolation.
 *  - Dedupes against admin socket presence (store:{storeId}:admin room).
 *    If the merchant's dashboard tab is actively connected, skip push.
 *
 * Triggers:
 *  - order.created — new customer order
 *  - order.payment_verification_pending — customer reported payment
 *  - message.created (customer→admin direction, sender === 'customer') — new customer message
 */
export interface OrderCreatedLike {
    orderId: string;
    storeId: string;
    total?: number;
    itemCount?: number;
}
export interface PaymentPendingLike {
    orderId: string;
    storeId: string;
    total?: number;
}
export interface CustomerMessageLike {
    id: string;
    conversationId: string;
    sender: 'assistant' | 'customer' | 'human_agent';
    content: string | null;
    storeId: string;
    customerName?: string;
}
export declare const merchantPushService: {
    init(): void;
    handleOrderCreated(env: EventEnvelope): Promise<void>;
    handlePaymentPending(env: EventEnvelope): Promise<void>;
    handleCustomerMessage(env: EventEnvelope): Promise<void>;
};
//# sourceMappingURL=merchant-push.service.d.ts.map