/**
 * Structured Actions Route — P0 ADD_TO_CART endpoint
 *
 * POST /api/pwa/:storeSlug/action
 * Body: { uid: string, action: AddToCartRequest }
 *
 * Server-resolves store/customer/conversation identity —
 * NEVER trusts client-supplied identity as business authority.
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=actions.d.ts.map