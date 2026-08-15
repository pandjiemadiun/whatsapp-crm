/**
 * FASE 1 — Contract Foundation.
 *
 * EventBus = in-process domain event (Node EventEmitter).
 *
 * Batasan eksplisit (lihat DOCS/contract-chatbox.md §0b, §11):
 *  - HANYA within-process: engine/delivery -> realtime delivery.
 *  - Socket.IO Redis Adapter (room sync antar instance) adalah HAL TERPISAH,
 *    bukan pengganti EventBus ini, dan TIDAK aktif pada single-instance MVP.
 *  - EventBus TIDAK melakukan: persistence, AI execution, mutex acquisition,
 *    retry, atau pub/sub eksternal.
 *  - Untuk single VPS: EventBus + Socket.IO (in-proc subscribe) sudah cukup.
 */
export type ChatbotEventType = 'message.created' | 'typing.started' | 'typing.stopped' | 'conversation.handoff' | 'conversation.resumed' | 'conversation.resolved' | 'conversation.updated' | 'notification.created' | 'device.status.changed';
export interface EventEnvelope<D = unknown> {
    event: ChatbotEventType;
    storeId: string;
    data: D;
    ts: number;
}
/**
 * publish() adalah sinkron (EventEmitter). Consumer (realtime.service) melakukan
 * emit WS secara sync/async — sekalipun emit gagal, tidak boleh mengganngi
 * engine/delivery yang sedang menyelesaikan request.
 */
export declare const eventBus: {
    publish(env: EventEnvelope): void;
    /** @returns unsubscribe function */
    subscribe<T = unknown>(event: ChatbotEventType, listener: (env: EventEnvelope<T>) => void): () => void;
};
//# sourceMappingURL=event-bus.service.d.ts.map