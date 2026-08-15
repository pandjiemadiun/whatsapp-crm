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
import type { OrderWithItems } from '../domain/types.js';
export declare const ALLOWED_TRANSITIONS: Record<string, Set<string>>;
export declare const CONFIRMED_STATUSES: Set<string>;
export declare class InvalidOrderTransitionError extends Error {
    fromStatus: string;
    toStatus: string;
    orderId: string;
    constructor(fromStatus: string, toStatus: string, orderId: string);
}
export interface TransitionOrderOptions {
    /** Actor for audit log (e.g. admin user id or 'system'). Defaults to 'system'. */
    actor?: string;
    /** Override prisma client (for transactions or test injection). */
    tx?: PrismaClient | typeof prisma;
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
export declare function transitionOrder(orderId: string, toStatus: string, options?: TransitionOrderOptions): Promise<OrderWithItems>;
/** Check if a transition is valid without executing it */
export declare function isTransitionAllowed(fromStatus: string, toStatus: string): boolean;
/** Get all statuses that `fromStatus` can transition to (excluding self) */
export declare function getAllowedTransitions(fromStatus: string): string[];
type PrismaClient = {
    order: {
        findUnique: typeof prisma.order.findUnique;
        update: typeof prisma.order.update;
    };
};
export {};
//# sourceMappingURL=order-transition.d.ts.map