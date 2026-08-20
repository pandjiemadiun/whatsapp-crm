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
     * Shape kanonik P3.3: kolom `extractedEntities` SELALU berupa OBJECT
     * (ExtractedEntities), bukan array. Entitas berupa token mentah
     * (ExtractedEntity[], mis. product/order/quantity/destination dari
     * order.service) digabungkan ke dalam field `trackedEntities` object
     * — tidak lagi menulis array ke kolom yang sama dengan penulis object
     * lain (modifyCart/setPendingClarification/fallback). Dedup by type:value,
     * confidence lebih tinggi menang (semantik lama dipertahankan).
     * Write dilakukan via atomicCas (optimistic lock @updatedAt, T4 fix) — tidak
     * akan menimpa field lain penulis sekaligus (modifyCart/
     * setPendingClarification/fallback) sekaligus karena tidak last-write-wins.
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
     * Atomic CAS untuk kolom `lastMessages` (FIX-4, III-5) — pola SAMA
     * seperti `atomicCas` (updatedAt compare + updateMany count-check +
     * retry max `ATOMIC_MAX_ATTEMPTS`). Mencegah last-write-wins race pada
     * read-modify-write `lastMessages`.
     */
    private atomicCasMessages;
    /**
     * Perpanjang masa berlaku sesi (default 60 menit lagi).
     */
    refreshSession(conversationId: string, sessionExpireMinutes?: number): Promise<void>;
    /**
     * Update info pengiriman (nama penerima & alamat) di extractedEntities.
     * Via atomicCas (T4 fix) — tidak menimpa field lain (confirmedItems/
     * pendingClarification/trackedEntities).
     *
     * G2-D.4: ALSO writes to canonical resolved_facts via writeV1ShippingInfo.
     * Canonical is the authority; extractedEntities is compatibility mirror.
     */
    updateShippingInfo(conversationId: string, recipientName?: string | null, shippingAddress?: string | null): Promise<void>;
    /**
     * Parse kolom JSON extractedEntities sebagai objek ExtractedEntities.
     * Toleransi untuk legacy ARRAY (T2): bila kolom berupa array, kembalikan
     * default kosong (array tidak lagi ditulis — P3.3 kanonik OBJECT).
     * Membawa `trackedEntities` + `previousMutation` agar penulis object lain
     * (modifyCart/setPendingClarification/fallback) tidak menimppadnya.
     *
     * G2-D-L-018 fix: Preserve dynamic/unknown fields (customerCity, customerName,
     * customerPhone, dll) yang tidak ada di typed ExtractedEntities interface.
     * Tanpa preservation ini, write-back via atomicCas akan menghilangkan field
     * dinamis yang ditulis oleh V1 path lain (seperti customerCity dari
     * fallback.service.ts:717). Dynamic fields disimpan di `_unknown` — penulis
     * yang sudah dimigrasi ke canonical (G2-D.4) tidak lagi butuh ini, tapi
     * penulis yang belum dimigrasi (modifyCart, restoreCart — G2-D.5) tetap aman.
     */
    parseExtractedEntities(raw: unknown): ExtractedEntities & {
        _unknown?: Record<string, unknown>;
    };
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
    /**
     * Atomic read-modify-write (T4 fix). Optimistic locking via kolom `updatedAt`
     * (@updatedAt otomatis *bump* tiap write di Prisma).
     *
     * Alur tiap attempt: baca `extractedEntities` + `updatedAt` → panggil `writer`
     * yang melakukan parse+transform lalu `updateMany({ where: { conversationId,
     * updatedAt } })` dan mengembalikan `{ count, value }`. UPDATE PostgreSQL
     * bersifat atomik (compare-and-set): bila ada writer lain yang menyelesaikan
     * dulu, `updatedAt` berubah → where tidak cocok → count 0 → retry dengan state
     * yang sudah di-refresh. **Mencegah last-write-wins / data hilang tanpa memegang
     * row lock** (tidak perlu `SELECT ... FOR UPDATE`, tidak blocking).
     *
     * `updateMany` dipilih karena `where` harus mengandung field non-unique
     * `updatedAt` (`update` hanya boleh `WhereUniqueInput`). `writer` kembalikan
     * `count: null` bila memang tidak perlu menulis (mis. tanpa
     * pendingClarification) → berhenti tanpa retry. Pada Prisma 5.22 `updateMany`
     * tetap me-*bump* `@updatedAt`, jadi optimistic clock tetap naik tiap commit.
     *
     * Konsistensi kontrak resilience: bila context tak ada / konflik tak selesai
     * / error DB → log & kembalikan `null` (tidak throw — sama seperti method
     * sejenis yang ada).
     */
    /**
     * Atomic read-modify-write for extractedEntities (backward-compat legacy column).
     * G2-D.6: Exposed as public so callers in conversation.service.ts can do atomic
     * legacy mirror writes (storePreviousMutation, clearPreviousMutation) instead
     * of non-atomic findUnique+update that risks lost updates.
     */
    atomicCasExtractedEntities<T>(conversationId: string, operation: string, writer: (row: {
        extractedEntities: unknown;
        updatedAt: Date;
    }) => Promise<{
        count: number | null;
        value: T;
    }>): Promise<T | null>;
    atomicCas<T>(conversationId: string, operation: string, writer: (row: {
        extractedEntities: unknown;
        updatedAt: Date;
    }) => Promise<{
        count: number | null;
        value: T;
    }>): Promise<T | null>;
    /** Generate session key deterministik per conversationId */
    private generateSessionKey;
    /** Map row Prisma mentah ke ConversationContextData */
    private mapToContextData;
    /** Parse kolom JSON lastMessages dengan toleransi error */
    private parseMessages;
    /**
     * Merge token entitas mentah (ExtractedEntity[]) ke dalam field
     * `trackedEntities` object ExtractedEntities — semantik dedup per type:value
     * & confidence-wins dipertahankan, tapi ditulis sebagai OBJECT (kanonik P3.3)
     * sehingga tidak menimpa/kosongkan field lain (confirmedItems/pendingClarification).
     */
    private mergeTrackedEntities;
}
export declare const conversationContextService: ConversationContextService;
//# sourceMappingURL=conversation-context.service.d.ts.map