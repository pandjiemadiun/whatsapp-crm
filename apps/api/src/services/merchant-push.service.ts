import { eventBus, type EventEnvelope } from './event-bus.service.js';
import { realtimeService } from './realtime.service.js';
import { prisma } from '../infrastructure/prisma.js';
import { adapters } from '../adapters/container.js';
import { sendPush, ensureVapidConfigured, type PushSubscriptionDTO } from './push.service.js';

/**
 * Merchant-side Web Push notification service.
 *
 * Boundary:
 *  - Scoped to Store sessions (authMiddleware, req.user.storeId).
 *  - Fires ONLY for a store's OWN events — strict tenant isolation.
 *  - Dedupes against admin socket presence (store:{storeId}:admin room).
 *    If the merchant's dashboard tab is actively connected, skip push.
 *
 * Triggers:
 *  - order.created — new customer order
 *  - order.payment_verification_pending — customer reported payment
 *  - message.created (customer→admin direction, sender === 'customer') — new customer message
 */

export interface OrderCreatedLike {
  orderId: string;
  storeId: string;
  total?: number;
  itemCount?: number;
}

export interface PaymentPendingLike {
  orderId: string;
  storeId: string;
  total?: number;
}

export interface CustomerMessageLike {
  id: string;
  conversationId: string;
  sender: 'assistant' | 'customer' | 'human_agent';
  content: string | null;
  storeId: string;
  customerName?: string;
}

const PREVIEW_MAX = 80;

function truncate(text: string | null | undefined, max: number): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

async function getStoreSubscriptions(storeId: string): Promise<PushSubscriptionDTO[]> {
  const rows = await prisma.storePushSubscription.findMany({
    where: { storeId },
    select: { endpoint: true, auth: true, p256dh: true },
  });
  return rows.map((r) => ({
    endpoint: r.endpoint,
    keys: { auth: r.auth, p256dh: r.p256dh },
  }));
}

async function clearExpiredSubscription(storeId: string, endpoint: string): Promise<void> {
  await prisma.storePushSubscription
    .deleteMany({ where: { storeId, endpoint } })
    .catch(() => {});
}

async function sendToStore(
  storeId: string,
  message: { title: string; body: string; url: string; tag?: string },
  eventTag: string,
): Promise<void> {
  // Tenant isolation assertion: only send to the store that owns the event.
  const subs = await getStoreSubscriptions(storeId);
  if (!subs.length) return;

  // Dedup: if merchant dashboard is online for this store, skip push.
  if (realtimeService.isStoreOnline(storeId)) {
    adapters.logger.info('merchant push skipped (store online)', { storeId, tag: eventTag });
    return;
  }

  for (const sub of subs) {
    const result = await sendPush(sub, { ...message, tag: eventTag });
    if (result.expired) {
      await clearExpiredSubscription(storeId, sub.endpoint);
      adapters.logger.info('merchant push subscription cleared (expired)', { storeId, endpoint: sub.endpoint });
    }
  }
}

export const merchantPushService = {
  init(): void {
    if (!ensureVapidConfigured()) {
      adapters.logger.warn('merchant push DISABLED (no VAPID keys)');
      return;
    }

    eventBus.subscribe('order.created', (env: EventEnvelope) => {
      this.handleOrderCreated(env).catch((e: Error) => {
        adapters.logger.error('merchant push order.created handler error', e);
      });
    });

    eventBus.subscribe('order.payment_verification_pending', (env: EventEnvelope) => {
      this.handlePaymentPending(env).catch((e: Error) => {
        adapters.logger.error('merchant push payment_pending handler error', e);
      });
    });

    eventBus.subscribe('message.created', (env: EventEnvelope) => {
      this.handleCustomerMessage(env).catch((e: Error) => {
        adapters.logger.error('merchant push message.created handler error', e);
      });
    });

    adapters.logger.info('merchant push service initialized (subscriber: order.created, order.payment_verification_pending, message.created)');
  },

  async handleOrderCreated(env: EventEnvelope): Promise<void> {
    const data = env.data as OrderCreatedLike;
    // Strict tenant assertion
    if (data.storeId !== env.storeId) {
      adapters.logger.warn('merchant push order.created: storeId mismatch', { envStore: env.storeId, dataStore: data.storeId });
      return;
    }
    await sendToStore(
      env.storeId,
      {
        title: 'Pesanan Baru',
        body: `Pesanan baru (${data.itemCount ?? 0} item)`,
        url: '/dashboard/orders',
        tag: `order-${data.orderId}`,
      },
      `order-${data.orderId}`,
    );
  },

  async handlePaymentPending(env: EventEnvelope): Promise<void> {
    const data = env.data as PaymentPendingLike;
    if (data.storeId !== env.storeId) {
      adapters.logger.warn('merchant push payment_pending: storeId mismatch', { envStore: env.storeId, dataStore: data.storeId });
      return;
    }
    await sendToStore(
      env.storeId,
      {
        title: 'Verifikasi Pembayaran',
        body: 'Pelanggan melaporkan pembayaran',
        url: '/dashboard/orders',
        tag: `payment-${data.orderId}`,
      },
      `payment-${data.orderId}`,
    );
  },

  async handleCustomerMessage(env: EventEnvelope): Promise<void> {
    const data = env.data as CustomerMessageLike;
    if (data.storeId !== env.storeId) {
      adapters.logger.warn('merchant push message.created: storeId mismatch', { envStore: env.storeId, dataStore: data.storeId });
      return;
    }
    // Only push for customer→admin direction (opposite of customer-side push which triggers on human_agent)
    if (data.sender !== 'customer') return;

    await sendToStore(
      env.storeId,
      {
        title: 'Pesan Baru',
        body: `${data.customerName ?? 'Pelanggan'}: ${truncate(data.content, PREVIEW_MAX)}`,
        url: '/dashboard/conversations',
        tag: `msg-${data.id}`,
      },
      `msg-${data.id}`,
    );
  },
};
