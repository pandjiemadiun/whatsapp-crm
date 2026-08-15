import { ResponseResult, ConversationStats, ConversationWithContext } from '../domain/types.js';
interface ConversationListItem {
    id: string;
    customerId: string;
    customerName: string | null;
    customerPhone: string | null;
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
    processCustomerMessage(storeId: string, customerId: string, conversationId: string, customerMessage: string, channel?: 'whatsapp' | 'web'): Promise<ResponseResult | null>;
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
     * Menggunakan CartAuthority.executeOps sebagai single authoritative path
     * yang menulis OrderItem rows, Order.items JSON, dan confirmedItems JSON
     * atomically dalam satu $transaction.
     * I15: hanya dipanggil setelah validateCartOps mengembalikan valid.
     */
    private executeCartOps;
    /**
     * Baca snapshot keranjang terkonfirmasi.
     * G2-D.2 Part C: V1 cart read. V1 writes still go to extractedEntities.confirmedItems
     * (write migration is G2-D.5). getCartAsConfirmedItems would miss V1 writes that
     * haven't created draft Orders yet. Until writes migrate, read from extractedEntities
     * to stay consistent with V1 modifyCart writes.
     * TODO (G2-D.5): After V1 modifyCart → CartAuthority, switch to getCartAsConfirmedItems.
     */
    private getCartFromDb;
    /**
     * BAGIAN 2.4 — Store previousCart snapshot untuk rollback.
     *
     * G2-D.6: Canonical (workspace_v2) is PRIMARY authority via
     * writeV1PreviousMutation. The extractedEntities write is backward-compat
     * mirror (kept for legacy readers/tests, atomic via atomicCas).
     */
    private storePreviousMutation;
    /** BAGIAN 2.5 — Render cart state dari DB (bukan dari memory) */
    private renderCartSummary;
    private buildModifyCartResult;
    private buildResult;
    private getOrCreateContext;
    private saveMessage;
    private updateConversationStats;
    /**
     * TASK C1 (Stage 2): tandai conversation butuh perhatian manusia pada titik
     * ESCALATE/terminal (clarification retry terbatasi). Reuses konvensi existing:
     * status='human_takeover' + humanTakeoverAt (routes/conversations.ts:88,
     * circuit-breaker message-processor.service.ts:491).
     *
     * Alasan aman (tidak menimbonloop): cabang ESCALATE/terminal di panggil di
     * akhir turn dan tidak pernah memicu LLM lagi di turn yang sama; serta guard
     * di line 80 akan me-skip semua balasan AI sampai owner reset status lewat
     * PUT /api/conversations/:id/status. Jadi tidak ada retry otomatis ke dalam
     * loop ini. (Catatan line ~1051 tentang "jangan auto-set pada AI failure
     * biasa" tetap berlaku untuk jalur non-escalate.)
     */
    private markHumanTakeover;
    /**
     * Ambil percakapan lengkap termasuk context dan orders (dengan items).
     */
    getConversationWithContext(conversationId: string): Promise<ConversationWithContext | null>;
    /**
     * Buat percakapan baru + inisialisasi context-nya sekaligus.
     */
    createConversation(storeId: string, customerId: string, customerPhone: string, customerName?: string, channel?: 'whatsapp' | 'web'): Promise<ConversationWithContext>;
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
    private logPipelineAudit;
    private flattenPendingOps;
    private deriveResolvedCartOps;
    /**
     * Clear previousMutation snapshot.
     *
     * G2-D.6: Canonical (workspace_v2) is PRIMARY via clearV1PreviousMutation.
     * The extractedEntities write is backward-compat mirror (atomic CAS).
     */
    private clearPreviousMutation;
}
export declare const conversationService: ConversationService;
export {};
//# sourceMappingURL=conversation.service.d.ts.map