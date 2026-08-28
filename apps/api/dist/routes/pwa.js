import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../infrastructure/prisma.js';
import { conversationLimiter, orderMutationLimiter, pwaInitLimiter, pwaProductsLimiter, pwaShippingOptionsLimiter, } from '../middleware/rate-limiters.js';
import { adapters } from '../adapters/container.js';
import { conversationDeliveryService } from '../services/conversation-delivery.service.js';
import { eventBus } from '../services/event-bus.service.js';
import { productService } from '../business/product.service.js';
import { cartAuthority } from '../business/cart-authority.js';
import { ApiError } from '../errors/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import { ResponseSource } from '../domain/types.js';
import { executeHandoff } from '../services/handoff.service.js';
import { paymentService } from '../business/payment.service.js';
import { cachedShippingCostService } from '../services/shipping/cached-shipping-cost.service.js';
import { getOrderWeightGrams } from '../services/shipping/order-weight.helper.js';
import { RAJAONGKIR_STARTER_COURIERS } from '../services/shipping/rajaongkir.adapter.js';
const router = Router();
/**
 * Web Adapter (P-PWA.8) — endpoint publik untuk PWA Web Customer.
 *
 * Berbeda dengan jalur WA (webhook -> messageProcessorService.processMessage,
 * lalu kirim via gateway WA), endpoint ini memanggil Conversation Engine
 * (`conversationService.processCustomerMessage`) SECARA LANGSUNG dan
 * mengembalikan balasan berupa HTTP response — TIDAK melewati
 * messageProcessor / gateway WA / sendWithPresence.
 *
 * Catatan operasional (blueprint §5):
 * - CORS whitelist belum termasuk origin produksi PWA. Endpoint akan
 *   error CORS dari origin produksi sampai whitelist diperluas (known limitation,
 *   diluar scope TASK ini).
 * - Rate limit (conversationLimiter) dipasang eksplisit di POST /message karena
 *   endpoint publik tanpa auth.
 */
// Public-safe Store fields untuk GET /init (blueprint §4).
// Kolom terlarang yang DIS-eksklusi dari select: phoneNumber, whatsappPhoneId,
// fonnteToken, fonnteNumber, webhookSecret, email (plus config, responseTemplate, dst).
const PWA_STORE_PUBLIC_SELECT = {
    name: true,
    slug: true,
    profilePhotoUrl: true,
    description: true,
    businessCategory: true,
    address: true,
    timezone: true,
    operatingHours: true,
    acceptsQris: true,
    acceptsCod: true,
    acceptsTransfer: true,
    qrisImageUrl: true,
    shippingMode: true,
    shippingFlatInCity: true,
    shippingFlatOutCity: true,
    isActive: true,
};
// GET /api/pwa/:storeSlug/init — resolve Store by slug, kembalikan data publik.
router.get('/:storeSlug/init', pwaInitLimiter, async (req, res) => {
    try {
        const { storeSlug } = req.params;
        if (!storeSlug) {
            return res.status(404).json({ error: 'Store not found' });
        }
        // phoneNumber di-query SECARA INTERNAL hanya untuk membangun contact.whatsappUrl.
        // Tidak pernah di-expose ke response (di-strip sebelum dikembalikan).
        const store = await prisma.store.findUnique({
            where: { slug: storeSlug, deletedAt: null },
            select: {
                ...PWA_STORE_PUBLIC_SELECT,
                phoneNumber: true,
            },
        });
        if (!store) {
            return res.status(404).json({ error: 'Store not found' });
        }
        const { phoneNumber, ...publicStore } = store;
        // Structured contact object (G2-B.5 contract). Null when no WhatsApp number.
        const contact = phoneNumber
            ? {
                channel: 'whatsapp',
                whatsappUrl: `https://wa.me/${phoneNumber.replace(/^\+/, '')}`,
                displayName: store.name,
            }
            : null;
        res.json({
            success: true,
            data: {
                store: publicStore,
                vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null,
                contact,
            },
        });
    }
    catch (err) {
        adapters.logger.error('PWA init error', err);
        res.status(500).json({ error: 'Failed to fetch store' });
    }
});
// GET /api/pwa/:storeSlug/history?uid=<webUid> — riwayat Web Conversation.
// Visitor pertama kali (Customer/Conversation belum ada) -> history kosong, BUKAN 404.
router.get('/:storeSlug/history', pwaProductsLimiter, async (req, res) => {
    try {
        const { storeSlug } = req.params;
        const uid = req.query.uid;
        const store = await prisma.store.findUnique({
            where: { slug: storeSlug, deletedAt: null },
            select: { id: true },
        });
        if (!store) {
            return res.status(404).json({ error: 'Store not found' });
        }
        // uid wajib berupa string; bila tidak ada/tidak valid -> kembalikan history kosong
        // (visitor belum memiliki identitas webUid, kondisi normal).
        const webUid = Array.isArray(uid) ? uid[0] : uid;
        if (!webUid) {
            return res.json({ success: true, data: { history: [] } });
        }
        // Resolve Customer by webUid (dispenskan ke store agar tidak nyelonong ke store lain).
        // Pola resolve-by-webUid belum ada di kode existing (lihat audit P-PWA.5); dibuat di sini.
        const customer = await prisma.customer.findFirst({
            where: { webUid: webUid, storeId: store.id, deletedAt: null },
            select: { id: true },
        });
        if (!customer) {
            // visitor pertama kali — kondisi normal, bukan error
            return res.json({ success: true, data: { history: [] } });
        }
        // Resolve Web Conversation milik Customer+Store (channel='web').
        // conversationId untuk Web adalah UUID (blueprint §1.2), bukan pola storeId:phone.
        const conversation = await prisma.conversation.findFirst({
            where: { storeId: store.id, customerId: customer.id, channel: 'web', deletedAt: null },
            select: { id: true },
        });
        if (!conversation) {
            return res.json({ success: true, data: { history: [] } });
        }
        // Ambil history (channel-agnostic — sudah difilter by conversationId yang benar,
        // pola sama routes/conversations.ts:41-51).
        const history = await prisma.conversationHistory.findMany({
            where: { conversationId: conversation.id },
            orderBy: { createdAt: 'asc' },
            select: {
                id: true,
                role: true,
                content: true,
                source: true,
                messageType: true, // FASE 2: structured type (authoritative engine/delivery)
                metadata: true, // FASE 2: metadata.messagePayload (merge-preserve existing)
                createdAt: true,
            },
        });
        // Normalisasi ke shape kanonis ChatPage (sama dengan WS message.created):
        // type = messageType (default 'text' bila NULL), payload = metadata.messagePayload.
        const safeHistory = history.map((h) => {
            const meta = (h.metadata && typeof h.metadata === 'object'
                ? h.metadata
                : {});
            return {
                id: h.id,
                role: h.role,
                content: h.content,
                source: h.source,
                type: h.messageType ?? 'text',
                payload: meta.messagePayload ?? null,
                createdAt: h.createdAt,
            };
        });
        res.json({ success: true, data: { history: safeHistory, conversationId: conversation.id } });
    }
    catch (err) {
        adapters.logger.error('PWA history error', err);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});
// GET /api/pwa/:storeSlug/products — public product catalog for PWA first-open discovery.
// Reuses productService.getProductsByStore (same authority, same isActive filter).
// Maps to ChatProduct shape (id, name, description, price, stock, primaryImageUrl).
router.get('/:storeSlug/products', pwaProductsLimiter, async (req, res) => {
    try {
        const { storeSlug } = req.params;
        const store = await prisma.store.findUnique({
            where: { slug: storeSlug, deletedAt: null },
            select: { id: true },
        });
        if (!store) {
            return res.status(404).json({ error: 'Store not found' });
        }
        const limit = Math.min(Math.max(1, Number(req.query.limit) || 20), 60);
        const offset = Math.max(0, Number(req.query.offset) || 0);
        const { products, total } = await productService.getProductsByStore(store.id, {
            limit,
            offset,
            sortBy: 'name',
            order: 'asc',
        });
        const mappedProducts = products.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description ?? null,
            price: p.price,
            stock: p.stock,
            primaryImageUrl: p.primaryImageUrl ?? null,
            hasVariants: p.hasVariants,
        }));
        res.json({
            success: true,
            data: {
                products: mappedProducts,
                pagination: {
                    limit,
                    offset,
                    total,
                    hasMore: offset + mappedProducts.length < total,
                },
            },
        });
    }
    catch (err) {
        adapters.logger.error('PWA products error', err);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});
// GET /api/pwa/:storeSlug/products/:productId — public product detail for PWA product card tap.
// Reuses productService.getProductById (authoritative). Returns public fields only.
router.get('/:storeSlug/products/:productId', pwaProductsLimiter, async (req, res) => {
    try {
        const { storeSlug, productId } = req.params;
        const store = await prisma.store.findUnique({
            where: { slug: storeSlug, deletedAt: null },
            select: { id: true },
        });
        if (!store) {
            return res.status(404).json({ error: 'Store not found' });
        }
        const product = await productService.getProductById(productId);
        if (!product || product.storeId !== store.id) {
            return res.status(404).json({ error: 'Product not found' });
        }
        const responseData = {
            id: product.id,
            name: product.name,
            description: product.description ?? null,
            price: product.price,
            stock: product.stock,
            primaryImageUrl: product.primaryImageUrl ?? null,
            hasVariants: product.hasVariants,
        };
        if (product.hasVariants) {
            responseData.variants = await productService.getMappedVariants(productId, store.id);
        }
        res.json({
            success: true,
            data: responseData,
        });
    }
    catch (err) {
        if (err instanceof ApiError && err.code === ErrorCodes.ERR_NOT_FOUND) {
            return res.status(404).json({ error: err.message });
        }
        adapters.logger.error('PWA product detail error', err);
        res.status(500).json({ error: 'Failed to fetch product detail' });
    }
});
// POST /api/pwa/:storeSlug/message — body: { uid: string, message: string }
// Resolve-or-create Customer + Conversation, lalu panggil Conversation Engine
// secara langsung (bukan lewat messageProcessor / gateway WA / sendWithPresence).
router.post('/:storeSlug/message', conversationLimiter, async (req, res) => {
    try {
        const { storeSlug } = req.params;
        const { uid, message } = req.body;
        if (!storeSlug) {
            return res.status(404).json({ error: 'Store not found' });
        }
        if (!uid || !message || typeof message !== 'string') {
            return res.status(400).json({ error: 'uid and message are required' });
        }
        const store = await prisma.store.findUnique({
            where: { slug: storeSlug, deletedAt: null },
            select: { id: true },
        });
        if (!store) {
            return res.status(404).json({ error: 'Store not found' });
        }
        // --- Resolve-or-create Customer by webUid ---
        // Cari dulu (findFirst) — visitor lama reuse Customer yang ada supaya
        // 1 customer web = 1 record. Jika belum ada, create (phone tetap null).
        // Catatan dikenal (Fase 1 / idempotency-key): race "2 request new-uid
        // nyaris bersamaan" dapat trigger P2002 pada create; client cukup retry.
        let customer = await prisma.customer.findFirst({
            where: { webUid: uid, storeId: store.id, deletedAt: null },
            select: { id: true },
        });
        if (!customer) {
            try {
                customer = await prisma.customer.create({
                    data: { storeId: store.id, webUid: uid, phone: null },
                });
            }
            catch (e) {
                if (e?.code === 'P2002') {
                    // race: request lain baru saja create webUid ini — reuse yang ada
                    customer = await prisma.customer.findFirst({
                        where: { webUid: uid, storeId: store.id },
                        select: { id: true },
                    });
                    if (!customer)
                        throw e;
                }
                else {
                    throw e;
                }
            }
        }
        const customerId = customer.id;
        // --- Resolve-or-create Web Conversation (UUID, channel='web') ---
        // Cari dulu Conversation untuk Customer+Store+channel='web'; hanya create bila belum ada.
        let conversation = await prisma.conversation.findFirst({
            where: { storeId: store.id, customerId, channel: 'web', deletedAt: null },
            select: { id: true },
        });
        if (!conversation) {
            // Web: customerPhone tetap NULL (bukan webUid) — konsisten dengan fix
            // conversation.service.ts:75 untuk channel='web'.
            conversation = await prisma.conversation.create({
                data: {
                    storeId: store.id,
                    customerId,
                    channel: 'web',
                    customerPhone: null,
                    status: 'open',
                },
            });
        }
        const conversationId = conversation.id;
        // --- Mutex + Engine + Event dipindah ke conversationDeliveryService (FASE 1) ---
        // HARD RULE (owner): routes/pwa.ts TIDAK BOLEH memanggil acquireLock().
        // conversationDeliveryService.processWebRequest() adalah SATU lock owner per
        // Web request. Engine (processCustomerMessage) tetap compose+persist; delivery
        // hanya mengamati result, publish event, kemudian merilis lock.
        const result = await conversationDeliveryService.processWebRequest({
            storeId: store.id,
            customerId,
            conversationId,
            message,
        });
        if (result.kind === 'locked') {
            // 429 — request lain sedang memproses conversation yang sama (dedup concurrency).
            return res
                .status(429)
                .json({ error: 'Conversation is being processed, please retry', conversationId });
        }
        if (result.kind === 'pending_human') {
            // result null = human_takeover / tidak ada balasan AI (bukan error 500)
            return res.json({
                success: true,
                message: null,
                status: 'pending_human',
                conversationId,
            });
        }
        // kind === 'ok' — messageId = result.message.id = conversation_history.id (SATU identity)
        // FASE 2: type/payload = canonical structured (sama WS event.data). text default
        // bila engine tak memberi reason authoritatif (authority-only, no heuristic).
        return res.json({
            success: true,
            messageId: result.messageId, // = conversation_history.id = WS event.data.id (HARD RULE #3)
            conversationId,
            type: result.type, // FASE 2: otoritatif dari engine (reason), default 'text'
            payload: result.payload,
            content: result.content,
            source: result.source,
            confidence: result.confidence,
            timestamp: result.createdAt,
        });
    }
    catch (err) {
        adapters.logger.error('PWA message error', err);
        res.status(500).json({ error: 'Failed to process message' });
    }
});
// POST /api/pwa/:storeSlug/typing — customer typing indicator (FASE 1 contract).
// Body: { uid: string, conversationId: string, typing: boolean }.
// Publish typing.started/stopped ke EventBus -> realtime -> room admin
// (store:{storeId}:admin). Server-side throttle 1s (ephemeral event, tidak dipersist).
const typingThrottle = new Map();
const TYPING_THROTTLE_MS = 1000;
router.post('/:storeSlug/typing', conversationLimiter, async (req, res) => {
    try {
        const { storeSlug } = req.params;
        const { uid, conversationId, typing } = req.body;
        if (!storeSlug || !uid || !conversationId || typeof typing !== 'boolean') {
            return res.status(400).json({ error: 'uid, conversationId, and typing are required' });
        }
        const store = await prisma.store.findUnique({
            where: { slug: storeSlug, deletedAt: null },
            select: { id: true },
        });
        if (!store)
            return res.status(404).json({ error: 'Store not found' });
        const customer = await prisma.customer.findFirst({
            where: { webUid: uid, storeId: store.id, deletedAt: null },
            select: { id: true },
        });
        if (!customer)
            return res.status(401).json({ error: 'Unauthorized customer' });
        const conv = await prisma.conversation.findFirst({
            where: {
                id: conversationId,
                storeId: store.id,
                customerId: customer.id,
                channel: 'web',
                deletedAt: null,
            },
            select: { id: true },
        });
        if (!conv)
            return res.status(401).json({ error: 'Unauthorized conversation' });
        const throttleKey = `typing:${conversationId}`;
        const now = Date.now();
        const last = typingThrottle.get(throttleKey);
        if (last !== undefined && now - last < TYPING_THROTTLE_MS) {
            return res.status(429).json({ error: 'Typing throttled', conversationId });
        }
        typingThrottle.set(throttleKey, now);
        setTimeout(() => typingThrottle.delete(throttleKey), TYPING_THROTTLE_MS).unref();
        eventBus.publish({
            event: typing ? 'typing.started' : 'typing.stopped',
            storeId: store.id,
            data: { conversationId, party: 'customer', channel: 'web' },
            ts: Date.now(),
        });
        res.json({ success: true });
    }
    catch (err) {
        adapters.logger.error('PWA typing error', err);
        res.status(500).json({ error: 'Failed to report typing' });
    }
});
// POST /api/pwa/:storeSlug/read — customer read acknowledgement (FASE 3).
// Body: { uid, conversationId, at?: string }. NO migration: persist into
// Conversation.metadata JSON (webLastReadAt). NO conversation_history insert, NO
// message.created (read state only — CRITICAL read/event rule).
// Server-side throttle (5s/conv) prevents request storm from client scroll; client
// only calls on controlled triggers (visible new msg / reconnect catch-up).
const readThrottle = new Map();
const READ_THROTTLE_MS = 5000;
router.post('/:storeSlug/read', conversationLimiter, async (req, res) => {
    try {
        const { storeSlug } = req.params;
        const { uid, conversationId, at } = req.body;
        if (!storeSlug || !uid || !conversationId) {
            return res.status(400).json({ error: 'uid and conversationId are required' });
        }
        const throttleKey = `read:${storeSlug}:${conversationId}`;
        const now = Date.now();
        const last = readThrottle.get(throttleKey);
        if (last !== undefined && now - last < READ_THROTTLE_MS) {
            return res.status(429).json({ error: 'Read throttled', conversationId });
        }
        const store = await prisma.store.findUnique({
            where: { slug: storeSlug, deletedAt: null },
            select: { id: true },
        });
        if (!store)
            return res.status(404).json({ error: 'Store not found' });
        const customer = await prisma.customer.findFirst({
            where: { webUid: uid, storeId: store.id, deletedAt: null },
            select: { id: true },
        });
        if (!customer)
            return res.status(401).json({ error: 'Unauthorized customer' });
        const conv = await prisma.conversation.findFirst({
            where: {
                id: conversationId,
                storeId: store.id,
                customerId: customer.id,
                channel: 'web',
                deletedAt: null,
            },
            select: { id: true, status: true, lastMessageAt: true, metadata: true },
        });
        if (!conv)
            return res.status(401).json({ error: 'Unauthorized conversation' });
        readThrottle.set(throttleKey, now);
        setTimeout(() => readThrottle.delete(throttleKey), READ_THROTTLE_MS).unref();
        const readAt = at ? new Date(at) : new Date();
        const existingMeta = conv.metadata && typeof conv.metadata === 'object'
            ? conv.metadata
            : {};
        await prisma.conversation.update({
            where: { id: conv.id },
            data: {
                metadata: { ...existingMeta, webLastReadAt: readAt.toISOString() },
            },
        });
        eventBus.publish({
            event: 'conversation.updated',
            storeId: store.id,
            data: {
                conversationId: conv.id,
                status: conv.status,
                lastMessageAt: conv.lastMessageAt,
                webLastReadAt: readAt.toISOString(),
            },
            ts: Date.now(),
        });
        res.json({ success: true, webLastReadAt: readAt.toISOString() });
    }
    catch (err) {
        adapters.logger.error('PWA read error', err);
        res.status(500).json({ error: 'Failed to report read' });
    }
});
// POST /api/pwa/:storeSlug/subscribe — persist Web Push subscription (FASE 4).
// Server-authoritative: resolve store (slug) + customer (webUid) on the server —
// JANGAN percaya customerId/storeId dari client (tenant isolation). UPDATE
// existing Customer.pushSubscription (refresh/replace bila browser rotate langganan;
// MVP = 1 browser/device per webUid → kolom Json? cukup).
router.post('/:storeSlug/subscribe', conversationLimiter, async (req, res) => {
    try {
        const { storeSlug } = req.params;
        const { uid, subscription } = req.body;
        if (!storeSlug) {
            return res.status(404).json({ error: 'Store not found' });
        }
        if (!uid ||
            !subscription ||
            typeof subscription !== 'object' ||
            !('endpoint' in subscription) ||
            typeof subscription.endpoint !== 'string') {
            return res.status(400).json({ error: 'uid and a valid PushSubscription are required' });
        }
        const store = await prisma.store.findUnique({
            where: { slug: storeSlug, deletedAt: null },
            select: { id: true },
        });
        if (!store)
            return res.status(404).json({ error: 'Store not found' });
        const customer = await prisma.customer.findFirst({
            where: { webUid: uid, storeId: store.id, deletedAt: null },
            select: { id: true },
        });
        if (!customer)
            return res.status(401).json({ error: 'Unauthorized customer' });
        // UPDATE existing Customer row (MVP: 1 subscription per customer).
        await prisma.customer.update({
            where: { id: customer.id },
            data: { pushSubscription: subscription },
        });
        res.json({ success: true });
    }
    catch (err) {
        adapters.logger.error('PWA subscribe error', err);
        res.status(500).json({ error: 'Failed to save subscription' });
    }
});
// POST /api/pwa/:storeSlug/unsubscribe — clear Web Push subscription (FASE 4).
// Server-authoritative resolution (slug + webUid). Clears the column; does NOT
// delete the customer or conversation. Called on user opt-out / browser-driven
// unsubscription.
router.post('/:storeSlug/unsubscribe', conversationLimiter, async (req, res) => {
    try {
        const { storeSlug } = req.params;
        const { uid } = req.body;
        if (!storeSlug) {
            return res.status(404).json({ error: 'Store not found' });
        }
        if (!uid)
            return res.status(400).json({ error: 'uid is required' });
        const store = await prisma.store.findUnique({
            where: { slug: storeSlug, deletedAt: null },
            select: { id: true },
        });
        if (!store)
            return res.status(404).json({ error: 'Store not found' });
        const customer = await prisma.customer.findFirst({
            where: { webUid: uid, storeId: store.id, deletedAt: null },
            select: { id: true },
        });
        if (!customer)
            return res.status(401).json({ error: 'Unauthorized customer' });
        await prisma.customer.update({
            where: { id: customer.id },
            data: { pushSubscription: null },
        });
        res.json({ success: true });
    }
    catch (err) {
        adapters.logger.error('PWA unsubscribe error', err);
        res.status(500).json({ error: 'Failed to clear subscription' });
    }
});
// Test seam: override the shipping-cost service (e.g. with a stub) so the
// shipping endpoints can be exercised without hitting the real RajaOngkir API
// or consuming the daily quota. Defaults to the production cached service;
// only replaced by tests via __setShippingServiceForTest.
let _shippingService = cachedShippingCostService;
export function __setShippingServiceForTest(svc) {
    _shippingService = svc;
}
async function resolveWebSession(storeSlug, uid, convId) {
    const store = await prisma.store.findUnique({
        where: { slug: storeSlug, deletedAt: null },
        select: { id: true },
    });
    if (!store)
        return null;
    if (!uid)
        return null;
    const customer = await prisma.customer.findFirst({
        where: { webUid: uid, storeId: store.id, deletedAt: null },
        select: { id: true },
    });
    if (!customer)
        return null;
    const where = { storeId: store.id, customerId: customer.id, channel: 'web', deletedAt: null };
    if (convId)
        where.id = convId;
    const conversation = await prisma.conversation.findFirst({ where, select: { id: true } });
    if (!conversation)
        return null;
    return { storeId: store.id, customerId: customer.id, conversationId: conversation.id };
}
/** Resolve-or-create Web session (mirror /message). Dipakai /handoff supaya
 *  "Hubungi Admin" bisa dipanggil meski customer/conversation belum ada. */
export async function getOrCreateWebSession(storeId, uid, convId) {
    let customer = await prisma.customer.findFirst({
        where: { webUid: uid, storeId, deletedAt: null },
        select: { id: true },
    });
    if (!customer) {
        try {
            customer = await prisma.customer.create({ data: { storeId, webUid: uid, phone: null } });
        }
        catch (e) {
            if (e?.code === 'P2002') {
                customer = await prisma.customer.findFirst({ where: { webUid: uid, storeId }, select: { id: true } });
                if (!customer)
                    throw e;
            }
            else {
                throw e;
            }
        }
    }
    const where = { storeId, customerId: customer.id, channel: 'web', deletedAt: null };
    if (convId)
        where.id = convId;
    let conversation = await prisma.conversation.findFirst({ where, select: { id: true } });
    if (!conversation) {
        conversation = await prisma.conversation.create({
            data: { storeId, customerId: customer.id, channel: 'web', customerPhone: null, status: 'open' },
        });
    }
    return { storeId, customerId: customer.id, conversationId: conversation.id };
}
// POST /api/pwa/:storeSlug/handoff — human takeover (Hubungi Admin).
// §9: reuses the EXISTING escalation convention — composeEscalateReply() +
// status:'human_takeover' + humanTakeoverAt + eventBus.publish(message.created,
// conversation.handoff, conversation.updated) — identical to the engine's own
// escalation path (conversation.service markHumanTakeover+composeEscalateReply,
// lines 445-472). Customer-initiated trigger of a real engine convention; no
// fake admin profile fabricated. (GET /orders & GET /faq routes were REMOVED —
// customer order-history & PWA FAQ are NOT released features; see G2-E.3.2 §7/§8.)
// Reuse existing eskalasi convention (escalateStatusUpdate / composeEscalateReply)
// + eventBus publish (message.created + conversation.handoff + conversation.updated).
// Realtime service memforward ke room customer (store:{storeId}:conv:{conversationId})
// sehingga PWA listener `conversation.handoff` berputasi — dan response juga
// konsisten secara optimis (state updated di sisi server).
router.post('/:storeSlug/handoff', conversationLimiter, async (req, res) => {
    try {
        const { storeSlug } = req.params;
        const { uid, conversationId: convId } = req.body;
        const store = await prisma.store.findUnique({ where: { slug: storeSlug, deletedAt: null }, select: { id: true } });
        if (!store)
            return res.status(404).json({ error: 'Store not found' });
        if (!uid)
            return res.status(400).json({ error: 'uid is required' });
        // Resolve-or-create agar "Hubungi Admin" jalan meski belum pernah chat.
        const session = await getOrCreateWebSession(store.id, uid, convId);
        const handoff = await executeHandoff({
            conversationId: session.conversationId,
            storeId: session.storeId,
            channel: 'web',
        });
        res.json({
            success: true,
            conversationId: session.conversationId,
            status: 'human_takeover',
            message: {
                id: handoff.messageId,
                type: 'handoff',
                content: handoff.content,
                source: ResponseSource.HUMAN,
                payload: { reason: 'escalation_clarification_retry_exceeded', content: handoff.content },
            },
        });
    }
    catch (err) {
        adapters.logger.error('PWA handoff error', err);
        res.status(500).json({ error: 'Failed to handoff' });
    }
});
// POST /api/pwa/:storeSlug/clear — hapus riwayat chat web conversation.
// Hard-delete conversation_history rows (schema tidak ada deletedAt pada history)
// + reset status conversation ke 'open'. Dipanggil setelah konfirmasi modal.
router.post('/:storeSlug/clear', conversationLimiter, async (req, res) => {
    try {
        const { storeSlug } = req.params;
        const { uid, conversationId: convId } = req.body;
        const session = await resolveWebSession(storeSlug, uid, convId);
        if (!session) {
            const store = await prisma.store.findUnique({ where: { slug: storeSlug, deletedAt: null }, select: { id: true } });
            if (!store)
                return res.status(404).json({ error: 'Store not found' });
            if (!uid)
                return res.status(400).json({ error: 'uid is required' });
            return res.status(401).json({ error: 'Unauthorized customer' });
        }
        await prisma.$transaction([
            prisma.conversationHistory.deleteMany({ where: { conversationId: session.conversationId } }),
            prisma.conversation.update({
                where: { id: session.conversationId },
                data: { status: 'open', humanTakeoverAt: null, resolvedAt: null },
            }),
        ]);
        res.json({ success: true, conversationId: session.conversationId });
    }
    catch (err) {
        adapters.logger.error('PWA clear error', err);
        res.status(500).json({ error: 'Failed to clear chat' });
    }
});
// POST /api/pwa/:storeSlug/payment-report — customer lapor bukti bayar (transfer/qris).
// Body: { uid, orderId, paymentMethod: 'transfer'|'qris', proofUrl }.
// Tenant isolation: resolve web session (store+customer), lalu paymentService.reportPayment
// memvalidasi order milik store+customer yang sama. orderStatus TIDAK disentuh.
router.post('/:storeSlug/payment-report', conversationLimiter, async (req, res) => {
    try {
        const { storeSlug } = req.params;
        const { uid, orderId, paymentMethod, proofUrl } = req.body;
        if (!uid || !orderId || !paymentMethod || !proofUrl) {
            return res.status(400).json({ error: 'uid, orderId, paymentMethod, dan proofUrl wajib' });
        }
        if (paymentMethod === 'cod') {
            return res.status(400).json({ error: 'COD tidak mendukung lapor bukti transfer/qris' });
        }
        const session = await resolveWebSession(storeSlug, uid);
        if (!session) {
            const store = await prisma.store.findUnique({
                where: { slug: storeSlug, deletedAt: null },
                select: { id: true },
            });
            if (!store)
                return res.status(404).json({ error: 'Store not found' });
            return res.status(401).json({ error: 'Unauthorized customer' });
        }
        const result = await paymentService.reportPayment(orderId, session.storeId, session.customerId, paymentMethod, proofUrl);
        res.json({ success: true, data: result });
    }
    catch (err) {
        if (err instanceof ApiError) {
            return res.status(err.statusCode || 500).json({ error: err.message });
        }
        adapters.logger.error('PWA payment-report error', err);
        res.status(500).json({ error: 'Failed to report payment' });
    }
});
// POST /api/pwa/:storeSlug/checkout — customer checkout: alamat + pilih metode bayar.
// Body: { uid, orderId, address, paymentMethod: 'transfer'|'qris'|'cod' }.
// Reuse CartAuthority.checkout (draft -> waiting_address). COD: selesai (tetap waiting_address,
// TIDAK panggil payment-report). Transfer/QRIS: order tetap waiting_address; signal frontend
// untuk upload bukti via payment-report (endpoint terpisah, dipanggil manual customer).
router.post('/:storeSlug/checkout', orderMutationLimiter, async (req, res) => {
    try {
        const { storeSlug } = req.params;
        const { uid, orderId, address, paymentMethod, destinationProvinceId, destinationProvinceName, destinationCityId, destinationCityName, destinationSubdistrictId, destinationSubdistrictName, } = req.body;
        if (!uid || !orderId) {
            return res.status(400).json({ error: 'uid dan orderId wajib' });
        }
        if (!address || !String(address).trim()) {
            return res.status(400).json({ error: 'Alamat pengiriman wajib diisi' });
        }
        if (!['transfer', 'qris', 'cod'].includes(paymentMethod ?? '')) {
            return res.status(400).json({ error: 'paymentMethod harus transfer/qris/cod' });
        }
        const session = await resolveWebSession(storeSlug, uid);
        if (!session) {
            const store = await prisma.store.findUnique({
                where: { slug: storeSlug, deletedAt: null },
                select: { id: true },
            });
            if (!store)
                return res.status(404).json({ error: 'Store not found' });
            return res.status(401).json({ error: 'Unauthorized customer' });
        }
        // Ownership: order harus milik store + conversation yang sama (tenant isolation).
        const order = await prisma.order.findFirst({
            where: {
                id: orderId,
                storeId: session.storeId,
                conversationId: session.conversationId,
                deletedAt: null,
            },
            select: {
                id: true,
                orderStatus: true,
                conversationId: true,
                // Diperlukan untuk logika reset otomatis ongkir (UNIT 5): bandingkan
                // destinationSubdistrictId LAMA vs BARU, dan cek apakah ongkir sudah terpilih.
                shippingCost: true,
                destinationSubdistrictId: true,
            },
        });
        if (!order)
            return res.status(404).json({ error: 'Order tidak ditemukan' });
        // Transition draft -> waiting_address (reuse CartAuthority; NO duplication).
        if (order.orderStatus === 'draft') {
            await cartAuthority.checkout(session.conversationId, session.storeId);
        }
        // Auto-reset ongkir kalau alamat tujuan (kecamatan) BERUBAH.
        // - oldSub KOSONG -> baru diisi (first-fill) = BUKAN "berubah" → TIDAK reset
        //   (ongkir belum pernah dipilih saat destination masih kosong).
        // - oldSub terisi & BEDA dari baru, DAN shippingCost sudah terisi → reset
        //   (customer wajib pilih ulang kurir sebelum lanjut bayar).
        const oldSub = order.destinationSubdistrictId ?? null;
        const newSub = destinationSubdistrictId ?? null;
        const subdistrictChanged = oldSub != null && oldSub !== newSub;
        const resetShipping = subdistrictChanged && order.shippingCost != null;
        // Set payment method + shipping address (idempotent untuk re-checkout).
        await prisma.order.update({
            where: { id: order.id },
            data: {
                paymentMethod,
                shippingAddress: String(address).trim(),
                destinationProvinceId: destinationProvinceId ?? undefined,
                destinationProvinceName: destinationProvinceName ?? undefined,
                destinationCityId: destinationCityId ?? undefined,
                destinationCityName: destinationCityName ?? undefined,
                destinationSubdistrictId: destinationSubdistrictId ?? undefined,
                destinationSubdistrictName: destinationSubdistrictName ?? undefined,
                // Reset ongkir ke null bila alamat berubah (dalam update yang SAMA).
                ...(resetShipping
                    ? {
                        shippingCost: null,
                        selectedCourier: null,
                        selectedService: null,
                        shippingEtd: null,
                    }
                    : {}),
            },
        });
        if (paymentMethod === 'cod') {
            // COD: SELESAI. Order tetap di waiting_address, TIDAK ada payment-report.
            return res.json({
                success: true,
                data: { orderId: order.id, orderStatus: 'waiting_address', paymentMethod: 'cod', next: 'done' },
            });
        }
        // transfer/qris: menunggu bukti via payment-report (terpisah).
        return res.json({
            success: true,
            data: {
                orderId: order.id,
                orderStatus: 'waiting_address',
                paymentMethod,
                next: 'upload_proof',
                paymentReportUrl: `/api/pwa/${storeSlug}/payment-report`,
            },
        });
    }
    catch (err) {
        if (err instanceof ApiError)
            return res.status(err.statusCode || 500).json({ error: err.message });
        adapters.logger.error('PWA checkout error', err);
        res.status(500).json({ error: 'Failed to checkout' });
    }
});
// GET /api/pwa/:storeSlug/shipping-options — daftar opsi ongkir (READ-ONLY, TIDAK mutasi Order).
// Query: ?uid=&orderId=. Baliknya pakai CachedShippingCostService (cache + quota-guard),
// dihitung ulang server-side — TIDAK PERNAH percaya `cost` dari client (I13 truth boundary).
// Limiter 30/15m/IP (pola pwaLocationsLimiter) karena baliknya konsumsi quota RajaOngkir eksternal.
router.get('/:storeSlug/shipping-options', pwaShippingOptionsLimiter, async (req, res) => {
    try {
        const { storeSlug } = req.params;
        const uid = req.query.uid || undefined;
        const orderId = req.query.orderId || undefined;
        if (!uid || !orderId) {
            return res.status(400).json({ error: 'uid dan orderId wajib' });
        }
        // Resolve session + ownership (storeId + conversationId) — pola sama /checkout.
        const session = await resolveWebSession(storeSlug, uid);
        if (!session) {
            const store = await prisma.store.findUnique({
                where: { slug: storeSlug, deletedAt: null },
                select: { id: true },
            });
            if (!store)
                return res.status(404).json({ error: 'Store not found' });
            return res.status(401).json({ error: 'Unauthorized customer' });
        }
        const order = await prisma.order.findFirst({
            where: {
                id: orderId,
                storeId: session.storeId,
                conversationId: session.conversationId,
                deletedAt: null,
            },
            select: {
                id: true,
                destinationSubdistrictId: true,
                shippingCost: true,
                selectedCourier: true,
                selectedService: true,
                shippingEtd: true,
            },
        });
        if (!order)
            return res.status(404).json({ error: 'Order tidak ditemukan' });
        // Validasi 1: alamat tujuan (kecamatan) wajib — JANGAN tebak/default.
        if (!order.destinationSubdistrictId) {
            return res.status(400).json({ error: 'Pilih alamat tujuan (kecamatan) terlebih dahulu' });
        }
        // Validasi 2: lokasi asal toko — defensive (NOT NULL sejak registrasi, seharusnya
        // tidak pernah kosong untuk toko baru; jangan crash kalau somehow terjadi).
        const store = await prisma.store.findUnique({
            where: { id: session.storeId },
            select: { originSubdistrictId: true },
        });
        if (!store?.originSubdistrictId) {
            return res.status(400).json({ error: 'Toko belum mengatur lokasi asal pengiriman' });
        }
        // Validasi 3: keranjang tidak kosong (berat 0 = tidak ada OrderItem).
        const weightGrams = await getOrderWeightGrams(order.id);
        if (weightGrams <= 0) {
            return res.status(400).json({ error: 'Keranjang kosong, tidak bisa menghitung ongkir' });
        }
        // Hitung ongkir via CachedShippingCostService untuk SETIAP kurir di allowlist Starter
        // (REUSE RAJAONGKIR_STARTER_COURIERS — JANGAN hardcode ulang daftar kurir).
        const options = [];
        const failedCouriers = [];
        let allQuotaExceeded = true;
        let anySuccess = false;
        for (const courier of RAJAONGKIR_STARTER_COURIERS) {
            const result = await _shippingService.getCost(store.originSubdistrictId, order.destinationSubdistrictId, weightGrams, courier);
            if (result === 'QUOTA_EXCEEDED') {
                failedCouriers.push(courier);
                continue;
            }
            if (result === 'PROVIDER_ERROR' || result === 'INVALID_LOCATION' || !Array.isArray(result)) {
                // Error individual (bukan quota) — jangan gagalkan semua respons.
                failedCouriers.push(courier);
                allQuotaExceeded = false;
                continue;
            }
            anySuccess = true;
            allQuotaExceeded = false;
            for (const svc of result) {
                options.push({ courier: svc.courier, service: svc.service, cost: svc.cost, etd: svc.etd });
            }
        }
        if (!anySuccess) {
            if (allQuotaExceeded) {
                // SEMUA kurir quota exceeded → pesan EKSPLISIT, BEDA dari "tidak ada kurir".
                return res.status(200).json({
                    success: false,
                    error: 'QUOTA_EXCEEDED',
                    message: 'Kuota pencarian ongkir harian habis. Coba lagi nanti atau hubungi toko.',
                });
            }
            // Semua kurir error individu (bukan quota) → tidak bisa tampilkan opsi.
            adapters.logger.error('PWA shipping-options: all couriers failed', { failedCouriers });
            return res.status(200).json({
                success: false,
                error: 'PROVIDER_ERROR',
                message: 'Gagal mengambil ongkir dari kurir. Coba lagi nanti.',
            });
        }
        if (failedCouriers.length > 0) {
            adapters.logger.warn('PWA shipping-options: partial courier failure', { failedCouriers });
        }
        // Urutkan termurah dulu.
        options.sort((a, b) => a.cost - b.cost);
        return res.json({
            success: true,
            data: options,
            // Jika order sudah punya pilihan ongkir (reload state), sertakan agar UI
            // bisa mengembalikan selection tanpa wajib pilih ulang.
            current: order.shippingCost != null
                ? {
                    shippingCost: order.shippingCost,
                    selectedCourier: order.selectedCourier,
                    selectedService: order.selectedService,
                    shippingEtd: order.shippingEtd,
                }
                : null,
        });
    }
    catch (err) {
        adapters.logger.error('PWA shipping-options error', err);
        res.status(500).json({ error: 'Failed to get shipping options' });
    }
});
// POST /api/pwa/:storeSlug/select-shipping — kunci pilihan ongkir ke Order (MUTASI).
// Body: { uid, orderId, courier, service }. TIDAK membaca `cost` dari body (I13
// truth boundary): server HITUNG ULANG via CachedShippingCostService dan pakai
// angka ITU. Status order TIDAK berubah (tidak panggil transitionOrder()).
// Limiter 30/15m/IP sama seperti shipping-options (quota RajaOngkir eksternal).
router.post('/:storeSlug/select-shipping', pwaShippingOptionsLimiter, async (req, res) => {
    try {
        const { storeSlug } = req.params;
        const { uid, orderId, courier, service, } = req.body;
        // NOTE: `cost` sengaja TIDAK di-destructure dari body — tidak boleh dipercaya.
        if (!uid || !orderId || !courier || !service) {
            return res.status(400).json({ error: 'uid, orderId, courier, dan service wajib' });
        }
        const session = await resolveWebSession(storeSlug, uid);
        if (!session) {
            const store = await prisma.store.findUnique({
                where: { slug: storeSlug, deletedAt: null },
                select: { id: true },
            });
            if (!store)
                return res.status(404).json({ error: 'Store not found' });
            return res.status(401).json({ error: 'Unauthorized customer' });
        }
        const order = await prisma.order.findFirst({
            where: {
                id: orderId,
                storeId: session.storeId,
                conversationId: session.conversationId,
                deletedAt: null,
            },
            select: { id: true, destinationSubdistrictId: true },
        });
        if (!order)
            return res.status(404).json({ error: 'Order tidak ditemukan' });
        // Guard: alamat tujuan wajib ada sebelum ongkir bisa dipilih.
        if (!order.destinationSubdistrictId) {
            return res.status(400).json({ error: 'Pilih alamat tujuan (kecamatan) terlebih dahulu' });
        }
        const store = await prisma.store.findUnique({
            where: { id: session.storeId },
            select: { originSubdistrictId: true },
        });
        if (!store?.originSubdistrictId) {
            return res.status(400).json({ error: 'Toko belum mengatur lokasi asal pengiriman' });
        }
        const weightGrams = await getOrderWeightGrams(order.id);
        if (weightGrams <= 0) {
            return res.status(400).json({ error: 'Keranjang kosong, tidak bisa memilih ongkir' });
        }
        // Hitung ulang server-side. Akan HIT cache kalau baru saja di-fetch UNIT 3,
        // sehingga tidak makan quota tambahan.
        const result = await _shippingService.getCost(store.originSubdistrictId, order.destinationSubdistrictId, weightGrams, courier);
        if (result === 'QUOTA_EXCEEDED') {
            return res.status(200).json({
                success: false,
                error: 'QUOTA_EXCEEDED',
                message: 'Kuota pencarian ongkir harian habis. Coba lagi nanti atau hubungi toko.',
            });
        }
        if (result === 'PROVIDER_ERROR' || result === 'INVALID_LOCATION' || !Array.isArray(result)) {
            return res.status(502).json({
                success: false,
                error: 'PROVIDER_ERROR',
                message: 'Gagal mengambil ongkir dari kurir. Coba lagi nanti.',
            });
        }
        // Kombinasi courier/service harus benar-benar ada di hasil (bukan data client).
        const match = result.find((s) => s.courier === courier && s.service === service);
        if (!match) {
            return res.status(400).json({ error: 'Kombinasi kurir/layanan tidak tersedia' });
        }
        // Simpan — TANPA transitionOrder(), status order tidak berubah.
        const updated = await prisma.order.update({
            where: { id: order.id },
            data: {
                shippingCost: match.cost,
                selectedCourier: match.courier,
                selectedService: match.service,
                shippingEtd: match.etd,
            },
            select: {
                id: true,
                shippingCost: true,
                selectedCourier: true,
                selectedService: true,
                shippingEtd: true,
                orderStatus: true,
            },
        });
        return res.json({
            success: true,
            data: {
                shippingCost: updated.shippingCost,
                selectedCourier: updated.selectedCourier,
                selectedService: updated.selectedService,
                shippingEtd: updated.shippingEtd,
                orderStatus: updated.orderStatus,
            },
        });
    }
    catch (err) {
        adapters.logger.error('PWA select-shipping error', err);
        res.status(500).json({ error: 'Failed to select shipping' });
    }
});
// GET /api/pwa/:storeSlug/payment-info — info pembayaran toko (reuse BankAccount model + Store).
// Dipakai PWA checkout (transfer/qris) untuk menampilkan rekening + QRIS — JANGAN hardcode.
router.get('/:storeSlug/payment-info', pwaProductsLimiter, async (req, res) => {
    try {
        const { storeSlug } = req.params;
        const store = await prisma.store.findUnique({
            where: { slug: storeSlug, deletedAt: null },
            select: {
                id: true,
                acceptsTransfer: true,
                acceptsQris: true,
                acceptsCod: true,
                qrisImageUrl: true,
            },
        });
        if (!store)
            return res.status(404).json({ error: 'Store not found' });
        const bankAccounts = await prisma.bankAccount.findMany({
            where: { storeId: store.id, isActive: true, deletedAt: null },
            select: { bankName: true, accountNumber: true, accountName: true },
        });
        res.json({
            success: true,
            data: {
                acceptsTransfer: store.acceptsTransfer,
                acceptsQris: store.acceptsQris,
                acceptsCod: store.acceptsCod,
                qrisImageUrl: store.qrisImageUrl,
                bankAccounts,
            },
        });
    }
    catch (err) {
        adapters.logger.error('PWA payment-info error', err);
        res.status(500).json({ error: 'Failed to fetch payment info' });
    }
});
// POST /api/pwa/:storeSlug/payment-proof-upload — upload bukti bayar (image) -> URL.
// Frontend upload lalu kirim URL ke payment-report (endpoint terpisah).
const proofUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
});
router.post('/:storeSlug/payment-proof-upload', orderMutationLimiter, proofUpload.single('proof'), async (req, res) => {
    try {
        const { storeSlug } = req.params;
        const store = await prisma.store.findUnique({
            where: { slug: storeSlug, deletedAt: null },
            select: { id: true },
        });
        if (!store)
            return res.status(404).json({ error: 'Store not found' });
        if (!req.file)
            return res.status(400).json({ error: 'No image uploaded' });
        const { url } = await adapters.catalogStorage.uploadImage(req.file.buffer, `garuda/payment-proof/${store.id}`);
        res.json({ success: true, data: { url } });
    }
    catch (err) {
        adapters.logger.error('PWA proof upload error', err);
        res.status(500).json({ error: 'Failed to upload proof' });
    }
});
export default router;
//# sourceMappingURL=pwa.js.map