/**
 * Message Queue Service — kelola antrian per-chat dengan mutex, deduplication,
 * coalescing, dan priority routing.
 *
 * Arsitektur:
 * - Per-chat mutex lock (Set-based — hanya satu processor per chat)
 * - Dedup berdasarkan messageId (LRU cache 5 menit)
 * - Coalescing: buffer text 5-15s, media 10-15s
 * - Priority routing: urgent keywords → proses langsung (bypass buffer)
 */
export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'document';
export interface RawMessage {
    id: string;
    chatId: string;
    storeId: string;
    customerId: string;
    type: MessageType;
    content: string;
    mediaKey?: string;
    receivedAt: number;
}
export interface QueuedMessage extends RawMessage {
    priority: 'normal' | 'urgent';
    attempts: number;
    isUgc: boolean;
    gateway: 'gowa' | 'fonnte';
    deviceId?: string;
    token?: string;
    inboxId?: number;
    storeTimezone?: string;
}
export interface ProcessedMessage {
    id: string;
    chatId: string;
    storeId: string;
    customerId: string;
    type: MessageType;
    content: string;
    mediaKey?: string;
    receivedAt: number;
    priority: 'normal' | 'urgent';
}
export type FlushHandler = (msg: ProcessedMessage, sourceMsg: QueuedMessage) => void;
/** Dead-end detection — pola penutupan yang tidak perlu LLM */
export declare function isDeadEnd(text: string): boolean;
/**
 * Dead-end detection with order-funnel context awareness.
 * Jika AI sebelumnya memberikan kutipan harga / instruksi transfer /
 * konfirmasi order, maka pesan pendek ("ok", "sip") HARUS tetap diproses
 * oleh LLM untuk update state order.
 */
export declare function isDeadEndWithContext(text: string, lastAiMessage?: string): boolean;
/** Cek apakah pesan AI sebelumnya termasuk konteks funnel transaksi */
export declare function isOrderFunnelContext(text: string): boolean;
/** Priority detection — deteksi kata kunci urgent dengan boundary + negation check */
export declare function isUrgent(text: string): boolean;
export declare class MessageQueueService {
    private processingLocks;
    /** Approximate count of unique messageIds tracked in Redis dedup (lifetime). */
    private dedupeTracked;
    private textBuffers;
    private mediaBuffers;
    private flushHandler;
    /** Register handler dipanggil saat buffer timer fires */
    setFlushHandler(handler: FlushHandler): void;
    /** Acquire mutex for a chat — returns release function or null if locked */
    acquireLock(chatId: string): (() => void) | null;
    /**
     * Cek & simpan messageId ke Redis dedup (SET key '1' EX 300 NX).
     * Key: `<storeId>:msg:<messageId>` — tenant-scoped, multi-instance safe.
     * Return true jika DUPLICATE (key sudah ada).
     *
     * Fail-open: jika Redis error, anggap bukan duplicate agar pesan tidak hilang.
     */
    isDuplicate(storeId: string, messageId: string): Promise<boolean>;
    /**
     * Buffer message untuk coalescing.
     * - Text: jika ada media buffer pending untuk user yang sama, gabungkan sebagai caption
     * - Media: buffer untuk batch processing
     *
     * Return true jika berhasil di-buffer (diproses nanti oleh timer).
     * Return false jika caller harus proses langsung (urgent).
     */
    bufferMessage(msg: QueuedMessage): boolean;
    private bufferText;
    private bufferMedia;
    private triggerFlush;
    /** Merge multiple text messages into one */
    private mergeTextMessages;
    /** Merge multiple media messages into a batch */
    private mergeMediaMessages;
    /** Drain pending buffers for a specific chat (used during shutdown) */
    drainChatBuffers(chatId: string): ProcessedMessage[];
    /** Cleanup timers (on shutdown) */
    cleanup(): void;
    /** Stats for monitoring */
    getStats(): {
        activeQueues: number;
        activeLocks: number;
        dedupeCacheSize: number;
        pendingTextBuffers: number;
        pendingMediaBuffers: number;
    };
}
export declare const messageQueueService: MessageQueueService;
//# sourceMappingURL=message-queue.service.d.ts.map