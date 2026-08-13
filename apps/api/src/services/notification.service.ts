import webPush from 'web-push';
import { eventBus, type EventEnvelope } from './event-bus.service.js';
import { realtimeService } from './realtime.service.js';
import { getVapidConfig } from '../config/vapid.config.js';
import { prisma } from '../infrastructure/prisma.js';
import { adapters } from '../adapters/container.js';

/**
 * FASE 4 — Web Push notification SIGNAL service (NOT a message transport).
 *
 * Boundary (owner rule):
 *  - Socket.IO = primary realtime message transport.
 *  - Web Push = notification signal only (title/body/deep-link).
 *  - Push MUST NOT INSERT conversation_history, MUST NOT create a message bubble,
 *    MUST NOT replace Socket.IO. A push is only fired when the customer has NO
 *    active customer Socket.IO presence in the conversation (online customers
 *    therefore never get a duplicate signal — they get the WS message.created).
 *
 * Trigger (owner rule "Primary notification-worthy event"):
 *  - HUMAN AGENT -> WEB CUSTOMER, published as `message.created` with
 *    `sender === 'human_agent'`. AI/assistant and customer-echo messages are
 *    explicitly NOT pushed (no notification storm).
 *
 * Reuses the established EventBus boundary; this service consumes `message.created`
 * (NOT a new custom event) and decides internally whether a push is warranted.
 * No `push.notification.created` / `webpush.created` events are invented.
 *
 * Delivery-layer only: imports prisma + realtimeService + eventBus + web-push.
 * It does NOT import the Conversation Engine.
 */

export interface PushPayload {
  conversationId: string;
  messageId: string; // = conversation_history.id (canonical, no synthetic id)
  title: string;
  body: string;
  url: string; // deep-link /c/<storeSlug> — NO token
  timestamp: string;
}

// Minimal contract of the message.created event data this service consumes.
interface MessageCreatedLike {
  id: string;
  conversationId: string;
  sender: 'assistant' | 'customer' | 'human_agent';
  type: string;
  content: string | null;
  createdAt: Date | string;
  storeSlug?: string;
}

const PREVIEW_MAX = 80;

function truncate(text: string | null | undefined, max: number): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

export const notificationService = {
  vapidConfigured: false,

  /** Configure Web Push + subscribe to message.created. Must run after RealtimeService.init. */
  init(): void {
    const cfg = getVapidConfig();
    if (!cfg) {
      // Degrade gracefully: API still boots; push stays disabled. Production deploy
      // must provide VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY.
      adapters.logger.warn('FASE4: VAPID keys not configured — web push DISABLED');
      return;
    }
    webPush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    this.vapidConfigured = true;

    // Reuse the established boundary; do NOT invent a new event type.
    eventBus.subscribe('message.created', (env: EventEnvelope) => {
      // Fire-and-forget: never block the synchronous EventBus emit / WS delivery,
      // and never let a push error roll back the message (FASE 4 failure rule).
      this.handleMessageCreated(env).catch((e: Error) => {
        adapters.logger.error('FASE4 notification handler error', e);
      });
    });

    adapters.logger.info('FASE4 notification service initialized (subscriber: message.created)');
  },

  isVapidConfigured(): boolean {
    return this.vapidConfigured;
  },

  /** Resolve the customer's persisted push subscription (server-authoritative). */
  async getSubscription(customerId: string): Promise<unknown | null> {
    const c = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { pushSubscription: true },
    });
    if (!c?.pushSubscription) return null;
    const ps = c.pushSubscription as unknown;
    try {
      return typeof ps === 'string' ? JSON.parse(ps) : ps;
    } catch {
      return null;
    }
  },

  /**
   * FASE 4 eligibility algorithm (owner spec).
   * Returns true ONLY when: subscription exists AND customer is NOT online on WS.
   */
  async shouldPush(params: {
    storeId: string;
    conversationId: string;
    customerId: string;
  }): Promise<{ push: boolean; reason: string }> {
    const customer = await prisma.customer.findUnique({
      where: { id: params.customerId },
      select: { pushSubscription: true, storeId: true },
    });
    if (!customer || customer.storeId !== params.storeId) {
      return { push: false, reason: 'tenant_mismatch_or_customer_missing' };
    }
    const sub = await this.getSubscription(params.customerId);
    if (!sub) return { push: false, reason: 'no_push_subscription' };
    const online = realtimeService.isCustomerConversationOnline(params.storeId, params.conversationId);
    if (online) return { push: false, reason: 'customer_online_no_duplicate' };
    return { push: true, reason: 'customer_offline' };
  },

  buildPayload(d: MessageCreatedLike): PushPayload {
    const storeSlug = d.storeSlug ?? '';
    return {
      conversationId: d.conversationId,
      messageId: d.id,
      title: storeSlug ? storeSlug : 'QloBot',
      body: `Ada balasan dari admin: ${truncate(d.content, PREVIEW_MAX)}`,
      url: `/c/${storeSlug}`,
      timestamp: new Date(d.createdAt).toISOString(),
    };
  },

  async handleMessageCreated(env: EventEnvelope): Promise<void> {
    if (!this.vapidConfigured) return; // push disabled at init (no VAPID); WS still primary

    const data = env.data as MessageCreatedLike;
    // TRIGGER FILTER: only HUMAN AGENT -> WEB CUSTOMER (admin reply). No AI/customer push.
    if (data.sender !== 'human_agent') return;

    // Resolve conversation (store-scoped -> tenant isolation).
    const conv = await prisma.conversation.findUnique({
      where: { id: data.conversationId },
      select: { id: true, storeId: true, customerId: true, channel: true },
    });
    if (!conv) return;
    if (conv.storeId !== env.storeId) {
      adapters.logger.warn('FASE4: storeId mismatch (tenant isolation)', {
        envStore: env.storeId,
        convStore: conv.storeId,
      });
      return;
    }
    // Web/WhatsApp isolation: only web channel gets push (WA uses WA gateway).
    if (conv.channel !== 'web') return;

    // Eligibility: subscription exists + customer offline.
    const { push, reason } = await this.shouldPush({
      storeId: env.storeId,
      conversationId: conv.id,
      customerId: conv.customerId,
    });
    if (!push) {
      adapters.logger.info(`FASE4: push skipped (${reason})`, {
        conversationId: conv.id,
        messageId: data.id,
      });
      return;
    }

    // Resolve store slug for deep-link (no token in URL).
    const store = await prisma.store.findUnique({
      where: { id: env.storeId },
      select: { slug: true },
    });
    const subscription = await this.getSubscription(conv.customerId);
    if (!subscription) return; // race: subscription cleared between check + send

    const payload = this.buildPayload({ ...data, storeSlug: store?.slug ?? '' });

    // Persist message is ALREADY done by the engine/delivery; push is signal-only.
    // Send MUST NOT be able to rollback the message — wrap and never throw upward.
    try {
      await webPush.sendNotification(
        subscription as any,
        JSON.stringify(payload),
        { TTL: 60 * 60 }, // 1h
      );
      adapters.logger.info('FASE4: web push sent', {
        conversationId: conv.id,
        messageId: data.id,
      });
    } catch (e: any) {
      // Invalid/expired subscription -> clear silently (no retry); do NOT touch
      // conversation_history / message / reply.
      if (isSubscriptionError(e)) {
        await prisma.customer.update({
          where: { id: conv.customerId },
          data: { pushSubscription: null as any },
        }).catch((ue: unknown) => {
          adapters.logger.error('FASE4: failed to clear stale subscription', ue as Error);
        });
        adapters.logger.info('FASE4: stale push subscription cleared', {
          conversationId: conv.id,
          messageId: data.id,
        });
      } else {
        // Transient/other push failure -> log only; message delivery is unaffected.
        adapters.logger.error('FASE4: push send failed (message NOT rolled back)', {
          conversationId: conv.id,
          messageId: data.id,
          error: e?.message,
          statusCode: e?.statusCode,
        });
      }
    }
  },
};

// Standalone helper (pure, testable) used by handleMessageCreated.
function isSubscriptionError(e: any): boolean {
  if (!e) return false;
  const code = e.statusCode || e.code;
  if (code === 404 || code === 410) return true;
  const msg = (e?.message || String(e)).toLowerCase();
  return /410|gone|expired|invalid subscription|unsubscribe|removed/i.test(msg);
}
