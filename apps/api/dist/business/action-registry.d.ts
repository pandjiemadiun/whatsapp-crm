/**
 * Action Registry — Typed registry for structured actions (§4)
 *
 * Single source of truth for action definitions.
 * Delegates business authority to CartAuthority.
 * Does NOT replace CartAuthority.
 */
import { z } from 'zod';
/** Lease duration for CLAIMED actions — locked to 750ms per owner approval */
export declare const LEASE_FINAL_MS = 750;
/** Action status values */
export declare const ActionStatus: {
    readonly CLAIMED: "CLAIMED";
    readonly COMPLETED: "COMPLETED";
    readonly FAILED: "FAILED";
};
export type ActionStatus = typeof ActionStatus[keyof typeof ActionStatus];
/** ADD_TO_CART request schema */
export declare const AddToCartRequestSchema: z.ZodObject<{
    actionId: z.ZodString;
    type: z.ZodLiteral<"ADD_TO_CART">;
    payload: z.ZodObject<{
        productId: z.ZodString;
        quantity: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>;
export type AddToCartRequest = z.infer<typeof AddToCartRequestSchema>;
/** ADD_TO_CART response schema */
export declare const AddToCartResponseSchema: z.ZodObject<{
    success: z.ZodBoolean;
    actionId: z.ZodString;
    type: z.ZodLiteral<"ADD_TO_CART">;
    status: z.ZodEnum<{
        already_applied: "already_applied";
        applied: "applied";
        action_in_progress: "action_in_progress";
    }>;
    result: z.ZodOptional<z.ZodObject<{
        productId: z.ZodString;
        quantityAdded: z.ZodNumber;
        cart: z.ZodObject<{
            items: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                productId: z.ZodNullable<z.ZodString>;
                productName: z.ZodString;
                quantity: z.ZodNumber;
                unitPrice: z.ZodNumber;
                subtotal: z.ZodNumber;
            }, z.core.$strip>>;
            total: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    error: z.ZodOptional<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type AddToCartResponse = z.infer<typeof AddToCartResponseSchema>;
/** SHOW_RELATED_PRODUCTS request schema (P1 — non-mutating discovery) */
export declare const ShowRelatedProductsRequestSchema: z.ZodObject<{
    actionId: z.ZodString;
    type: z.ZodLiteral<"SHOW_RELATED_PRODUCTS">;
    payload: z.ZodObject<{
        productId: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export type ShowRelatedProductsRequest = z.infer<typeof ShowRelatedProductsRequestSchema>;
/** SHOW_RELATED_PRODUCTS response schema — deterministic, authoritative product data */
export declare const ShowRelatedProductsResponseSchema: z.ZodObject<{
    success: z.ZodBoolean;
    actionId: z.ZodString;
    type: z.ZodLiteral<"SHOW_RELATED_PRODUCTS">;
    status: z.ZodEnum<{
        applied: "applied";
    }>;
    result: z.ZodObject<{
        products: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            price: z.ZodNumber;
            stock: z.ZodNullable<z.ZodNumber>;
            imageUrl: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    error: z.ZodOptional<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ShowRelatedProductsResponse = z.infer<typeof ShowRelatedProductsResponseSchema>;
/** OPEN_CATALOG request schema (P2 — non-mutating discovery) */
export declare const OpenCatalogRequestSchema: z.ZodObject<{
    actionId: z.ZodString;
    type: z.ZodLiteral<"OPEN_CATALOG">;
    payload: z.ZodOptional<z.ZodObject<{
        limit: z.ZodOptional<z.ZodNumber>;
        offset: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type OpenCatalogRequest = z.infer<typeof OpenCatalogRequestSchema>;
/** OPEN_CATALOG response schema — maps existing PWA product-list shape + total. */
export declare const OpenCatalogResponseSchema: z.ZodObject<{
    success: z.ZodBoolean;
    actionId: z.ZodString;
    type: z.ZodLiteral<"OPEN_CATALOG">;
    status: z.ZodEnum<{
        applied: "applied";
    }>;
    result: z.ZodObject<{
        products: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            price: z.ZodNumber;
            stock: z.ZodNullable<z.ZodNumber>;
            imageUrl: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        total: z.ZodNumber;
    }, z.core.$strip>;
    error: z.ZodOptional<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type OpenCatalogResponse = z.infer<typeof OpenCatalogResponseSchema>;
/** OPEN_CART request schema (P3 — non-mutating discovery). Payload is empty:
 * the authoritative cart is resolved server-side via context.conversationId. */
export declare const OpenCartRequestSchema: z.ZodObject<{
    actionId: z.ZodString;
    type: z.ZodLiteral<"OPEN_CART">;
    payload: z.ZodObject<{}, z.core.$strip>;
}, z.core.$strip>;
export type OpenCartRequest = z.infer<typeof OpenCartRequestSchema>;
/** OPEN_CART response schema — authoritative CartSummary from CartAuthority. */
export declare const OpenCartResponseSchema: z.ZodObject<{
    success: z.ZodBoolean;
    actionId: z.ZodString;
    type: z.ZodLiteral<"OPEN_CART">;
    status: z.ZodEnum<{
        applied: "applied";
    }>;
    result: z.ZodObject<{
        items: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            productId: z.ZodNullable<z.ZodString>;
            productName: z.ZodString;
            quantity: z.ZodNumber;
            unitPrice: z.ZodNumber;
            subtotal: z.ZodNumber;
        }, z.core.$strip>>;
        total: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>;
    error: z.ZodOptional<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type OpenCartResponse = z.infer<typeof OpenCartResponseSchema>;
/** OPEN_ORDER_HISTORY request schema (P5 — non-mutating read-only). Payload is empty. */
export declare const OpenOrderHistoryRequestSchema: z.ZodObject<{
    actionId: z.ZodString;
    type: z.ZodLiteral<"OPEN_ORDER_HISTORY">;
    payload: z.ZodObject<{}, z.core.$strip>;
}, z.core.$strip>;
export type OpenOrderHistoryRequest = z.infer<typeof OpenOrderHistoryRequestSchema>;
/** OPEN_ORDER_HISTORY response schema — customer-safe order history. */
export declare const OpenOrderHistoryResponseSchema: z.ZodObject<{
    success: z.ZodBoolean;
    actionId: z.ZodString;
    type: z.ZodLiteral<"OPEN_ORDER_HISTORY">;
    status: z.ZodEnum<{
        applied: "applied";
    }>;
    result: z.ZodObject<{
        orders: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            status: z.ZodString;
            statusLabel: z.ZodString;
            totalPrice: z.ZodNullable<z.ZodNumber>;
            currency: z.ZodString;
            createdAt: z.ZodAny;
            items: z.ZodArray<z.ZodObject<{
                productName: z.ZodString;
                quantity: z.ZodNumber;
                unitPrice: z.ZodNumber;
                subtotal: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    error: z.ZodOptional<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type OpenOrderHistoryResponse = z.infer<typeof OpenOrderHistoryResponseSchema>;
/** Generic action handler context */
export interface ActionContext {
    storeId: string;
    customerId: string;
    conversationId: string;
    channel: 'whatsapp' | 'web';
    requestId: string;
}
/** Action handler return type */
export interface ActionResult<T = unknown> {
    success: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
    };
    status: 'already_applied' | 'applied' | 'action_in_progress';
}
export interface AddToCartResult {
    success: true;
    actionId: string;
    type: 'ADD_TO_CART';
    status: 'applied' | 'already_applied';
    result: {
        productId: string;
        quantityAdded: number;
        cart: {
            items: Array<{
                id: string;
                productId: string | null;
                productName: string;
                quantity: number;
                unitPrice: number;
                subtotal: number;
            }>;
            total: number;
        };
    };
}
/**
 * Action Registry — maps action type to handler
 */
export interface ActionDefinition<Req, Res> {
    type: string;
    requestSchema: z.ZodSchema<Req>;
    responseSchema: z.ZodSchema<Res>;
    handler: (request: Req, context: ActionContext) => Promise<ActionResult<Res>>;
    authorize: (request: Req, context: ActionContext) => Promise<{
        allowed: boolean;
        reason?: string;
    }>;
}
/**
 * ADD_TO_CART Handler
 * Delegates to CartAuthority.executeOps with external tx
 */
export declare function handleAddToCart(request: AddToCartRequest, context: ActionContext): Promise<ActionResult<AddToCartResponse>>;
/**
 * SHOW_RELATED_PRODUCTS Handler (P1 — non-mutating, read-only).
 *
 * Does NOT create ActionIdempotency records and does NOT use the
 * CLAIMED/COMPLETED/FAILED lease state machine — those are scoped to
 * mutations (§6A). This is a pure read delegated to productService.
 */
export declare function handleShowRelatedProducts(request: ShowRelatedProductsRequest, context: ActionContext): Promise<ActionResult<ShowRelatedProductsResponse>>;
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
export declare function handleOpenCatalog(request: OpenCatalogRequest, context: ActionContext): Promise<ActionResult<OpenCatalogResponse>>;
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
export declare function handleOpenCart(request: OpenCartRequest, context: ActionContext): Promise<ActionResult<OpenCartResponse>>;
export declare function handleOpenOrderHistory(request: OpenOrderHistoryRequest, context: ActionContext): Promise<ActionResult<OpenOrderHistoryResponse>>;
/**
 * Action Registry — single definition for ADD_TO_CART
 */
export declare const actionRegistry: Record<string, ActionDefinition<any, any>>;
/**
 * Execute action by type — routes to registered handler
 */
export declare function executeAction(actionType: string, request: unknown, context: ActionContext): Promise<ActionResult<any>>;
//# sourceMappingURL=action-registry.d.ts.map