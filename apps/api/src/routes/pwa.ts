import { Router, Request, Response } from 'express';
import multer from 'multer';
import { prisma } from '../infrastructure/prisma.js';
import { conversationLimiter, pwaInitLimiter, pwaProductsLimiter } from '../middleware/rate-limiters.js';
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
} as const;

// GET /api/pwa/:storeSlug/init — resolve Store by slug, kembalikan data publik.
router.get('/:storeSlug/init', pwaInitLimiter, async (req: Request, res: Response) => {
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
    const contact: { channel: 'whatsapp'; whatsappUrl: string; displayName: string } | null =
      phoneNumber
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
  } catch (err) {
    adapters.logger.error('PWA init error', err as Error);
    res.status(500).json({ error: 'Failed to fetch store' });
  }
});

// GET /api/pwa/:storeSlug/history?uid=<webUid> — riwayat Web Conversation.
// Visitor pertama kali (Customer/Conversation belum ada) -> history kosong, BUKAN 404.
router.get('/:storeSlug/history', async (req: Request, res: Response) => {
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
        metadata: true,    // FASE 2: metadata.messagePayload (merge-preserve existing)
        createdAt: true,
      },
    });

    // Normalisasi ke shape kanonis ChatPage (sama dengan WS message.created):
    // type = messageType (default 'text' bila NULL), payload = metadata.messagePayload.
    const safeHistory = history.map((h) => {
      const meta = (h.metadata && typeof h.metadata === 'object'
        ? (h.metadata as Record<string, unknown>)
        : {}) as Record<string, unknown>;
      return {
        id: h.id,
        role: h.role,
        content: h.content,
        source: h.source,
        type: h.messageType ?? 'text',
        payload: (meta.messagePayload as Record<string, unknown> | null) ?? null,
        createdAt: h.createdAt,
      };
    });

    res.json({ success: true, data: { history: safeHistory, conversationId: conversation.id } });
  } catch (err) {
    adapters.logger.error('PWA history error', err as Error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// GET /api/pwa/:storeSlug/products — public product catalog for PWA first-open discovery.
// Reuses productService.getProductsByStore (same authority, same isActive filter).
// Maps to ChatProduct shape (id, name, description, price, stock, primaryImageUrl).
router.get('/:storeSlug/products', pwaProductsLimiter, async (req: Request, res: Response) => {
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

    const mappedProducts = products.map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      price: p.price,
      stock: p.stock,
      primaryImageUrl: p.primaryImageUrl ?? null,
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
  } catch (err) {
    adapters.logger.error('PWA products error', err as Error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// GET /api/pwa/:storeSlug/products/:productId — public product detail for PWA product card tap.
// Reuses productService.getProductById (authoritative). Returns public fields only.
router.get('/:storeSlug/products/:productId', pwaProductsLimiter, async (req: Request, res: Response) => {
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

    res.json({
      success: true,
      data: {
        id: product.id,
        name: product.name,
        description: product.description ?? null,
        price: product.price,
        stock: product.stock,
        primaryImageUrl: product.primaryImageUrl ?? null,
      },
    });
  } catch (err: any) {
    if (err instanceof ApiError && err.code === ErrorCodes.ERR_NOT_FOUND) {
      return res.status(404).json({ error: err.message });
    }
    adapters.logger.error('PWA product detail error', err as Error);
    res.status(500).json({ error: 'Failed to fetch product detail' });
  }
});

// POST /api/pwa/:storeSlug/message — body: { uid: string, message: string }
// Resolve-or-create Customer + Conversation, lalu panggil Conversation Engine
// secara langsung (bukan lewat messageProcessor / gateway WA / sendWithPresence).
router.post('/:storeSlug/message', conversationLimiter, async (req: Request, res: Response) => {
  try {
    const { storeSlug } = req.params;
    const { uid, message } = req.body as { uid?: string; message?: string };

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
      } catch (e: any) {
        if (e?.code === 'P2002') {
          // race: request lain baru saja create webUid ini — reuse yang ada
          customer = await prisma.customer.findFirst({
            where: { webUid: uid, storeId: store.id },
            select: { id: true },
          });
          if (!customer) throw e;
        } else {
          throw e;
        }
      }
    }
    const customerId = customer!.id;

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
    const conversationId = conversation!.id;

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
  } catch (err) {
    adapters.logger.error('PWA message error', err as Error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// POST /api/pwa/:storeSlug/typing — customer typing indicator (FASE 1 contract).
// Body: { uid: string, conversationId: string, typing: boolean }.
// Publish typing.started/stopped ke EventBus -> realtime -> room admin
// (store:{storeId}:admin). Server-side throttle 1s (ephemeral event, tidak dipersist).
const typingThrottle = new Map<string, number>();
const TYPING_THROTTLE_MS = 1000;
router.post('/:storeSlug/typing', async (req: Request, res: Response) => {
  try {
    const { storeSlug } = req.params;
    const { uid, conversationId, typing } = req.body as {
      uid?: string;
      conversationId?: string;
      typing?: boolean;
    };
    if (!storeSlug || !uid || !conversationId || typeof typing !== 'boolean') {
      return res.status(400).json({ error: 'uid, conversationId, and typing are required' });
    }

    const store = await prisma.store.findUnique({
      where: { slug: storeSlug, deletedAt: null },
      select: { id: true },
    });
    if (!store) return res.status(404).json({ error: 'Store not found' });

    const customer = await prisma.customer.findFirst({
      where: { webUid: uid, storeId: store.id, deletedAt: null },
      select: { id: true },
    });
    if (!customer) return res.status(401).json({ error: 'Unauthorized customer' });

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
    if (!conv) return res.status(401).json({ error: 'Unauthorized conversation' });

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
  } catch (err) {
    adapters.logger.error('PWA typing error', err as Error);
    res.status(500).json({ error: 'Failed to report typing' });
  }
});

// POST /api/pwa/:storeSlug/read — customer read acknowledgement (FASE 3).
// Body: { uid, conversationId, at?: string }. NO migration: persist into
// Conversation.metadata JSON (webLastReadAt). NO conversation_history insert, NO
// message.created (read state only — CRITICAL read/event rule).
// Server-side throttle (5s/conv) prevents request storm from client scroll; client
// only calls on controlled triggers (visible new msg / reconnect catch-up).
const readThrottle = new Map<string, number>();
const READ_THROTTLE_MS = 5000;
router.post('/:storeSlug/read', async (req: Request, res: Response) => {
  try {
    const { storeSlug } = req.params;
    const { uid, conversationId, at } = req.body as {
      uid?: string;
      conversationId?: string;
      at?: string;
    };

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
    if (!store) return res.status(404).json({ error: 'Store not found' });

    const customer = await prisma.customer.findFirst({
      where: { webUid: uid, storeId: store.id, deletedAt: null },
      select: { id: true },
    });
    if (!customer) return res.status(401).json({ error: 'Unauthorized customer' });

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
    if (!conv) return res.status(401).json({ error: 'Unauthorized conversation' });

    readThrottle.set(throttleKey, now);
    setTimeout(() => readThrottle.delete(throttleKey), READ_THROTTLE_MS).unref();

    const readAt = at ? new Date(at) : new Date();
    const existingMeta =
      conv.metadata && typeof conv.metadata === 'object'
        ? (conv.metadata as Record<string, unknown>)
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
  } catch (err) {
    adapters.logger.error('PWA read error', err as Error);
    res.status(500).json({ error: 'Failed to report read' });
  }
});

// POST /api/pwa/:storeSlug/subscribe — persist Web Push subscription (FASE 4).
// Server-authoritative: resolve store (slug) + customer (webUid) on the server —
// JANGAN percaya customerId/storeId dari client (tenant isolation). UPDATE
// existing Customer.pushSubscription (refresh/replace bila browser rotate langganan;
// MVP = 1 browser/device per webUid → kolom Json? cukup).
router.post('/:storeSlug/subscribe', async (req: Request, res: Response) => {
  try {
    const { storeSlug } = req.params;
    const { uid, subscription } = req.body as { uid?: string; subscription?: unknown };
    if (!storeSlug) {
      return res.status(404).json({ error: 'Store not found' });
    }
    if (
      !uid ||
      !subscription ||
      typeof subscription !== 'object' ||
      !('endpoint' in subscription) ||
      typeof (subscription as { endpoint?: unknown }).endpoint !== 'string'
    ) {
      return res.status(400).json({ error: 'uid and a valid PushSubscription are required' });
    }

    const store = await prisma.store.findUnique({
      where: { slug: storeSlug, deletedAt: null },
      select: { id: true },
    });
    if (!store) return res.status(404).json({ error: 'Store not found' });

    const customer = await prisma.customer.findFirst({
      where: { webUid: uid, storeId: store.id, deletedAt: null },
      select: { id: true },
    });
    if (!customer) return res.status(401).json({ error: 'Unauthorized customer' });

    // UPDATE existing Customer row (MVP: 1 subscription per customer).
    await prisma.customer.update({
      where: { id: customer.id },
      data: { pushSubscription: subscription as any },
    });
    res.json({ success: true });
  } catch (err) {
    adapters.logger.error('PWA subscribe error', err as Error);
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

// POST /api/pwa/:storeSlug/unsubscribe — clear Web Push subscription (FASE 4).
// Server-authoritative resolution (slug + webUid). Clears the column; does NOT
// delete the customer or conversation. Called on user opt-out / browser-driven
// unsubscription.
router.post('/:storeSlug/unsubscribe', async (req: Request, res: Response) => {
  try {
    const { storeSlug } = req.params;
    const { uid } = req.body as { uid?: string };
    if (!storeSlug) {
      return res.status(404).json({ error: 'Store not found' });
    }
    if (!uid) return res.status(400).json({ error: 'uid is required' });

    const store = await prisma.store.findUnique({
      where: { slug: storeSlug, deletedAt: null },
      select: { id: true },
    });
    if (!store) return res.status(404).json({ error: 'Store not found' });

    const customer = await prisma.customer.findFirst({
      where: { webUid: uid, storeId: store.id, deletedAt: null },
      select: { id: true },
    });
    if (!customer) return res.status(401).json({ error: 'Unauthorized customer' });

    await prisma.customer.update({
      where: { id: customer.id },
      data: { pushSubscription: null as any },
    });
    res.json({ success: true });
  } catch (err) {
    adapters.logger.error('PWA unsubscribe error', err as Error);
    res.status(500).json({ error: 'Failed to clear subscription' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared Web session resolver (P-PWA.5): store + customer(by webUid) + web conversation.
// Dipakai endpoint-endpoint publik berikutnya agar resolve logic tidak tersebar.
interface WebSession {
  storeId: string;
  customerId: string;
  conversationId: string;
}

async function resolveWebSession(
  storeSlug: string,
  uid: string | undefined,
  convId?: string,
): Promise<WebSession | null> {
  const store = await prisma.store.findUnique({
    where: { slug: storeSlug, deletedAt: null },
    select: { id: true },
  });
  if (!store) return null;
  if (!uid) return null;
  const customer = await prisma.customer.findFirst({
    where: { webUid: uid, storeId: store.id, deletedAt: null },
    select: { id: true },
  });
  if (!customer) return null;
  const where: {
    id?: string;
    storeId: string;
    customerId: string;
    channel: string;
    deletedAt: null;
  } = { storeId: store.id, customerId: customer.id, channel: 'web', deletedAt: null };
  if (convId) where.id = convId;
  const conversation = await prisma.conversation.findFirst({ where, select: { id: true } });
  if (!conversation) return null;
  return { storeId: store.id, customerId: customer.id, conversationId: conversation.id };
}

/** Resolve-or-create Web session (mirror /message). Dipakai /handoff supaya
 *  "Hubungi Admin" bisa dipanggil meski customer/conversation belum ada. */
export async function getOrCreateWebSession(
  storeId: string,
  uid: string,
  convId?: string,
): Promise<WebSession> {
  let customer = await prisma.customer.findFirst({
    where: { webUid: uid, storeId, deletedAt: null },
    select: { id: true },
  });
  if (!customer) {
    try {
      customer = await prisma.customer.create({ data: { storeId, webUid: uid, phone: null } });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        customer = await prisma.customer.findFirst({ where: { webUid: uid, storeId }, select: { id: true } });
        if (!customer) throw e;
      } else {
        throw e;
      }
    }
  }

  const where: { id?: string; storeId: string; customerId: string; channel: string; deletedAt: null } =
    { storeId, customerId: customer.id, channel: 'web', deletedAt: null };
  if (convId) where.id = convId;
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
router.post('/:storeSlug/handoff', async (req: Request, res: Response) => {
  try {
    const { storeSlug } = req.params;
    const { uid, conversationId: convId } = req.body as { uid?: string; conversationId?: string };
    const store = await prisma.store.findUnique({ where: { slug: storeSlug, deletedAt: null }, select: { id: true } });
    if (!store) return res.status(404).json({ error: 'Store not found' });
    if (!uid) return res.status(400).json({ error: 'uid is required' });

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
  } catch (err) {
    adapters.logger.error('PWA handoff error', err as Error);
    res.status(500).json({ error: 'Failed to handoff' });
  }
});

// POST /api/pwa/:storeSlug/clear — hapus riwayat chat web conversation.
// Hard-delete conversation_history rows (schema tidak ada deletedAt pada history)
// + reset status conversation ke 'open'. Dipanggil setelah konfirmasi modal.
router.post('/:storeSlug/clear', async (req: Request, res: Response) => {
  try {
    const { storeSlug } = req.params;
    const { uid, conversationId: convId } = req.body as { uid?: string; conversationId?: string };
    const session = await resolveWebSession(storeSlug, uid, convId);
    if (!session) {
      const store = await prisma.store.findUnique({ where: { slug: storeSlug, deletedAt: null }, select: { id: true } });
      if (!store) return res.status(404).json({ error: 'Store not found' });
      if (!uid) return res.status(400).json({ error: 'uid is required' });
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
  } catch (err) {
    adapters.logger.error('PWA clear error', err as Error);
    res.status(500).json({ error: 'Failed to clear chat' });
  }
});

// POST /api/pwa/:storeSlug/payment-report — customer lapor bukti bayar (transfer/qris).
// Body: { uid, orderId, paymentMethod: 'transfer'|'qris', proofUrl }.
// Tenant isolation: resolve web session (store+customer), lalu paymentService.reportPayment
// memvalidasi order milik store+customer yang sama. orderStatus TIDAK disentuh.
router.post('/:storeSlug/payment-report', async (req: Request, res: Response) => {
  try {
    const { storeSlug } = req.params;
    const { uid, orderId, paymentMethod, proofUrl } = req.body as {
      uid?: string;
      orderId?: string;
      paymentMethod?: string;
      proofUrl?: string;
    };

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
      if (!store) return res.status(404).json({ error: 'Store not found' });
      return res.status(401).json({ error: 'Unauthorized customer' });
    }

    const result = await paymentService.reportPayment(
      orderId,
      session.storeId,
      session.customerId,
      paymentMethod,
      proofUrl,
    );
    res.json({ success: true, data: result });
  } catch (err: any) {
    if (err instanceof ApiError) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
    adapters.logger.error('PWA payment-report error', err as Error);
    res.status(500).json({ error: 'Failed to report payment' });
  }
});

// POST /api/pwa/:storeSlug/checkout — customer checkout: alamat + pilih metode bayar.
// Body: { uid, orderId, address, paymentMethod: 'transfer'|'qris'|'cod' }.
// Reuse CartAuthority.checkout (draft -> waiting_address). COD: selesai (tetap waiting_address,
// TIDAK panggil payment-report). Transfer/QRIS: order tetap waiting_address; signal frontend
// untuk upload bukti via payment-report (endpoint terpisah, dipanggil manual customer).
router.post('/:storeSlug/checkout', async (req: Request, res: Response) => {
  try {
    const { storeSlug } = req.params;
    const {
      uid,
      orderId,
      address,
      paymentMethod,
      destinationProvinceId,
      destinationProvinceName,
      destinationCityId,
      destinationCityName,
      destinationSubdistrictId,
      destinationSubdistrictName,
    } = req.body as {
      uid?: string;
      orderId?: string;
      address?: string;
      paymentMethod?: string;
      destinationProvinceId?: string;
      destinationProvinceName?: string;
      destinationCityId?: string;
      destinationCityName?: string;
      destinationSubdistrictId?: string;
      destinationSubdistrictName?: string;
    };

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
      if (!store) return res.status(404).json({ error: 'Store not found' });
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
      select: { id: true, orderStatus: true, conversationId: true },
    });
    if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });

    // Transition draft -> waiting_address (reuse CartAuthority; NO duplication).
    if (order.orderStatus === 'draft') {
      await cartAuthority.checkout(session.conversationId, session.storeId);
    }

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
  } catch (err: any) {
    if (err instanceof ApiError) return res.status(err.statusCode || 500).json({ error: err.message });
    adapters.logger.error('PWA checkout error', err as Error);
    res.status(500).json({ error: 'Failed to checkout' });
  }
});

// GET /api/pwa/:storeSlug/payment-info — info pembayaran toko (reuse BankAccount model + Store).
// Dipakai PWA checkout (transfer/qris) untuk menampilkan rekening + QRIS — JANGAN hardcode.
router.get('/:storeSlug/payment-info', pwaProductsLimiter, async (req: Request, res: Response) => {
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
    if (!store) return res.status(404).json({ error: 'Store not found' });
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
  } catch (err: any) {
    adapters.logger.error('PWA payment-info error', err as Error);
    res.status(500).json({ error: 'Failed to fetch payment info' });
  }
});

// POST /api/pwa/:storeSlug/payment-proof-upload — upload bukti bayar (image) -> URL.
// Frontend upload lalu kirim URL ke payment-report (endpoint terpisah).
const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});
router.post('/:storeSlug/payment-proof-upload', proofUpload.single('proof'), async (req: Request, res: Response) => {
  try {
    const { storeSlug } = req.params;
    const store = await prisma.store.findUnique({
      where: { slug: storeSlug, deletedAt: null },
      select: { id: true },
    });
    if (!store) return res.status(404).json({ error: 'Store not found' });
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const { url } = await adapters.catalogStorage.uploadImage(req.file.buffer, `garuda/payment-proof/${store.id}`);
    res.json({ success: true, data: { url } });
  } catch (err: any) {
    adapters.logger.error('PWA proof upload error', err as Error);
    res.status(500).json({ error: 'Failed to upload proof' });
  }
});

export default router;
