import { ResponseResult, ConversationStats, ConversationWithContext } from '../domain/types.js';
interface ConversationListItem {
    id: string;
    customerId: string;
    customerName: string | null;
    customerPhone: string;
    status: string;
    lastMessageAt: Date | null;
    aiResponseCount: number;
    faqResponseCount: number;
}
interface ConversationDetail extends ConversationListItem {
    history: Array<{
        id: string;
        role: string;
        content: string;
        source: string | null;
        createdAt: Date;
    }>;
}
export declare class ConversationService {
    processCustomerMessage(storeId: string, customerId: string, conversationId: string, customerMessage: string): Promise<ResponseResult | null>;
    /**
     * Bungkus teks balasan MODIFY_CART menjadi ResponseResult standar.
     */
    /**
     * Ambil daftar produk aktif toko sebagai { name, price, stock }.
     * Dipakai I12 (guard normalizer) + validasi interpreter (validateCartOps).
     */
    private getStoreProducts;
    /**
     * Bangun PipelineContext (biru) dari ConversationContext DB + relasi.
     * messages sudah termasuk pesan pelanggan terbaru (dari getOrCreateContext).
     */
    private buildPipelineContext;
    /**
     * Execute (add / remove) validated cart_ops ke DB, lalu sync ke draft order.
     * Untuk remove, snapshot cart sebelum mutasi agar negasi -> rollback masih
     * memungkinkan. I15: hanya dipanggil setelah validateCartOps mengembalikan valid.
     */
    private executeCartOps;
    /**
     * Baca snapshot keranjang terkonfirmasi dari DB (extractedEntities).
     */
    private getCartFromDb;
    /** BAGIAN 2.4 — Store previousCart snapshot untuk rollback */
    private storePreviousMutation;
    /** BAGIAN 2.5 — Render cart state dari DB (bukan dari memory) */
    private renderCartSummary;
    private buildModifyCartResult;
    private buildResult;
    private getOrCreateContext;
    private saveMessage;
    private updateConversationStats;
    /**
     * Ambil percakapan lengkap termasuk context dan orders (dengan items).
     */
    getConversationWithContext(conversationId: string): Promise<ConversationWithContext | null>;
    /**
     * Buat percakapan baru + inisialisasi context-nya sekaligus.
     */
    createConversation(storeId: string, customerId: string, customerPhone: string, customerName?: string): Promise<ConversationWithContext>;
    /**
     * Simpan pesan ke conversation_history DAN sinkronkan ke context
     * (appendMessage + refreshSession).
     */
    appendMessageWithContext(conversationId: string, role: string, content: string): Promise<void>;
    /**
     * Update status percakapan. Jika 'resolved', set resolvedAt.
     */
    updateConversationStatus(conversationId: string, status: string): Promise<void>;
    /**
     * Ambil percakapan terbuka terbaru (default 50), termasuk context & orders.
     */
    getRecentConversations(storeId: string, limit?: number): Promise<ConversationWithContext[]>;
    private mapConversationWithContext;
    getConversationStats(conversationId: string): Promise<ConversationStats>;
    findAllByStore(storeId: string): Promise<ConversationListItem[]>;
    findByIdWithHistory(id: string): Promise<ConversationDetail | null>;
}
export declare const conversationService: ConversationService;
export {};
//# sourceMappingURL=conversation.service.d.ts.map