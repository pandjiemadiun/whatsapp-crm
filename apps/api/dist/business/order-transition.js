/**
 * Order Transition Invariant (G2-B.6)
 *
 * Authoritative state machine for order status transitions.
 *
 * Invariant: confirmed ⇒ confirmedAt != null
 *
 * This module is the SINGLE source of truth for valid order status
 * transitions. Both order.service.ts:updateOrderStatus and routes/orders.ts
 * delegate here — no raw prisma.order.update for status anywhere else.
 *
 * allowed transitions:
 *   draft → confirmed, cancelled, pending, waiting_address
 *   pending → confirmed, cancelled, paid, packing, shipped
 *   waiting_address → waiting_payment, paid, cancelled
 *   waiting_payment → paid, cancelled
 *   confirmed → packing, cancelled
 *   packing → shipped, cancelled
 *   paid → packing, shipped, cancelled
 *   shipped → completed, cancelled, refunded
 *   completed → refunded
 *   cancelled → (terminal)
 *   refunded → (terminal)
 */
import { prisma } from '../infrastructure/prisma.js';
import { adapters } from '../adapters/container.js';
import { ApiError } from '../errors/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
// ── Allowed transitions ───────────────────────────────────────────────────
export const ALLOWED_TRANSITIONS = {
    draft: new Set(['confirmed', 'cancelled', 'pending', 'waiting_address']),
    pending: new Set(['confirmed', 'cancelled', 'paid', 'packing', 'shipped']),
    waiting_address: new Set(['waiting_payment', 'paid', 'cancelled']),
    waiting_payment: new Set(['paid', 'cancelled']),
    confirmed: new Set(['packing', 'cancelled']),
    packing: new Set(['shipped', 'cancelled']),
    paid: new Set(['packing', 'shipped', 'cancelled']),
    shipped: new Set(['completed', 'cancelled', 'refunded']),
    completed: new Set(['refunded']),
    cancelled: new Set(), // terminal
    refunded: new Set(), // terminal
};
// ── Statuses that trigger confirmedAt ─────────────────────────────────────
export const CONFIRMED_STATUSES = new Set(['confirmed', 'paid']);
// ── Error type ───────────────────────────────────────────────────────────
export class InvalidOrderTransitionError extends Error {
    constructor(fromStatus, toStatus, orderId) {
        super(`Invalid order transition: ${fromStatus} → ${toStatus} (orderId=${orderId})`);
        this.fromStatus = fromStatus;
        this.toStatus = toStatus;
        this.orderId = orderId;
        this.name = 'InvalidOrderTransitionError';
    }
}
/**
 * Transition an order to a new status with strict validation.
 *
 * - Enforces ALLOWED_TRANSITIONS state machine
 * - Sets confirmedAt when transitioning to `confirmed` or `paid`
 * - Same-status is idempotent (no-op, preserves existing confirmedAt)
 * - Transaction-safe (optional tx client)
 * - Ownership is validated by the caller (orders.ts checks storeId)
 *
 * @returns The updated OrderWithItems including orderItems
 */
export async function transitionOrder(orderId, toStatus, options) {
    const tx = (options?.tx ?? prisma);
    const actor = options?.actor || 'system';
    // Fetch order + items in one query
    const existing = await tx.order.findUnique({
        where: { id: orderId },
        include: { orderItems: { orderBy: { createdAt: 'asc' } } },
    });
    if (!existing || existing.deletedAt) {
        throw new ApiError(ErrorCodes.ERR_NOT_FOUND, `Order ${orderId} not found`);
    }
    const fromStatus = existing.orderStatus;
    // Idempotent: same-status transition is a no-op (preserves confirmedAt)
    if (fromStatus === toStatus) {
        adapters.logger.info('Order transition: idempotent no-op', {
            orderId,
            status: toStatus,
            actor,
        });
        return mapOrderWithItems(existing);
    }
    // Validate transition
    const allowed = ALLOWED_TRANSITIONS[fromStatus];
    if (!allowed || !allowed.has(toStatus)) {
        throw new InvalidOrderTransitionError(fromStatus, toStatus, orderId);
    }
    // Build update data — set confirmedAt for confirmed/paid transitions
    const data = {
        orderStatus: toStatus,
    };
    if (CONFIRMED_STATUSES.has(toStatus)) {
        // Only set confirmedAt if not already set (idempotent for future same-status)
        data.confirmedAt = existing.confirmedAt ?? new Date();
    }
    const row = await tx.order.update({
        where: { id: orderId },
        data,
        include: { orderItems: { orderBy: { createdAt: 'asc' } } },
    });
    adapters.logger.info('Order transition', {
        orderId,
        from: fromStatus,
        to: toStatus,
        actor,
        confirmedAtSet: CONFIRMED_STATUSES.has(toStatus),
    });
    return mapOrderWithItems(row);
}
// ── Helpers ──────────────────────────────────────────────────────────────
/** Check if a transition is valid without executing it */
export function isTransitionAllowed(fromStatus, toStatus) {
    if (fromStatus === toStatus)
        return true; // idempotent
    const allowed = ALLOWED_TRANSITIONS[fromStatus];
    return !!allowed && allowed.has(toStatus);
}
/** Get all statuses that `fromStatus` can transition to (excluding self) */
export function getAllowedTransitions(fromStatus) {
    return Array.from(ALLOWED_TRANSITIONS[fromStatus] || []);
}
function mapOrderWithItems(raw) {
    return {
        id: raw.id,
        storeId: raw.storeId,
        conversationId: raw.conversationId,
        customerId: raw.customerId,
        totalPrice: raw.totalPrice,
        currency: raw.currency,
        orderStatus: raw.orderStatus,
        shippingAddress: raw.shippingAddress,
        notes: raw.notes,
        confirmedAt: raw.confirmedAt,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
        items: (raw.orderItems ?? []).map((i) => ({
            id: i.id,
            orderId: i.orderId,
            productId: i.productId,
            productName: i.productName,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            subtotal: i.subtotal,
            customizations: i.customizations,
            createdAt: i.createdAt,
            updatedAt: i.updatedAt,
        })),
    };
}
//# sourceMappingURL=order-transition.js.map