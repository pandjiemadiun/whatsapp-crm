import cron from 'node-cron';
import { adapters } from '../adapters/container.js';
import { prisma } from '../infrastructure/prisma.js';
import { transitionOrder } from '../business/order-transition.js';
import { shouldRestoreStock, restoreStockForOrderItems } from '../business/order.service.js';
// PV-P1-08: 15-minute sweep of stuck unpaid orders. Matches the checkout()
// reservation — orders are stamped autoCancelAt (now + ORDER_AUTO_CANCEL_HOURS,
// default 24h) when their stock is atomically decremented at checkout.
/**
 * Run a single auto-cancel pass against the live DB.
 * `now` is injected for deterministic unit tests (defaults to "now").
 *
 * Selection (ALL required, per PV-P1-08):
 *   - orderStatus IN (waiting_address, waiting_payment)
 *   - autoCancelAt <= now          (the checkout reservation window elapsed)
 *   - paymentStatus != 'pending_verification'  (customer already submitted proof
 *     and is awaiting admin → NOT abandoned → must NOT be auto-cancelled)
 *
 * autoCancelAt = NULL (orders never stamped by checkout) is excluded by the
 * `lte` filter, so legacy/manual-window orders are left untouched.
 *
 * For each hit: (restore stock if pre-shipment) + transitionOrder('cancelled'),
 * inside a per-order $transaction. One stuck order must never abort the sweep.
 *
 * Returns the count of orders auto-cancelled.
 */
export async function runAutoCancelOnce(now = new Date()) {
    const orders = await prisma.order.findMany({
        where: {
            orderStatus: { in: ['waiting_address', 'waiting_payment'] },
            autoCancelAt: { lte: now },
            paymentStatus: { not: 'pending_verification' },
        },
        include: { orderItems: { where: { productId: { not: null } } } },
    });
    if (orders.length === 0) {
        return 0;
    }
    let cancelled = 0;
    for (const order of orders) {
        try {
            await prisma.$transaction(async (tx) => {
                // Reverse the checkout stock decrement (pre-shipment only).
                // shouldRestoreStock excludes shipped/paid-refund (goods dispatched)
                // and draft (never decremented). cancelled is terminal, so a
                // double-restore on the same order cannot occur via the state machine.
                if (shouldRestoreStock(order.orderStatus)) {
                    await restoreStockForOrderItems(order.orderItems, tx);
                }
                await transitionOrder(order.id, 'cancelled', { actor: 'system:auto-cancel', tx: tx });
            });
            cancelled++;
            adapters.logger.info('Auto-canceled expired order', {
                orderId: order.id,
                orderStatus: order.orderStatus,
                paymentStatus: order.paymentStatus,
                autoCancelAt: order.autoCancelAt,
                storeId: order.storeId,
                reason: 'autoCancelAt elapsed (PV-P1-08)',
            });
        }
        catch (error) {
            // A single stuck/failed order must NOT abort the rest of the sweep.
            adapters.logger.error('Auto-cancel failed for order', {
                orderId: order.id,
                error: error?.message,
                stack: error?.stack,
            });
        }
    }
    return cancelled;
}
/**
 * Schedule the recurring auto-cancel sweep: every 15 minutes.
 * Reuses the node-cron + adapters.logger pattern from scheduleBackups.ts.
 */
export function scheduleAutoCancel() {
    cron.schedule('*/15 * * * *', async () => {
        try {
            const count = await runAutoCancelOnce();
            if (count > 0) {
                adapters.logger.info('[AutoCancel] sweep complete', { cancelled: count });
            }
        }
        catch (error) {
            adapters.logger.error('[AutoCancel] sweep errored', error);
        }
    });
    adapters.logger.info('[AutoCancel] Started (every 15 minutes, skipping pending_verification)');
}
//# sourceMappingURL=scheduleAutoCancel.js.map