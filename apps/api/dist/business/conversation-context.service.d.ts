import type { ConversationContextData, ConversationContextInput, ConversationMessage, ExtractedEntity, ExtractedEntities, ConfirmedItem, PendingClarification } from '../domain/types.js';
export declare class ConversationContextService {
    /**
     * Inisialisasi (upsert) context percakapan di tabel conversation_context.
     * Membuat sessionKey SHA256 baru dan sessionExpireAt (default 60 menit).
     */
    initializeContext(input: ConversationContextInput): Promise<ConversationContextData>;
    /**
     * Ambil context percakapan. Sesi yang kedaluwarsa tetapi memiliki barang
     * di keranjang (confirmedItems) dipertahankan selama 24 jam.
     */
    getContext(conversationId: string): Promise<ConversationContextData | null>;
    /**
     * Merge entitas baru ke extractedEntities yang sudah ada.
     * Dedup berdasarkan type:value, entitas dengan confidence lebih tinggi menang.
     */
    updateExtractedEntities(conversationId: string, entities: ExtractedEntity[]): Promise<void>;
    /**
     * Set intent pengguna pada context.
     */
    updateUserIntent(conversationId: string, intent: 'browse' | 'purchase' | 'support' | 'inquiry'): Promise<void>;
    /**
     * Tambah pesan ke lastMessages context, otomatis memangkas ke 10 pesan terakhir.
     */
    appendMessage(conversationId: string, message: ConversationMessage): Promise<void>;
    /**
     * Perpanjang masa berlaku sesi (default 60 menit lagi).
     */
    refreshSession(conversationId: string, sessionExpireMinutes?: number): Promise<void>;
    /**
     * Update info pengiriman (nama penerima & alamat) di extractedEntities.
     */
    updateShippingInfo(conversationId: string, recipientName?: string | null, shippingAddress?: string | null): Promise<void>;
    /**
     * Parse kolom JSON extractedEntities sebagai objek ExtractedEntities.
     */
    parseExtractedEntities(raw: unknown): ExtractedEntities;
    /**
     * Hapus context percakapan. Operasi non-kritikal — error dibiarkan
     * tidak dilempar jika context memang tidak ada.
     */
    deleteContext(conversationId: string): Promise<void>;
    /**
     * Modifikasi keranjang belanja (confirmedItems) secara atomik.
     *
     * Mendukung 3 aksi:
     *  - 'remove'  : hapus item berdasarkan productName (fuzzy match)
     *  - 'swap'    : hapus cancelledProduct, tambah/update addedProduct dengan qty/price baru
     *  - 'add'     : tambah atau update qty item yang sudah ada (dedup by name fuzzy match)
     *
     * Mengembalikan list confirmedItems SETELAH modifikasi.
     */
    modifyCart(conversationId: string, action: 'add' | 'remove' | 'swap', opts: {
        cancelledProduct?: string;
        addedProduct?: string;
        qty?: number;
        price?: number;
    }): Promise<ConfirmedItem[]>;
    /** BAGIAN 2.1 — Set pending clarification state, WAJIB sebelum kirim question */
    setPendingClarification(conversationId: string, clarification: Omit<PendingClarification, 'asked_at' | 'retry_count'>): Promise<void>;
    /** BAGIAN 2.2 — Get pending clarification (if any) */
    getPendingClarification(entities: ExtractedEntities): PendingClarification | null;
    /** BAGIAN 2.3 — Clear pending clarification */
    clearPendingClarification(conversationId: string): Promise<void>;
    /** BAGIAN 2.4 — Increment retry_count; return true if exceeded (>1) */
    incrementClarificationRetry(conversationId: string): Promise<boolean>;
    /** BAGIAN 1.4 — Rollback: restore cart to a previous snapshot */
    restoreCart(conversationId: string, snapshot: any[]): Promise<ConfirmedItem[]>;
    /** Generate session key deterministik per conversationId */
    private generateSessionKey;
    /** Map row Prisma mentah ke ConversationContextData */
    private mapToContextData;
    /** Parse kolom JSON lastMessages dengan toleransi error */
    private parseMessages;
    /** Parse kolom JSON extractedEntities dengan toleransi error */
    private parseEntities;
    /**
     * Merge entitas lama + baru:
     * - Dedup berdasarkan type:value
     * - Entitas dengan confidence lebih tinggi menang
     */
    private mergeEntities;
}
export declare const conversationContextService: ConversationContextService;
//# sourceMappingURL=conversation-context.service.d.ts.map