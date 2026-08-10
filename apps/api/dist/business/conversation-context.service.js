import crypto from 'crypto';
import { prisma } from '../infrastructure/prisma.js';
import { adapters } from '../adapters/container.js';
import { ApiError } from '../errors/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
/** Jumlah maksimal pesan yang disimpan di lastMessages */
const MAX_CONTEXT_MESSAGES = 10;
/** Durasi sesi default (menit) */
const DEFAULT_SESSION_MINUTES = 60;
/** Maksimal percobaan optimistic lock sebelum memberi up (T4 fix P3.4). */
const ATOMIC_MAX_ATTEMPTS = 5;
/** Backoff ms per attempt (jitter sederhana). */
const ATOMIC_BACKOFF_MS = [0, 25, 50, 100, 200];
export class ConversationContextService {
    /**
     * Inisialisasi (upsert) context percakapan di tabel conversation_context.
     * Membuat sessionKey SHA256 baru dan sessionExpireAt (default 60 menit).
     */
    async initializeContext(input) {
        const sessionKey = this.generateSessionKey(input.conversationId);
        const expireMinutes = input.sessionExpireMinutes ?? DEFAULT_SESSION_MINUTES;
        const sessionExpireAt = new Date(Date.now() + expireMinutes * 60000);
        try {
            const raw = await prisma.conversationContext.upsert({
                where: { conversationId: input.conversationId },
                update: {
                    sessionKey,
                    sessionExpireAt,
                },
                create: {
                    conversationId: input.conversationId,
                    lastMessages: [],
                    extractedEntities: {},
                    sessionKey,
                    sessionExpireAt,
                },
            });
            adapters.logger.info('Conversation context initialized', { conversationId: input.conversationId });
            return this.mapToContextData(raw);
        }
        catch (error) {
            adapters.logger.error('Failed to initialize conversation context', error, { conversationId: input.conversationId });
            throw new ApiError(ErrorCodes.ERR_DB, 'Failed to initialize conversation context');
        }
    }
    /**
     * Ambil context percakapan. Sesi yang kedaluwarsa tetapi memiliki barang
     * di keranjang (confirmedItems) dipertahankan selama 24 jam.
     */
    async getContext(conversationId) {
        try {
            const raw = await prisma.conversationContext.findUnique({
                where: { conversationId },
            });
            if (!raw)
                return null;
            if (raw.sessionExpireAt.getTime() < Date.now()) {
                const entities = this.parseExtractedEntities(raw.extractedEntities);
                if (entities.confirmedItems && entities.confirmedItems.length > 0) {
                    adapters.logger.info('Conversation context expired but has active cart items, extending session by 24h', { conversationId });
                    const extendedExpire = new Date(Date.now() + 24 * 60 * 60000);
                    await prisma.conversationContext
                        .update({
                        where: { conversationId },
                        data: { sessionExpireAt: extendedExpire },
                    })
                        .catch(() => { });
                    return this.mapToContextData({ ...raw, sessionExpireAt: extendedExpire });
                }
                adapters.logger.debug('Conversation context expired, deleting', { conversationId });
                await prisma.conversationContext
                    .delete({ where: { conversationId } })
                    .catch(() => { });
                return null;
            }
            return this.mapToContextData(raw);
        }
        catch (error) {
            adapters.logger.error('Failed to get conversation context', error, { conversationId });
            return null;
        }
    }
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
    async updateExtractedEntities(conversationId, entities) {
        if (!entities?.length)
            return;
        const persisted = await this.atomicCas(conversationId, 'updateExtractedEntities', async (row) => {
            const existing = this.parseExtractedEntities(row.extractedEntities);
            const merged = this.mergeTrackedEntities(existing, entities);
            const result = await prisma.conversationContext.updateMany({
                where: { conversationId, updatedAt: row.updatedAt },
                data: { extractedEntities: merged },
            });
            return { count: result.count, value: merged };
        });
        if (persisted) {
            adapters.logger.debug('Extracted entities updated', { conversationId, tracked: persisted.trackedEntities?.length ?? 0 });
        }
    }
    /**
     * Persist WorkspaceV2 (v3.2) ke kolom terpisah `workspace_v2` (JSON nullable).
     * T1 fix (P3.1): workspace v2 tidak pernah tersimpan sebelumnya — semua "persist"
     * lewat updateExtractedEntities yang NO-OP karena type mismatch (WorkspaceV2
     * object tidak punya .length, sehingga guard `if (!entities.length) return`
     * langsung return). Kolom baru memutuskan v2 dari legacy extractedEntities.
     *
     * T4 fix (P3.4): write lewat atomicCas (optimistic lock @updatedAt) sehingga
     * dua turn v2 yang hampir bersamaan tidak saling menimpa diam-diam.
     */
    async updateWorkspaceV2(conversationId, workspace) {
        await this.atomicCas(conversationId, 'updateWorkspaceV2', async (row) => {
            const result = await prisma.conversationContext.updateMany({
                where: { conversationId, updatedAt: row.updatedAt },
                data: { workspace_v2: workspace },
            });
            return { count: result.count, value: null };
        });
        adapters.logger.debug('Workspace v2 persisted', { conversationId });
    }
    /**
     * Set intent pengguna pada context.
     */
    async updateUserIntent(conversationId, intent) {
        try {
            await prisma.conversationContext.update({
                where: { conversationId },
                data: { userIntent: intent },
            });
            adapters.logger.debug('User intent updated', { conversationId, intent });
        }
        catch (error) {
            adapters.logger.error('Failed to update user intent', error, { conversationId });
        }
    }
    /**
     * Tambah pesan ke lastMessages context, otomatis memangkas ke 10 pesan terakhir.
     */
    async appendMessage(conversationId, message) {
        try {
            const raw = await prisma.conversationContext.findUnique({
                where: { conversationId },
            });
            if (!raw)
                return;
            const messages = this.parseMessages(raw.lastMessages);
            messages.push(message);
            const trimmed = messages.slice(-MAX_CONTEXT_MESSAGES);
            await prisma.conversationContext.update({
                where: { conversationId },
                data: { lastMessages: trimmed },
            });
        }
        catch (error) {
            adapters.logger.error('Failed to append message to context', error, { conversationId });
        }
    }
    /**
     * Perpanjang masa berlaku sesi (default 60 menit lagi).
     */
    async refreshSession(conversationId, sessionExpireMinutes) {
        const minutes = sessionExpireMinutes ?? DEFAULT_SESSION_MINUTES;
        const sessionExpireAt = new Date(Date.now() + minutes * 60000);
        try {
            await prisma.conversationContext.update({
                where: { conversationId },
                data: { sessionExpireAt },
            });
            adapters.logger.debug('Session refreshed', { conversationId, sessionExpireAt });
        }
        catch (error) {
            adapters.logger.error('Failed to refresh session', error, { conversationId });
        }
    }
    /**
     * Update info pengiriman (nama penerima & alamat) di extractedEntities.
     * Via atomicCas (T4 fix) — tidak menimpa field lain (confirmedItems/
     * pendingClarification/trackedEntities).
     */
    async updateShippingInfo(conversationId, recipientName, shippingAddress) {
        const updated = await this.atomicCas(conversationId, 'updateShippingInfo', async (row) => {
            const entities = this.parseExtractedEntities(row.extractedEntities);
            if (recipientName !== undefined && recipientName !== null)
                entities.recipientName = recipientName;
            if (shippingAddress !== undefined && shippingAddress !== null)
                entities.shippingAddress = shippingAddress;
            const result = await prisma.conversationContext.updateMany({
                where: { conversationId, updatedAt: row.updatedAt },
                data: { extractedEntities: entities },
            });
            return { count: result.count, value: result.count > 0 };
        });
        if (updated) {
            adapters.logger.debug('Shipping info updated in context', { conversationId, recipientName, shippingAddress });
        }
    }
    /**
     * Parse kolom JSON extractedEntities sebagai objek ExtractedEntities.
     * Toleransi untuk legacy ARRAY (T2): bila kolom berupa array, kembalikan
     * default kosong (array tidak lagi ditulis — P3.3 kanonik OBJECT).
     * Membawa `trackedEntities` + `previousMutation` agar penulis object lain
     * (modifyCart/setPendingClarification/fallback) tidak menimppadnya.
     */
    parseExtractedEntities(raw) {
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            const parsed = raw;
            return {
                discussedItems: Array.isArray(parsed.discussedItems) ? parsed.discussedItems : [],
                confirmedItems: Array.isArray(parsed.confirmedItems) ? parsed.confirmedItems : [],
                lastAmbiguousPrompt: typeof parsed.lastAmbiguousPrompt === 'string' ? parsed.lastAmbiguousPrompt : null,
                recipientName: typeof parsed.recipientName === 'string' ? parsed.recipientName : null,
                shippingAddress: typeof parsed.shippingAddress === 'string' ? parsed.shippingAddress : null,
                pendingClarification: parsed.pendingClarification || null,
                previousMutation: parsed.previousMutation ?? null,
                trackedEntities: Array.isArray(parsed.trackedEntities) ? parsed.trackedEntities : [],
            };
        }
        return {
            discussedItems: [],
            confirmedItems: [],
            lastAmbiguousPrompt: null,
            recipientName: null,
            shippingAddress: null,
            pendingClarification: null,
            previousMutation: null,
            trackedEntities: [],
        };
    }
    /**
     * Hapus context percakapan. Operasi non-kritikal — error dibiarkan
     * tidak dilempar jika context memang tidak ada.
     */
    async deleteContext(conversationId) {
        try {
            await prisma.conversationContext.delete({ where: { conversationId } });
            adapters.logger.debug('Conversation context deleted', { conversationId });
        }
        catch {
            adapters.logger.debug('Conversation context delete skipped (not found)', { conversationId });
        }
    }
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
    async modifyCart(conversationId, action, opts) {
        const cart = await this.atomicCas(conversationId, 'modifyCart', async (row) => {
            const entities = this.parseExtractedEntities(row.extractedEntities);
            let items = entities.confirmedItems ?? [];
            /** Fuzzy match: apakah nama item mengandung kata kunci target */
            const fuzzyMatch = (itemName, target) => {
                const a = itemName.toLowerCase().trim();
                const b = target.toLowerCase().trim();
                if (a === b)
                    return true;
                if (a.includes(b) || b.includes(a))
                    return true;
                const words = b.split(/\s+/).filter(w => w.length > 1);
                return words.some(w => a.includes(w));
            };
            // 1. Hapus cancelledProduct dari cart (untuk 'remove' dan 'swap')
            if ((action === 'remove' || action === 'swap') && opts.cancelledProduct) {
                items = items.filter(i => !fuzzyMatch(i.product, opts.cancelledProduct));
            }
            // 2. Tambah / update addedProduct (untuk 'add' dan 'swap')
            if ((action === 'add' || action === 'swap') && opts.addedProduct) {
                const existingIdx = items.findIndex(i => fuzzyMatch(i.product, opts.addedProduct));
                if (existingIdx >= 0) {
                    // Update qty jika item sudah ada
                    const existing = items[existingIdx];
                    items[existingIdx] = {
                        ...existing,
                        qty: opts.qty ?? (typeof existing.qty === 'number' ? existing.qty : 1),
                        price: opts.price ?? existing.price,
                        confirmedAt: existing.confirmedAt ?? new Date().toISOString(),
                        mentionedAt: existing.mentionedAt ?? new Date().toISOString(),
                    };
                }
                else {
                    // Tambah item baru
                    const now = new Date().toISOString();
                    items.push({
                        product: opts.addedProduct,
                        qty: opts.qty ?? 1,
                        price: opts.price ?? 0,
                        confirmedAt: now,
                        mentionedAt: now,
                    });
                }
            }
            // Simpan hasil modifikasi
            entities.confirmedItems = items;
            adapters.logger.info('Cart modified via modifyCart()', { conversationId, action, itemCount: items.length });
            const res = await prisma.conversationContext.updateMany({
                where: { conversationId, updatedAt: row.updatedAt },
                data: { extractedEntities: entities },
            });
            return { count: res.count, value: items };
        });
        return cart ?? [];
    }
    /** BAGIAN 2.1 — Set pending clarification state, WAJIB sebelum kirim question */
    async setPendingClarification(conversationId, clarification) {
        await this.atomicCas(conversationId, 'setPendingClarification', async (row) => {
            const entities = this.parseExtractedEntities(row.extractedEntities);
            entities.pendingClarification = {
                question: clarification.question,
                options: clarification.options,
                expected_type: clarification.expected_type,
                asked_at: new Date().toISOString(),
                retry_count: 0,
            };
            const res = await prisma.conversationContext.updateMany({
                where: { conversationId, updatedAt: row.updatedAt },
                data: { extractedEntities: entities },
            });
            adapters.logger.info('Pending clarification set', { conversationId, question: clarification.question });
            return { count: res.count, value: null };
        });
    }
    /** BAGIAN 2.2 — Get pending clarification (if any) */
    getPendingClarification(entities) {
        return entities.pendingClarification ?? null;
    }
    /** BAGIAN 2.3 — Clear pending clarification */
    async clearPendingClarification(conversationId) {
        await this.atomicCas(conversationId, 'clearPendingClarification', async (row) => {
            const entities = this.parseExtractedEntities(row.extractedEntities);
            entities.pendingClarification = null;
            const res = await prisma.conversationContext.updateMany({
                where: { conversationId, updatedAt: row.updatedAt },
                data: { extractedEntities: entities },
            });
            adapters.logger.info('Pending clarification cleared', { conversationId });
            return { count: res.count, value: null };
        });
    }
    /** BAGIAN 2.4 — Increment retry_count; return true if exceeded (>1) */
    async incrementClarificationRetry(conversationId) {
        const exceeded = await this.atomicCas(conversationId, 'incrementClarificationRetry', async (row) => {
            const entities = this.parseExtractedEntities(row.extractedEntities);
            const pc = entities.pendingClarification;
            // tidak ada pending → tidak perlu menulis (terminal, tidak retry)
            if (!pc)
                return { count: null, value: false };
            pc.retry_count = (pc.retry_count ?? 0) + 1;
            entities.pendingClarification = pc;
            const res = await prisma.conversationContext.updateMany({
                where: { conversationId, updatedAt: row.updatedAt },
                data: { extractedEntities: entities },
            });
            return { count: res.count, value: pc.retry_count > 1 };
        });
        return exceeded ?? false;
    }
    /** BAGIAN 1.4 — Rollback: restore cart to a previous snapshot */
    async restoreCart(conversationId, snapshot) {
        const restored = await this.atomicCas(conversationId, 'restoreCart', async (row) => {
            const entities = this.parseExtractedEntities(row.extractedEntities);
            entities.confirmedItems = snapshot;
            const res = await prisma.conversationContext.updateMany({
                where: { conversationId, updatedAt: row.updatedAt },
                data: { extractedEntities: entities },
            });
            adapters.logger.info('Cart rolled back to snapshot', { conversationId, itemCount: snapshot.length });
            return { count: res.count, value: snapshot };
        });
        return restored ?? [];
    }
    // ============================================================
    // Private helpers
    // ============================================================
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
    async atomicCas(conversationId, operation, writer) {
        for (let attempt = 0; attempt <= ATOMIC_MAX_ATTEMPTS; attempt++) {
            let row;
            try {
                row = await prisma.conversationContext.findUnique({
                    where: { conversationId },
                    select: { extractedEntities: true, updatedAt: true },
                });
            }
            catch (error) {
                adapters.logger.error('atomicCas read failed', error, { conversationId, operation });
                return null;
            }
            if (!row) {
                adapters.logger.debug('Context not found, skipping atomic update', { conversationId, operation });
                return null;
            }
            let outcome;
            try {
                outcome = await writer(row);
            }
            catch (error) {
                adapters.logger.error('atomicCas write failed', error, { conversationId, operation });
                return null;
            }
            // count === null → writer memutuskan tidak perlu menulis (terminal)
            if (outcome.count === null)
                return outcome.value;
            // count > 0 → committed
            if (outcome.count > 0) {
                adapters.logger.debug('Atomic update committed', { conversationId, operation, attempt });
                return outcome.value;
            }
            // count === 0 → writer lain menang (updatedAt berubah) → retry
            if (attempt < ATOMIC_MAX_ATTEMPTS) {
                const wait = ATOMIC_BACKOFF_MS[attempt] ?? 200;
                adapters.logger.warn('Optimistic lock conflict, retrying', { conversationId, operation, attempt, wait });
                await new Promise((r) => setTimeout(r, wait));
            }
        }
        adapters.logger.error('Optimistic lock conflict exhausted retries', { conversationId, operation });
        return null;
    }
    /** Generate session key deterministik per conversationId */
    generateSessionKey(conversationId) {
        return crypto.createHash('sha256').update(`${conversationId}:${Date.now()}`).digest('hex');
    }
    /** Map row Prisma mentah ke ConversationContextData */
    mapToContextData(raw) {
        return {
            id: raw.id,
            conversationId: raw.conversationId,
            lastMessages: this.parseMessages(raw.lastMessages),
            extractedEntities: this.parseExtractedEntities(raw.extractedEntities),
            userIntent: raw.userIntent ?? null,
            sessionKey: raw.sessionKey,
            sessionExpireAt: raw.sessionExpireAt,
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
        };
    }
    /** Parse kolom JSON lastMessages dengan toleransi error */
    parseMessages(raw) {
        if (Array.isArray(raw))
            return raw;
        return [];
    }
    /**
     * Merge token entitas mentah (ExtractedEntity[]) ke dalam field
     * `trackedEntities` object ExtractedEntities — semantik dedup per type:value
     * & confidence-wins dipertahankan, tapi ditulis sebagai OBJECT (kanonik P3.3)
     * sehingga tidak menimpa/kosongkan field lain (confirmedItems/pendingClarification).
     */
    mergeTrackedEntities(existing, incoming) {
        const map = new Map();
        for (const e of existing.trackedEntities ?? [])
            map.set(`${e.type}:${e.value}`, e);
        for (const e of incoming) {
            const key = `${e.type}:${e.value}`;
            const current = map.get(key);
            if (!current || (e.confidence ?? 0) > (current.confidence ?? 0)) {
                map.set(key, e);
            }
        }
        return { ...existing, trackedEntities: Array.from(map.values()) };
    }
}
export const conversationContextService = new ConversationContextService();
//# sourceMappingURL=conversation-context.service.js.map