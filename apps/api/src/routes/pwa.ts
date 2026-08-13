import { Router, Request, Response } from 'express';
import { prisma } from '../infrastructure/prisma.js';
import { conversationLimiter } from '../middleware/rate-limiters.js';
import { adapters } from '../adapters/container.js';
import { conversationDeliveryService } from '../services/conversation-delivery.service.js';
import { eventBus } from '../services/event-bus.service.js';

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
router.get('/:storeSlug/init', async (req: Request, res: Response) => {
  try {
    const { storeSlug } = req.params;
    if (!storeSlug) {
      return res.status(404).json({ error: 'Store not found' });
    }

    const store = await prisma.store.findUnique({
      where: { slug: storeSlug, deletedAt: null },
      select: PWA_STORE_PUBLIC_SELECT,
    });

    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }

    res.json({ success: true, data: { store } });
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

export default router;
