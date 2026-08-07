export type RouteKind = 'order_change' | 'cart_modify' | 'cart_clarify' | 'total' | 'order_status' | 'waterfall';
export interface RouteDecision {
    kind: RouteKind;
    intent?: string | null;
    add?: string[];
    remove?: string[];
    confidence?: number;
    correction?: string | null;
    reason?: string;
}
export interface RouteContext {
    conversationId: string;
    storeId: string;
    cart: ConfirmedItemLike[];
    activeOrder: ActiveOrderLike | null;
    customerCity: string | null;
    lowerMsg: string;
    previousMutation?: {
        cartSnapshot: ConfirmedItemLike[];
        message: string;
    } | null;
}
export interface ConfirmedItemLike {
    product: string;
    qty?: number | string | null;
    price?: number | null;
}
export interface ActiveOrderLike {
    id: string;
    orderStatus: string;
    items: any[];
    notes?: string | null;
}
/**
 * Build a lightweight context for decideRoute, optionally fetching from DB
 * if fullContext is not provided.
 * For tests: pass `{ conversationId, storeId, cart, activeOrder, customerCity, lowerMsg }`
 * For production: the caller fetches these beforehand to avoid N+1.
 */
export declare function buildRouteContext(conversationId: string, storeId: string, customerMessage: string, customerCity?: string | null): Promise<RouteContext>;
/**
 * Keputusan rute utama:
 *  1. Total query → 'total' (skip cart gatekeeper)
 *  2. Order status keyword → 'order_status'
 *  3. Order change keyword + active order → 'order_change'
 *  4. Jika activeOrder ada & keyword tidak match → Groq semantic gate
 *  5. Cart items + MODIFY_CART intent → 'cart_modify'
 *  6. Otherwise → 'waterfall'
 */
export declare function decideRoute(ctx: RouteContext): Promise<RouteDecision>;
//# sourceMappingURL=route-decider.d.ts.map