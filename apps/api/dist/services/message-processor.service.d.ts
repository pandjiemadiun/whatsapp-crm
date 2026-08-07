export interface ProcessedResult {
    message: string;
    source: 'cache' | 'faq' | 'knowledge' | 'ai' | 'human' | 'dead_end' | 'product' | 'shipping' | 'payment' | 'sop';
    confidence: number;
    cost: number;
    requiresHumanReview: boolean;
    elapsedMs: number;
    usedCircuitBreaker: boolean;
    usedFallback: boolean;
}
export interface ProcessMessageInput {
    storeId: string;
    customerId: string;
    customerPhone: string;
    customerName?: string;
    conversationId: string;
    text: string;
    messageId: string;
    gateway: 'gowa' | 'fonnte';
    deviceId?: string;
    token?: string;
    inboxId?: number;
    storeTimezone?: string;
}
export declare class MessageProcessorService {
    private llmCircuitBreaker;
    constructor();
    /**
     * Entry point: process a single inbound message through the full pipeline.
     * Called by webhook handlers (GOWA / Fonnte).
     */
    processMessage(input: ProcessMessageInput): Promise<ProcessedResult | null>;
    /**
     * Handle flushed message from coalescing buffer (timer fired).
     * Reconstructs ProcessMessageInput from the buffered message and processes.
     */
    private handleFlushed;
    /**
     * Process a message while holding the per-chat mutex lock.
     */
    private processWithLock;
    /**
     * 8. Presence simulation + proportional delay + smart retry send.
     */
    private sendWithPresence;
    /**
     * Mark message as read (for dead-end messages dan presence flow).
     */
    private markRead;
    /**
     * 9. QRIS follow-up — kirim gambar QRIS atau teks link tergantung gateway dan paket Fonnte.
     * - Fonnte free plan (fonnteMediaEnabled !== true): kirim teks link, JANGAN coba image.
     * - Fonnte paid plan (fonnteMediaEnabled = true): coba sendImage, fallback ke teks link.
     * - GOWA: coba native image, fallback ke teks link.
     * Semua jalur gagal → log warn.
     */
    private sendQrisFollowUp;
    /**
     * Smart retry dengan bounded exponential backoff.
     * Schedule: 10s, 30s, 2m → drop setelah 3 kegagalan.
     */
    private smartRetrySend;
    /**
     * Mark conversation for human takeover (circuit breaker terbuka).
     */
    private notifyHumanTakeover;
    private getGateway;
    private sleep;
    /** Graceful shutdown — drain pending buffers + reset state */
    shutdown(): Promise<void>;
    /** Public access to circuit breaker metrics */
    getCircuitBreakerMetrics(): {
        state: import("./circuit-breaker.service.js").CircuitState;
        failureCount: number;
        successCount: number;
        name: string;
    };
}
export declare const messageProcessorService: MessageProcessorService;
//# sourceMappingURL=message-processor.service.d.ts.map