import crypto from 'crypto';
import { prisma } from '../infrastructure/prisma.js';
import { adapters } from '../adapters/container.js';
import { ApiError } from '../errors/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
/** Jumlah maksimal pesan yang disimpan di lastMessages */
const MAX_CONTEXT_MESSAGES = 10;
/** Durasi sesi default (menit) */
const DEFAULT_SESSION_MINUTES = 60;
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
                    extractedEntities: [],
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
     * Dedup berdasarkan type:value, entitas dengan confidence lebih tinggi menang.
     */
    async updateExtractedEntities(conversationId, entities) {
        if (!entities.length)
            return;
        try {
            const raw = await prisma.conversationContext.findUnique({
                where: { conversationId },
            });
            if (!raw) {
                adapters.logger.debug('Context not found, skipping entity update', { conversationId });
                return;
            }
            const existing = this.parseEntities(raw.extractedEntities);
            const merged = this.mergeEntities(existing, entities);
            await prisma.conversationContext.update({
                where: { conversationId },
                data: { extractedEntities: merged },
            });
            adapters.logger.debug('Extracted entities updated', { conversationId, count: merged.length });
        }
        catch (error) {
            adapters.logger.error('Failed to update extracted entities', error, { conversationId });
        }
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
     */
    async updateShippingInfo(conversationId, recipientName, shippingAddress) {
        try {
            const raw = await prisma.conversationContext.findUnique({
                where: { conversationId },
            });
            if (!raw)
                return;
            const entities = this.parseExtractedEntities(raw.extractedEntities);
            if (recipientName !== undefined && recipientName !== null)
                entities.recipientName = recipientName;
            if (shippingAddress !== undefined && shippingAddress !== null)
                entities.shippingAddress = shippingAddress;
            await prisma.conversationContext.update({
                where: { conversationId },
                data: { extractedEntities: entities },
            });
            adapters.logger.debug('Shipping info updated in context', { conversationId, recipientName, shippingAddress });
        }
        catch (error) {
            adapters.logger.error('Failed to update shipping info in context', error, { conversationId });
        }
    }
    /**
     * Parse kolom JSON extractedEntities sebagai objek ExtractedEntities.
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
            };
        }
        return {
            discussedItems: [],
            confirmedItems: [],
            lastAmbiguousPrompt: null,
            pendingClarification: null,
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
        try {
            const raw = await prisma.conversationContext.findUnique({
                where: { conversationId },
                select: { extractedEntities: true },
            });
            if (!raw)
                return [];
            const entities = this.parseExtractedEntities(raw.extractedEntities);
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
            await prisma.conversationContext.update({
                where: { conversationId },
                data: { extractedEntities: entities },
            });
            adapters.logger.info('Cart modified via modifyCart()', { conversationId, action, itemCount: items.length });
            return items;
        }
        catch (error) {
            adapters.logger.error('Failed to modify cart', error, { conversationId });
            return [];
        }
    }
    /** BAGIAN 2.1 — Set pending clarification state, WAJIB sebelum kirim question */
    async setPendingClarification(conversationId, clarification) {
        try {
            const raw = await prisma.conversationContext.findUnique({
                where: { conversationId },
                select: { extractedEntities: true },
            });
            const entities = this.parseExtractedEntities(raw?.extractedEntities);
            entities.pendingClarification = {
                question: clarification.question,
                options: clarification.options,
                expected_type: clarification.expected_type,
                asked_at: new Date().toISOString(),
                retry_count: 0,
            };
            await prisma.conversationContext.update({
                where: { conversationId },
                data: { extractedEntities: entities },
            });
            adapters.logger.info('Pending clarification set', { conversationId, question: clarification.question });
        }
        catch (error) {
            adapters.logger.error('Failed to set pending clarification', error, { conversationId });
        }
    }
    /** BAGIAN 2.2 — Get pending clarification (if any) */
    getPendingClarification(entities) {
        return entities.pendingClarification ?? null;
    }
    /** BAGIAN 2.3 — Clear pending clarification */
    async clearPendingClarification(conversationId) {
        try {
            const raw = await prisma.conversationContext.findUnique({
                where: { conversationId },
                select: { extractedEntities: true },
            });
            const entities = this.parseExtractedEntities(raw?.extractedEntities);
            entities.pendingClarification = null;
            await prisma.conversationContext.update({
                where: { conversationId },
                data: { extractedEntities: entities },
            });
            adapters.logger.info('Pending clarification cleared', { conversationId });
        }
        catch (error) {
            adapters.logger.error('Failed to clear pending clarification', error, { conversationId });
        }
    }
    /** BAGIAN 2.4 — Increment retry_count; return true if exceeded (>1) */
    async incrementClarificationRetry(conversationId) {
        try {
            const raw = await prisma.conversationContext.findUnique({
                where: { conversationId },
                select: { extractedEntities: true },
            });
            const entities = this.parseExtractedEntities(raw?.extractedEntities);
            const pc = entities.pendingClarification;
            if (!pc)
                return false;
            pc.retry_count = (pc.retry_count ?? 0) + 1;
            entities.pendingClarification = pc;
            await prisma.conversationContext.update({
                where: { conversationId },
                data: { extractedEntities: entities },
            });
            return pc.retry_count > 1;
        }
        catch {
            return false;
        }
    }
    /** BAGIAN 1.4 — Rollback: restore cart to a previous snapshot */
    async restoreCart(conversationId, snapshot) {
        try {
            const ctxRow = await prisma.conversationContext.findUnique({
                where: { conversationId },
                select: { extractedEntities: true },
            });
            const entities = this.parseExtractedEntities(ctxRow?.extractedEntities);
            entities.confirmedItems = snapshot;
            await prisma.conversationContext.update({
                where: { conversationId },
                data: {
                    extractedEntities: entities,
                },
            });
            adapters.logger.info('Cart rolled back to snapshot', { conversationId, itemCount: snapshot.length });
            return snapshot;
        }
        catch (error) {
            adapters.logger.error('Failed to rollback cart', error, { conversationId });
            return [];
        }
    }
    // ============================================================
    // Private helpers
    // ============================================================
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
            extractedEntities: this.parseEntities(raw.extractedEntities),
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
    /** Parse kolom JSON extractedEntities dengan toleransi error */
    parseEntities(raw) {
        if (Array.isArray(raw))
            return raw;
        return [];
    }
    /**
     * Merge entitas lama + baru:
     * - Dedup berdasarkan type:value
     * - Entitas dengan confidence lebih tinggi menang
     */
    mergeEntities(existing, incoming) {
        const map = new Map();
        for (const e of existing)
            map.set(`${e.type}:${e.value}`, e);
        for (const e of incoming) {
            const key = `${e.type}:${e.value}`;
            const current = map.get(key);
            if (!current || (e.confidence ?? 0) > (current.confidence ?? 0)) {
                map.set(key, e);
            }
        }
        return Array.from(map.values());
    }
}
export const conversationContextService = new ConversationContextService();
//# sourceMappingURL=conversation-context.service.js.map