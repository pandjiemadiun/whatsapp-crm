import { eventBus } from './event-bus.service.js';
import { realtimeService } from './realtime.service.js';
import { prisma } from '../infrastructure/prisma.js';
import { adapters } from '../adapters/container.js';
import { sendPush, ensureVapidConfigured } from './push.service.js';
const PREVIEW_MAX = 80;
function truncate(text, max) {
    if (!text)
        return '';
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
}
async function getStoreSubscriptions(storeId) {
    const rows = await prisma.storePushSubscription.findMany({
        where: { storeId },
        select: { endpoint: true, auth: true, p256dh: true },
    });
    return rows.map((r) => ({
        endpoint: r.endpoint,
        keys: { auth: r.auth, p256dh: r.p256dh },
    }));
}
async function clearExpiredSubscription(storeId, endpoint) {
    await prisma.storePushSubscription
        .deleteMany({ where: { storeId, endpoint } })
        .catch(() => { });
}
async function sendToStore(storeId, message, eventTag) {
    // Tenant isolation assertion: only send to the store that owns the event.
    const subs = await getStoreSubscriptions(storeId);
    if (!subs.length)
        return;
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
    init() {
        if (!ensureVapidConfigured()) {
            adapters.logger.warn('merchant push DISABLED (no VAPID keys)');
            return;
        }
        eventBus.subscribe('order.created', (env) => {
            this.handleOrderCreated(env).catch((e) => {
                adapters.logger.error('merchant push order.created handler error', e);
            });
        });
        eventBus.subscribe('order.payment_verification_pending', (env) => {
            this.handlePaymentPending(env).catch((e) => {
                adapters.logger.error('merchant push payment_pending handler error', e);
            });
        });
        eventBus.subscribe('message.created', (env) => {
            this.handleCustomerMessage(env).catch((e) => {
                adapters.logger.error('merchant push message.created handler error', e);
            });
        });
        adapters.logger.info('merchant push service initialized (subscriber: order.created, order.payment_verification_pending, message.created)');
    },
    async handleOrderCreated(env) {
        const data = env.data;
        // Strict tenant assertion
        if (data.storeId !== env.storeId) {
            adapters.logger.warn('merchant push order.created: storeId mismatch', { envStore: env.storeId, dataStore: data.storeId });
            return;
        }
        await sendToStore(env.storeId, {
            title: 'Pesanan Baru',
            body: `Pesanan baru (${data.itemCount ?? 0} item)`,
            url: '/dashboard/orders',
            tag: `order-${data.orderId}`,
        }, `order-${data.orderId}`);
    },
    async handlePaymentPending(env) {
        const data = env.data;
        if (data.storeId !== env.storeId) {
            adapters.logger.warn('merchant push payment_pending: storeId mismatch', { envStore: env.storeId, dataStore: data.storeId });
            return;
        }
        await sendToStore(env.storeId, {
            title: 'Verifikasi Pembayaran',
            body: 'Pelanggan melaporkan pembayaran',
            url: '/dashboard/orders',
            tag: `payment-${data.orderId}`,
        }, `payment-${data.orderId}`);
    },
    async handleCustomerMessage(env) {
        const data = env.data;
        if (data.storeId !== env.storeId) {
            adapters.logger.warn('merchant push message.created: storeId mismatch', { envStore: env.storeId, dataStore: data.storeId });
            return;
        }
        // Only push for customer→admin direction (opposite of customer-side push which triggers on human_agent)
        if (data.sender !== 'customer')
            return;
        await sendToStore(env.storeId, {
            title: 'Pesan Baru',
            body: `${data.customerName ?? 'Pelanggan'}: ${truncate(data.content, PREVIEW_MAX)}`,
            url: '/dashboard/conversations',
            tag: `msg-${data.id}`,
        }, `msg-${data.id}`);
    },
};
//# sourceMappingURL=merchant-push.service.js.map