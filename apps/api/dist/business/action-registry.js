/**
 * Action Registry — Typed registry for structured actions (§4)
 *
 * Single source of truth for action definitions.
 * Delegates business authority to CartAuthority.
 * Does NOT replace CartAuthority.
 */
import { z } from 'zod';
import { prisma } from '../infrastructure/prisma.js';
import { cartAuthority } from './cart-authority.js';
import { executeHandoff } from '../services/handoff.service.js';
import { productService } from './product.service.js';
import { orderService } from './order.service.js';
import { ApiError } from '../errors/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
/** Lease duration for CLAIMED actions — locked to 750ms per owner approval */
export const LEASE_FINAL_MS = 750;
/** Action status values */
export const ActionStatus = {
    CLAIMED: 'CLAIMED',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
};
/** ADD_TO_CART request schema */
export const AddToCartRequestSchema = z.object({
    actionId: z.string().uuid(),
    type: z.literal('ADD_TO_CART'),
    payload: z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive(),
    }),
});
/** ADD_TO_CART response schema */
export const AddToCartResponseSchema = z.object({
    success: z.boolean(),
    actionId: z.string().uuid(),
    type: z.literal('ADD_TO_CART'),
    status: z.enum(['already_applied', 'applied', 'action_in_progress']),
    result: z.object({
        productId: z.string().uuid(),
        quantityAdded: z.number().int().positive(),
        cart: z.object({
            items: z.array(z.object({
                id: z.string().uuid(),
                productId: z.string().uuid().nullable(),
                productName: z.string(),
                quantity: z.number().int(),
                unitPrice: z.number(),
                subtotal: z.number(),
            })),
            total: z.number(),
        }),
    }).optional(),
    error: z.object({
        code: z.string(),
        message: z.string(),
    }).optional(),
});
/** REMOVE_FROM_CART request schema (P6-2 — cart mutation, idempotent).
 *  Identifier is lineItemId (OrderItem.id) — consistent with existing
 *  CartAuthority.removeLine()/updateQuantity() which are keyed by lineItemId.
 *  The line item is re-validated server-side inside the tenant-scoped
 *  conversation cart, so a client-supplied lineItemId is never trusted as final. */
export const RemoveFromCartRequestSchema = z.object({
    actionId: z.string().uuid(),
    type: z.literal('REMOVE_FROM_CART'),
    payload: z.object({
        lineItemId: z.string().uuid(),
    }),
});
/** REMOVE_FROM_CART response schema — follows §5.4 AddToCartResponse pattern. */
export const RemoveFromCartResponseSchema = z.object({
    success: z.boolean(),
    actionId: z.string().uuid(),
    type: z.literal('REMOVE_FROM_CART'),
    status: z.enum(['already_applied', 'applied', 'action_in_progress']),
    result: z.object({
        removedLineItemId: z.string().uuid(),
        cart: z.object({
            items: z.array(z.object({
                id: z.string(),
                productId: z.string().uuid().nullable(),
                productName: z.string(),
                quantity: z.number().int(),
                unitPrice: z.number(),
                subtotal: z.number(),
            })),
            total: z.number(),
        }),
    }).optional(),
    error: z.object({
        code: z.string(),
        message: z.string(),
    }).optional(),
});
/** UPDATE_CART_QUANTITY request schema (P6-2 — cart mutation, idempotent). */
export const UpdateCartQuantityRequestSchema = z.object({
    actionId: z.string().uuid(),
    type: z.literal('UPDATE_CART_QUANTITY'),
    payload: z.object({
        lineItemId: z.string().uuid(),
        quantity: z.number().int().positive(),
    }),
});
/** UPDATE_CART_QUANTITY response schema — follows §5.4 AddToCartResponse pattern. */
export const UpdateCartQuantityResponseSchema = z.object({
    success: z.boolean(),
    actionId: z.string().uuid(),
    type: z.literal('UPDATE_CART_QUANTITY'),
    status: z.enum(['already_applied', 'applied', 'action_in_progress']),
    result: z.object({
        updatedLineItemId: z.string().uuid(),
        quantity: z.number().int().positive(),
        cart: z.object({
            items: z.array(z.object({
                id: z.string(),
                productId: z.string().uuid().nullable(),
                productName: z.string(),
                quantity: z.number().int(),
                unitPrice: z.number(),
                subtotal: z.number(),
            })),
            total: z.number(),
        }),
    }).optional(),
    error: z.object({
        code: z.string(),
        message: z.string(),
    }).optional(),
});
/** CANCEL_ORDER request schema (P6-3 — order mutation, idempotent).
 *  Identifier is orderId (Order.id). Ownership (storeId + customerId) is
 *  re-validated server-side inside orderService.cancelOrder against the
 *  tenant-scoped order row, so a client-supplied orderId is never trusted as
 *  final authority. Reuses the SAME Stage-1/Stage-2 idempotency/lock pattern
 *  as REMOVE_FROM_CART / UPDATE_CART_QUANTITY (claim → executeClaimedAction,
 *  FOR UPDATE + re-check, SAVEPOINT). */
export const CancelOrderRequestSchema = z.object({
    actionId: z.string().uuid(),
    type: z.literal('CANCEL_ORDER'),
    payload: z.object({
        orderId: z.string().uuid(),
    }),
});
/** CANCEL_ORDER response schema — follows the §5.4 mutation pattern. */
export const CancelOrderResponseSchema = z.object({
    success: z.boolean(),
    actionId: z.string().uuid(),
    type: z.literal('CANCEL_ORDER'),
    status: z.enum(['already_applied', 'applied', 'action_in_progress']),
    result: z.object({
        orderId: z.string().uuid(),
        orderStatus: z.string(),
    }).optional(),
    error: z.object({
        code: z.string(),
        message: z.string(),
    }).optional(),
});
/** SHOW_RELATED_PRODUCTS request schema (P1 — non-mutating discovery) */
export const ShowRelatedProductsRequestSchema = z.object({
    actionId: z.string().uuid(),
    type: z.literal('SHOW_RELATED_PRODUCTS'),
    payload: z.object({
        productId: z.string().uuid(),
    }),
});
/** SHOW_RELATED_PRODUCTS response schema — deterministic, authoritative product data */
export const ShowRelatedProductsResponseSchema = z.object({
    success: z.boolean(),
    actionId: z.string().uuid(),
    type: z.literal('SHOW_RELATED_PRODUCTS'),
    status: z.enum(['applied']),
    result: z.object({
        products: z.array(z.object({
            id: z.string().uuid(),
            name: z.string(),
            price: z.number(),
            stock: z.number().nullable(),
            imageUrl: z.string().nullable(),
        })),
    }),
    error: z.object({
        code: z.string(),
        message: z.string(),
    }).optional(),
});
/** OPEN_CATALOG request schema (P2 — non-mutating discovery) */
export const OpenCatalogRequestSchema = z.object({
    actionId: z.string().uuid(),
    type: z.literal('OPEN_CATALOG'),
    payload: z.object({
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().nonnegative().optional(),
    }).optional(),
});
/** OPEN_CATALOG response schema — maps existing PWA product-list shape + total. */
export const OpenCatalogResponseSchema = z.object({
    success: z.boolean(),
    actionId: z.string().uuid(),
    type: z.literal('OPEN_CATALOG'),
    status: z.enum(['applied']),
    result: z.object({
        products: z.array(z.object({
            id: z.string().uuid(),
            name: z.string(),
            price: z.number(),
            stock: z.number().nullable(),
            imageUrl: z.string().nullable(),
        })),
        total: z.number().int().nonnegative(),
    }),
    error: z.object({
        code: z.string(),
        message: z.string(),
    }).optional(),
});
/** OPEN_CART request schema (P3 — non-mutating discovery). Payload is empty:
 * the authoritative cart is resolved server-side via context.conversationId. */
export const OpenCartRequestSchema = z.object({
    actionId: z.string().uuid(),
    type: z.literal('OPEN_CART'),
    payload: z.object({}),
});
/** OPEN_CART response schema — authoritative CartSummary from CartAuthority. */
export const OpenCartResponseSchema = z.object({
    success: z.boolean(),
    actionId: z.string().uuid(),
    type: z.literal('OPEN_CART'),
    status: z.enum(['applied']),
    result: z.object({
        items: z.array(z.object({
            id: z.string(),
            productId: z.string().nullable(),
            productName: z.string(),
            quantity: z.number().int(),
            unitPrice: z.number(),
            subtotal: z.number(),
        })),
        total: z.number().nullable(),
    }),
    error: z.object({
        code: z.string(),
        message: z.string(),
    }).optional(),
});
/** OPEN_ORDER_HISTORY request schema (P5 — non-mutating read-only). Payload is empty. */
export const OpenOrderHistoryRequestSchema = z.object({
    actionId: z.string().uuid(),
    type: z.literal('OPEN_ORDER_HISTORY'),
    payload: z.object({}),
});
/** OPEN_ORDER_HISTORY response schema — customer-safe order history. */
export const OpenOrderHistoryResponseSchema = z.object({
    success: z.boolean(),
    actionId: z.string().uuid(),
    type: z.literal('OPEN_ORDER_HISTORY'),
    status: z.enum(['applied']),
    result: z.object({
        orders: z.array(z.object({
            id: z.string(),
            status: z.string(),
            statusLabel: z.string(),
            totalPrice: z.number().nullable(),
            currency: z.string(),
            createdAt: z.any(),
            items: z.array(z.object({
                productName: z.string(),
                quantity: z.number().int(),
                unitPrice: z.number(),
                subtotal: z.number(),
            })),
        })),
    }),
    error: z.object({
        code: z.string(),
        message: z.string(),
    }).optional(),
});
/** CONTACT_ADMIN request schema (P4-2 — human takeover / "Hubungi CS").
 *  No business payload: identity is server-resolved from ActionContext.
 *  payload is optional {} to keep the wire shape uniform with other actions. */
export const ContactAdminRequestSchema = z.object({
    actionId: z.string().uuid(),
    type: z.literal('CONTACT_ADMIN'),
    payload: z.object({}).optional(),
});
/** CONTACT_ADMIN response schema — status only, no sensitive payload. */
export const ContactAdminResponseSchema = z.object({
    success: z.boolean(),
    actionId: z.string().uuid(),
    type: z.literal('CONTACT_ADMIN'),
    status: z.enum(['applied', 'already_applied']),
});
/**
 * Resolve productId to productName + unitPrice (authoritative from DB)
 * Reuses existing productService for tenant isolation
 */
async function resolveProductForCart(tx, storeId, productId) {
    const product = await tx.product.findUnique({
        where: { id: productId },
        select: { id: true, name: true, price: true, storeId: true, isActive: true, deletedAt: true },
    });
    if (!product)
        return null;
    if (product.storeId !== storeId)
        return null;
    if (!product.isActive || product.deletedAt)
        return null;
    return { productName: product.name, unitPrice: product.price };
}
/**
 * STAGE 1 — CLAIM
 * Short independent transaction: INSERT ActionIdempotency status=CLAIMED
 * Returns { claimed: true } if insert succeeded, { claimed: false, existing } if P2002
 */
async function claimAction(storeId, customerId, actionType, actionId) {
    const idempotencyKey = `${storeId}:${customerId}:${actionType}:${actionId}`;
    const now = new Date();
    try {
        await prisma.$transaction(async (tx) => {
            const leaseUntil = new Date(now.getTime() + LEASE_FINAL_MS);
            await tx.actionIdempotency.create({
                data: {
                    idempotencyKey,
                    storeId,
                    customerId,
                    actionType,
                    actionId,
                    status: ActionStatus.CLAIMED,
                    claimedAt: now,
                    leaseUntil,
                },
            });
        });
        return { claimed: true };
    }
    catch (e) {
        if (e.code === 'P2002') {
            // Record exists — read it
            const existing = await prisma.actionIdempotency.findUnique({
                where: { idempotencyKey },
            });
            return { claimed: false, existing };
        }
        throw e;
    }
}
/**
 * STAGE 2 — EXECUTE CLAIMED ACTION
 * Single executor with FOR UPDATE + latest status re-check
 * Uses SAVEPOINT for business validation errors
 */
async function executeClaimedAction(storeId, customerId, conversationId, actionType, actionId, executeMutation) {
    return await prisma.$transaction(async (tx) => {
        // SELECT FOR UPDATE — lock the ActionIdempotency row
        const record = await tx.$queryRaw `
      SELECT * FROM "action_idempotency"
      WHERE "storeId" = ${storeId}
        AND "customerId" = ${customerId}
        AND "actionType" = ${actionType}
        AND "actionId" = ${actionId}
      FOR UPDATE
    `;
        if (record.length === 0) {
            // Race: record deleted (should not happen per §6A.11.5)
            throw new Error('ActionIdempotency record not found during executeClaimedAction');
        }
        const current = record[0];
        // RE-CHECK latest status — authority for mutation decision
        switch (current.status) {
            case ActionStatus.COMPLETED:
                return { status: ActionStatus.COMPLETED, result: current.result };
            case ActionStatus.FAILED:
                return { status: ActionStatus.FAILED, error: current.error };
            case ActionStatus.CLAIMED:
                // Proceed to execution
                break;
            default:
                throw new Error(`Unknown ActionIdempotency status: ${current.status}`);
        }
        // SAVEPOINT for business validation rollback
        await tx.$executeRaw `SAVEPOINT cart_action`;
        try {
            const result = await executeMutation(tx);
            // SUCCESS: RELEASE SAVEPOINT, mark COMPLETED
            await tx.$executeRaw `RELEASE SAVEPOINT cart_action`;
            const idempotencyKey = current.idempotencyKey;
            await tx.actionIdempotency.update({
                where: { idempotencyKey },
                data: {
                    status: ActionStatus.COMPLETED,
                    result: result,
                    completedAt: new Date(),
                    leaseUntil: new Date(), // lease no longer relevant
                },
            });
            return { status: ActionStatus.COMPLETED, result };
        }
        catch (e) {
            // BUSINESS VALIDATION ERROR: ROLLBACK TO SAVEPOINT, mark FAILED
            // Check if it's a CartInvariantError (business error)
            const isBusinessError = e.name === 'CartInvariantError' ||
                e.name === 'ProductAmbiguousError' ||
                (e.code && e.code.startsWith('INVALID_')) ||
                (e.code && e.code.startsWith('INSUFFICIENT_')) ||
                (e.code && e.code.startsWith('CROSS_')) ||
                (e.code && e.code.startsWith('PRODUCT_'));
            if (isBusinessError) {
                await tx.$executeRaw `ROLLBACK TO SAVEPOINT cart_action`;
                const idempotencyKey = current.idempotencyKey || current.id;
                await tx.actionIdempotency.update({
                    where: { idempotencyKey },
                    data: {
                        status: ActionStatus.FAILED,
                        error: {
                            code: e.code || 'BUSINESS_VALIDATION_ERROR',
                            message: e.message,
                        },
                    },
                });
                return {
                    status: ActionStatus.FAILED,
                    error: { code: e.code || 'BUSINESS_VALIDATION_ERROR', message: e.message }
                };
            }
            // INFRASTRUCTURE ERROR: re-throw to abort outer transaction
            // ActionIdempotency remains CLAIMED, lease handles recovery
            throw e;
        }
    });
}
/**
 * ADD_TO_CART Handler
 * Delegates to CartAuthority.executeOps with external tx
 */
export async function handleAddToCart(request, context) {
    const { actionId, payload } = request;
    const { storeId, customerId, conversationId } = context;
    const actionType = 'ADD_TO_CART';
    // STAGE 1: CLAIM
    const claim = await claimAction(storeId, customerId, actionType, actionId);
    if (!claim.claimed) {
        const existing = claim.existing;
        // Branch: COMPLETED
        if (existing.status === ActionStatus.COMPLETED) {
            return {
                success: true,
                data: {
                    success: true,
                    actionId,
                    type: 'ADD_TO_CART',
                    status: 'already_applied',
                    result: existing.result,
                },
                status: 'already_applied',
            };
        }
        // Branch: FAILED
        if (existing.status === ActionStatus.FAILED) {
            return {
                success: false,
                error: existing.error || { code: 'ACTION_FAILED', message: 'Action previously failed' },
                status: 'already_applied',
            };
        }
        // Branch: CLAIMED + lease valid
        if (existing.status === ActionStatus.CLAIMED) {
            const leaseUntil = new Date(existing.leaseUntil);
            if (leaseUntil > new Date()) {
                // Lease still valid — immediate 409
                return {
                    success: false,
                    error: { code: 'ACTION_IN_PROGRESS', message: 'Action is being processed' },
                    status: 'action_in_progress',
                };
            }
            // Lease expired — fall through to executeClaimedAction
        }
    }
    // STAGE 2: Execute with FOR UPDATE + re-check
    const executeMutation = async (tx) => {
        // Resolve productId authoritatively (tenant isolated)
        const product = await resolveProductForCart(tx, storeId, payload.productId);
        if (!product) {
            const err = new Error('Product not found or not accessible');
            err.code = 'PRODUCT_NOT_FOUND';
            err.name = 'CartInvariantError';
            throw err;
        }
        // Build CartOp for CartAuthority.executeOps.
        // Structured/validated path: kirim productId langsung (sudah di-resolve
        // server-side + tenant-scoped di atas) sehingga executeOps skip
        // round-trip resolveProductByName. `product` tetap diisi sebagai fallback
        // backward-compat bila suatu saat dipakai jalur tanpa productId.
        const ops = [{
                type: 'add',
                productId: payload.productId,
                product: product.productName,
                qty: payload.quantity,
            }];
        // Execute cart mutation — THIS IS THE ONLY CART MUTATION ENTRY POINT
        const cartLines = await cartAuthority.executeOps(ops, storeId, customerId, conversationId, tx);
        // Compute deterministic result per §5.4 contract
        const items = cartLines.map(item => ({
            id: payload.productId,
            productId: payload.productId,
            productName: item.product,
            quantity: typeof item.qty === 'number' ? item.qty : (typeof item.qty === 'string' ? Number(item.qty) : 1),
            unitPrice: typeof item.price === 'number' ? item.price : 0,
            subtotal: (typeof item.price === 'number' ? item.price : 0) * (typeof item.qty === 'number' ? item.qty : (typeof item.qty === 'string' ? Number(item.qty) : 1)),
        }));
        const total = items.reduce((sum, item) => sum + item.subtotal, 0);
        return {
            productId: payload.productId,
            quantityAdded: payload.quantity,
            cart: { items, total },
        };
    };
    const execution = await executeClaimedAction(storeId, customerId, conversationId, actionType, actionId, executeMutation);
    if (execution.status === ActionStatus.COMPLETED) {
        return {
            success: true,
            data: {
                success: true,
                actionId,
                type: 'ADD_TO_CART',
                status: 'applied',
                result: execution.result,
            },
            status: 'applied',
        };
    }
    if (execution.status === ActionStatus.FAILED) {
        return {
            success: false,
            error: execution.error || { code: 'EXECUTION_FAILED', message: 'Action failed' },
            status: 'already_applied',
        };
    }
    // Should not reach here
    throw new Error('Unexpected execution status');
}
/** Map CartAuthority CartLine[] → §5.4 response cart shape. */
function cartLinesToResponse(lines) {
    const items = lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        productName: l.productName,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        subtotal: l.subtotal,
    }));
    const total = items.reduce((s, i) => s + i.subtotal, 0);
    return { items, total };
}
/**
 * REMOVE_FROM_CART Handler (P6-2)
 * Delegates to CartAuthority.removeLine within the SAME idempotency/lock
 * pattern as handleAddToCart (claim → executeClaimedAction, FOR UPDATE +
 * re-check, SAVEPOINT for business errors). removeLine re-validates the
 * lineItemId ownership server-side (tenant-scoped draft order), so a
 * cross-tenant / not-in-cart lineItemId yields a structured ITEM_NOT_FOUND
 * business error (FAILED), never a raw crash.
 */
export async function handleRemoveFromCart(request, context) {
    const { actionId, payload } = request;
    const { storeId, customerId, conversationId } = context;
    const actionType = 'REMOVE_FROM_CART';
    const claim = await claimAction(storeId, customerId, actionType, actionId);
    if (!claim.claimed) {
        const existing = claim.existing;
        if (existing.status === ActionStatus.COMPLETED) {
            return {
                success: true,
                data: {
                    success: true,
                    actionId,
                    type: 'REMOVE_FROM_CART',
                    status: 'already_applied',
                    result: existing.result,
                },
                status: 'already_applied',
            };
        }
        if (existing.status === ActionStatus.FAILED) {
            return {
                success: false,
                error: existing.error || { code: 'ACTION_FAILED', message: 'Action previously failed' },
                status: 'already_applied',
            };
        }
        if (existing.status === ActionStatus.CLAIMED) {
            const leaseUntil = new Date(existing.leaseUntil);
            if (leaseUntil > new Date()) {
                return {
                    success: false,
                    error: { code: 'ACTION_IN_PROGRESS', message: 'Action is being processed' },
                    status: 'action_in_progress',
                };
            }
        }
    }
    const executeMutation = async (tx) => {
        const lines = await cartAuthority.removeLine(conversationId, payload.lineItemId, tx);
        return {
            removedLineItemId: payload.lineItemId,
            cart: cartLinesToResponse(lines),
        };
    };
    const execution = await executeClaimedAction(storeId, customerId, conversationId, actionType, actionId, executeMutation);
    if (execution.status === ActionStatus.COMPLETED) {
        return {
            success: true,
            data: {
                success: true,
                actionId,
                type: 'REMOVE_FROM_CART',
                status: 'applied',
                result: execution.result,
            },
            status: 'applied',
        };
    }
    if (execution.status === ActionStatus.FAILED) {
        return {
            success: false,
            error: execution.error || { code: 'EXECUTION_FAILED', message: 'Action failed' },
            status: 'already_applied',
        };
    }
    throw new Error('Unexpected execution status');
}
/**
 * UPDATE_CART_QUANTITY Handler (P6-2)
 * Delegates to CartAuthority.updateQuantity within the SAME idempotency/lock
 * pattern as handleAddToCart. updateQuantity re-validates the lineItemId
 * ownership server-side; qty=0 deletes the line. A not-in-cart / cross-tenant
 * lineItemId yields a structured ITEM_NOT_FOUND business error (FAILED).
 */
export async function handleUpdateCartQuantity(request, context) {
    const { actionId, payload } = request;
    const { storeId, customerId, conversationId } = context;
    const actionType = 'UPDATE_CART_QUANTITY';
    const claim = await claimAction(storeId, customerId, actionType, actionId);
    if (!claim.claimed) {
        const existing = claim.existing;
        if (existing.status === ActionStatus.COMPLETED) {
            return {
                success: true,
                data: {
                    success: true,
                    actionId,
                    type: 'UPDATE_CART_QUANTITY',
                    status: 'already_applied',
                    result: existing.result,
                },
                status: 'already_applied',
            };
        }
        if (existing.status === ActionStatus.FAILED) {
            return {
                success: false,
                error: existing.error || { code: 'ACTION_FAILED', message: 'Action previously failed' },
                status: 'already_applied',
            };
        }
        if (existing.status === ActionStatus.CLAIMED) {
            const leaseUntil = new Date(existing.leaseUntil);
            if (leaseUntil > new Date()) {
                return {
                    success: false,
                    error: { code: 'ACTION_IN_PROGRESS', message: 'Action is being processed' },
                    status: 'action_in_progress',
                };
            }
        }
    }
    const executeMutation = async (tx) => {
        const lines = await cartAuthority.updateQuantity(conversationId, payload.lineItemId, payload.quantity, tx);
        return {
            updatedLineItemId: payload.lineItemId,
            quantity: payload.quantity,
            cart: cartLinesToResponse(lines),
        };
    };
    const execution = await executeClaimedAction(storeId, customerId, conversationId, actionType, actionId, executeMutation);
    if (execution.status === ActionStatus.COMPLETED) {
        return {
            success: true,
            data: {
                success: true,
                actionId,
                type: 'UPDATE_CART_QUANTITY',
                status: 'applied',
                result: execution.result,
            },
            status: 'applied',
        };
    }
    if (execution.status === ActionStatus.FAILED) {
        return {
            success: false,
            error: execution.error || { code: 'EXECUTION_FAILED', message: 'Action failed' },
            status: 'already_applied',
        };
    }
    throw new Error('Unexpected execution status');
}
/**
 * CANCEL_ORDER Handler (P6-3)
 * Delegates to OrderService.cancelOrder within the SAME idempotency/lock
 * pattern as handleAddToCart / handleRemoveFromCart / handleUpdateCartQuantity
 * (claim → executeClaimedAction, FOR UPDATE + re-check, SAVEPOINT for
 * business errors). cancelOrder re-validates the orderId ownership
 * server-side (storeId + customerId against the tenant-scoped Order row) and
 * enforces the order-transition state machine, so a cross-tenant / not-owned /
 * terminal-state orderId yields a structured INVALID_* business error (FAILED),
 * never a raw crash. CartAuthority is NOT touched (target row is Order, not
 * OrderItem).
 */
export async function handleCancelOrder(request, context) {
    const { actionId, payload } = request;
    const { storeId, customerId, conversationId } = context;
    const actionType = 'CANCEL_ORDER';
    const claim = await claimAction(storeId, customerId, actionType, actionId);
    if (!claim.claimed) {
        const existing = claim.existing;
        if (existing.status === ActionStatus.COMPLETED) {
            return {
                success: true,
                data: {
                    success: true,
                    actionId,
                    type: 'CANCEL_ORDER',
                    status: 'already_applied',
                    result: existing.result,
                },
                status: 'already_applied',
            };
        }
        if (existing.status === ActionStatus.FAILED) {
            return {
                success: false,
                error: existing.error || { code: 'ACTION_FAILED', message: 'Action previously failed' },
                status: 'already_applied',
            };
        }
        if (existing.status === ActionStatus.CLAIMED) {
            const leaseUntil = new Date(existing.leaseUntil);
            if (leaseUntil > new Date()) {
                return {
                    success: false,
                    error: { code: 'ACTION_IN_PROGRESS', message: 'Action is being processed' },
                    status: 'action_in_progress',
                };
            }
        }
    }
    const executeMutation = async (tx) => {
        const cancelled = await orderService.cancelOrder(payload.orderId, storeId, customerId, { tx });
        return {
            orderId: payload.orderId,
            orderStatus: cancelled.orderStatus,
        };
    };
    const execution = await executeClaimedAction(storeId, customerId, conversationId, actionType, actionId, executeMutation);
    if (execution.status === ActionStatus.COMPLETED) {
        return {
            success: true,
            data: {
                success: true,
                actionId,
                type: 'CANCEL_ORDER',
                status: 'applied',
                result: execution.result,
            },
            status: 'applied',
        };
    }
    if (execution.status === ActionStatus.FAILED) {
        return {
            success: false,
            error: execution.error || { code: 'EXECUTION_FAILED', message: 'Action failed' },
            status: 'already_applied',
        };
    }
    throw new Error('Unexpected execution status');
}
/**
 * SHOW_RELATED_PRODUCTS Handler (P1 — non-mutating, read-only).
 *
 * Does NOT create ActionIdempotency records and does NOT use the
 * CLAIMED/COMPLETED/FAILED lease state machine — those are scoped to
 * mutations (§6A). This is a pure read delegated to productService.
 */
export async function handleShowRelatedProducts(request, context) {
    const { actionId, payload } = request;
    const products = await productService.getRelatedProducts(payload.productId, {
        storeId: context.storeId,
    });
    const resultProducts = products.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        stock: p.stock,
        imageUrl: p.primaryImageUrl,
    }));
    return {
        success: true,
        data: {
            success: true,
            actionId,
            type: 'SHOW_RELATED_PRODUCTS',
            status: 'applied',
            result: { products: resultProducts },
        },
        status: 'applied',
    };
}
/**
 * OPEN_CATALOG Handler (P2 — non-mutating, read-only).
 *
 * Reuses the EXISTING authoritative catalog reader:
 *   productService.getProductsByStore(context.storeId, { limit, offset })
 * which is tenant-scoped by the server-derived context.storeId, filters
 * deletedAt IS NULL + isActive = true, and is bounded (limit 1–100, default 20).
 *
 * Does NOT create ActionIdempotency records and does NOT use the
 * CLAIMED/COMPLETED/FAILED lease state machine — those are scoped to
 * mutations (§6A). This is a pure read delegated to productService.
 */
export async function handleOpenCatalog(request, context) {
    const { actionId } = request;
    const { products, total } = await productService.getProductsByStore(context.storeId, {
        limit: request.payload?.limit,
        offset: request.payload?.offset,
    });
    const resultProducts = products.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        stock: p.stock,
        imageUrl: p.primaryImageUrl ?? null,
    }));
    return {
        success: true,
        data: {
            success: true,
            actionId,
            type: 'OPEN_CATALOG',
            status: 'applied',
            result: { products: resultProducts, total },
        },
        status: 'applied',
    };
}
/**
 * OPEN_CART Handler (P3 — non-mutating, read-only).
 *
 * Reuses the EXISTING authoritative cart reader:
 *   cartAuthority.getCartSummary(context.conversationId)
 * which is tenant-bound: context.conversationId is resolved server-side by
 * getOrCreateWebSession (storeId + customerId + channel='web'), the SAME
 * resolver the /message route and /action route share.
 *
 * Does NOT create ActionIdempotency records and does NOT use the
 * CLAIMED/COMPLETED/FAILED lease state machine — those are scoped to
 * mutations (§6A). This is a pure read delegated to CartAuthority.
 */
export async function handleOpenCart(request, context) {
    const { actionId } = request;
    const summary = await cartAuthority.getCartSummary(context.conversationId);
    return {
        success: true,
        data: {
            success: true,
            actionId,
            type: 'OPEN_CART',
            status: 'applied',
            result: {
                items: summary.items,
                total: summary.total,
            },
        },
        status: 'applied',
    };
}
/**
 * OPEN_ORDER_HISTORY Handler (P5 — non-mutating, read-only).
 *
 * Returns customer order history scoped to the server-resolved conversation.
 * Reuses OrderService.getOrderHistoryForWeb() — NO raw Prisma order queries
 * in the action registry. Follows the read-only pattern of OPEN_CATALOG/OPEN_CART:
 * does NOT create ActionIdempotency records, does NOT use the CLAIMED/COMPLETED
 * lease state machine, does NOT invoke CartAuthority or ConversationEngine.
 */
/** Customer-facing order-status labels (P5 — order history display). */
const ORDER_STATUS_LABELS = {
    pending: 'Diproses',
    confirmed: 'Dikonfirmasi',
    paid: 'Sudah Bayar',
    packing: 'Dikemas',
    shipped: 'Terkirim',
    completed: 'Selesai',
    cancelled: 'Dibatalkan',
    refunded: 'Direfund',
};
/** Internal pipeline states hidden from the customer order-history view. */
const NON_CUSTOMER_FACING_ORDER_STATUSES = new Set([
    'draft',
    'waiting_address',
    'waiting_payment',
]);
export async function handleOpenOrderHistory(request, context) {
    const { actionId } = request;
    // Delegate to OrderService — domain authority, not raw Prisma.
    // context.conversationId is server-derived (§7) — never client-supplied.
    const allOrders = await orderService.getOrdersByConversation(context.conversationId);
    // Customer-facing statuses only, capped at 10 (P5).
    const orders = allOrders
        .filter((o) => !NON_CUSTOMER_FACING_ORDER_STATUSES.has(o.orderStatus))
        .slice(0, 10)
        .map((o) => ({
        id: o.id,
        status: o.orderStatus,
        statusLabel: ORDER_STATUS_LABELS[o.orderStatus] ?? o.orderStatus,
        totalPrice: o.totalPrice,
        currency: o.currency,
        createdAt: o.createdAt,
        items: o.items.map((i) => ({
            productName: i.productName,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            subtotal: i.subtotal,
        })),
    }));
    return {
        success: true,
        data: {
            success: true,
            actionId,
            type: 'OPEN_ORDER_HISTORY',
            status: 'applied',
            result: { orders },
        },
        status: 'applied',
    };
}
/**
 * CONTACT_ADMIN Handler (P4-2 — human takeover / "Hubungi CS").
 *
 * Reuses the shared handoffService.executeHandoff() (extracted from the PWA
 * /handoff route) so the escalation convention stays single-source.
 *
 * - Identity (storeId/customerId/conversationId) is server-resolved from
 *   ActionContext — NEVER from the client payload (§7).
 * - Does NOT use ActionIdempotency / claim / lease: this is a simple
 *   read-modify guarded by conversation.status, not a cart/order mutation
 *   (per P4-1 recommendation #6).
 * - Idempotency guard: if the conversation is ALREADY 'human_takeover',
 *   return status 'already_applied' WITHOUT re-triggering the handoff
 *   (no duplicate history row, no duplicate events).
 */
export async function handleContactAdmin(request, context) {
    const { conversationId, storeId } = context;
    // Tenant-scoped lookup: conversationId is server-resolved for this store, but
    // re-assert ownership here so a cross-tenant (or missing) conversation is
    // rejected rather than silently handed off.
    const existing = await prisma.conversation.findUnique({
        where: { id: conversationId, storeId },
        select: { status: true },
    });
    if (!existing) {
        throw new ApiError(ErrorCodes.ERR_AUTH_FORBIDDEN, 'Conversation not found for store');
    }
    // Guard: avoid double handoff / duplicate events + history row.
    if (existing.status === 'human_takeover') {
        return {
            success: true,
            data: {
                success: true,
                actionId: request.actionId,
                type: 'CONTACT_ADMIN',
                status: 'already_applied',
            },
            status: 'already_applied',
        };
    }
    await executeHandoff({ conversationId, storeId, channel: context.channel });
    return {
        success: true,
        data: {
            success: true,
            actionId: request.actionId,
            type: 'CONTACT_ADMIN',
            status: 'applied',
        },
        status: 'applied',
    };
}
/**
 * Action Registry — single definition for ADD_TO_CART
 */
export const actionRegistry = {
    CANCEL_ORDER: {
        type: 'CANCEL_ORDER',
        requestSchema: CancelOrderRequestSchema,
        responseSchema: CancelOrderResponseSchema,
        handler: handleCancelOrder,
        authorize: async (_request, _context) => {
            // orderId ownership (storeId + customerId) is re-validated server-side
            // inside orderService.cancelOrder against the tenant-scoped Order row
            // (ownership + terminal-state check). No client-supplied store/customer
            // has authority; mirror the REMOVE_FROM_CART/UPDATE_CART_QUANTITY
            // conversation-scoped trust model. CartAuthority is NOT invoked.
            return { allowed: true };
        },
    },
    REMOVE_FROM_CART: {
        type: 'REMOVE_FROM_CART',
        requestSchema: RemoveFromCartRequestSchema,
        responseSchema: RemoveFromCartResponseSchema,
        handler: handleRemoveFromCart,
        authorize: async (_request, _context) => {
            // lineItemId is re-validated server-side inside removeLine against this
            // conversation's tenant-scoped draft order (ownership + existence check).
            // No client-supplied store/conversation has authority; mirror the
            // OPEN_CART read-only trust model for conversation-scoped mutations.
            return { allowed: true };
        },
    },
    UPDATE_CART_QUANTITY: {
        type: 'UPDATE_CART_QUANTITY',
        requestSchema: UpdateCartQuantityRequestSchema,
        responseSchema: UpdateCartQuantityResponseSchema,
        handler: handleUpdateCartQuantity,
        authorize: async (_request, _context) => {
            // lineItemId + quantity are re-validated server-side inside
            // updateQuantity against this conversation's tenant-scoped draft order.
            return { allowed: true };
        },
    },
    ADD_TO_CART: {
        type: 'ADD_TO_CART',
        requestSchema: AddToCartRequestSchema,
        responseSchema: AddToCartResponseSchema,
        handler: handleAddToCart,
        authorize: async (request, context) => {
            // Authorization: verify product belongs to store (tenant isolation)
            const product = await productService.getProductById(request.payload.productId);
            if (!product || product.storeId !== context.storeId) {
                return { allowed: false, reason: 'Product not found in store' };
            }
            if (!product.isActive || product.deletedAt) {
                return { allowed: false, reason: 'Product not available' };
            }
            return { allowed: true };
        },
    },
    SHOW_RELATED_PRODUCTS: {
        type: 'SHOW_RELATED_PRODUCTS',
        requestSchema: ShowRelatedProductsRequestSchema,
        responseSchema: ShowRelatedProductsResponseSchema,
        handler: handleShowRelatedProducts,
        authorize: async (request, context) => {
            // Authorization: verify the source product belongs to the store (tenant isolation).
            // A cross-tenant productId is rejected before any domain read.
            const product = await productService.getProductById(request.payload.productId);
            if (!product || product.storeId !== context.storeId) {
                return { allowed: false, reason: 'Product not found in store' };
            }
            return { allowed: true };
        },
    },
    /** P2 — OPEN_CATALOG: read-only catalog/discovery entry. Registered after SHOW_RELATED. */
    OPEN_CATALOG: {
        type: 'OPEN_CATALOG',
        requestSchema: OpenCatalogRequestSchema,
        responseSchema: OpenCatalogResponseSchema,
        handler: handleOpenCatalog,
        authorize: async (_request, _context) => {
            // Catalog is store-scoped by definition; tenant isolation is enforced
            // server-side by context.storeId (resolved by getOrCreateWebSession in
            // the /action route). No productId to tenant-check. Mirror SHOW_RELATED
            // tenant-trust model: do not re-claim or re-lease.
            return { allowed: true };
        },
    },
    /** P3 — OPEN_CART: read-only cart discovery entry. Registered after OPEN_CATALOG. */
    OPEN_CART: {
        type: 'OPEN_CART',
        requestSchema: OpenCartRequestSchema,
        responseSchema: OpenCartResponseSchema,
        handler: handleOpenCart,
        authorize: async (_request, _context) => {
            // Cart is conversation-scoped by definition; tenant isolation is enforced
            // server-side: context.conversationId is resolved by getOrCreateWebSession
            // (store-bound). No client-supplied conversationId/storeId has authority.
            // Mirror OPEN_CATALOG/P1 tenant-trust model: do not re-claim or re-lease.
            return { allowed: true };
        },
    },
    /** P5 — OPEN_ORDER_HISTORY: read-only customer order history. Registered after OPEN_CART. */
    OPEN_ORDER_HISTORY: {
        type: 'OPEN_ORDER_HISTORY',
        requestSchema: OpenOrderHistoryRequestSchema,
        responseSchema: OpenOrderHistoryResponseSchema,
        handler: handleOpenOrderHistory,
        authorize: async (_request, _context) => {
            // Order history is conversation-scoped by definition; tenant isolation is
            // enforced server-side: context.storeId + context.conversationId are resolved
            // by getOrCreateWebSession (store-bound). No client-supplied storeId or
            // conversationId has authority. Mirror OPEN_CATALOG/OPEN_CART read-only model.
            return { allowed: true };
        },
    },
    /** P4-2 — CONTACT_ADMIN: human takeover / "Hubungi CS". Registered after OPEN_ORDER_HISTORY. */
    CONTACT_ADMIN: {
        type: 'CONTACT_ADMIN',
        requestSchema: ContactAdminRequestSchema,
        responseSchema: ContactAdminResponseSchema,
        handler: handleContactAdmin,
        authorize: async (_request, _context) => {
            // Identity (store/customer/conversation) is server-resolved from
            // ActionContext; no client-supplied authority. Mirror OPEN_* read-only
            // tenant-trust model: do not claim or lease.
            return { allowed: true };
        },
    },
};
/**
 * Execute action by type — routes to registered handler
 */
export async function executeAction(actionType, request, context) {
    const definition = actionRegistry[actionType];
    if (!definition) {
        throw new ApiError(ErrorCodes.ERR_NOT_FOUND, `Action type not registered: ${actionType}`);
    }
    // Validate request
    const parseResult = definition.requestSchema.safeParse(request);
    if (!parseResult.success) {
        throw new ApiError(ErrorCodes.ERR_VALIDATION, `Invalid request: ${parseResult.error.issues.map(e => e.message).join(', ')}`);
    }
    // Authorization check — per §4, authorize must return { allowed, reason }
    // Wrap in try/catch so authorize() throwing (e.g. productService.getProductById)
    // is normalized to { allowed: false } rather than propagating as a raw error
    let auth;
    try {
        auth = await definition.authorize(parseResult.data, context);
    }
    catch (e) {
        auth = { allowed: false, reason: e.message || 'Authorization failed' };
    }
    if (!auth.allowed) {
        throw new ApiError(ErrorCodes.ERR_AUTH_FORBIDDEN, auth.reason || 'Not authorized');
    }
    // Execute handler
    return await definition.handler(parseResult.data, context);
}
//# sourceMappingURL=action-registry.js.map