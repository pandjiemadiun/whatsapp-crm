/**
 * ADMIN AUTH LIMITER
 * Window: 15 minutes, Max 5 requests
 * Purpose: Prevent brute force attacks on admin login
 */
export declare const adminAuthLimiter: import("express-rate-limit").RateLimitRequestHandler;
/**
 * STORE AUTH LIMITER
 * Window: 15 minutes, Max 5 requests
 * Purpose: Prevent brute force attacks on store login/register
 */
export declare const storeAuthLimiter: import("express-rate-limit").RateLimitRequestHandler;
/**
 * GENERAL API LIMITER
 * Window: 15 minutes, Max 1000 requests per IP
 * Purpose: Global safety net
 */
export declare const generalLimiter: import("express-rate-limit").RateLimitRequestHandler;
/**
 * CONVERSATION API LIMITER
 * Window: 15 minutes, Max 100 requests per IP
 * Purpose: Prevent abuse of messaging endpoint
 */
export declare const conversationLimiter: import("express-rate-limit").RateLimitRequestHandler;
/**
 * PWA INIT CONTACT LIMITER
 * Window: 15 minutes, Max 30 requests per IP
 * Purpose: Throttle PWA first-open /init-contact discovery
 */
export declare const pwaInitLimiter: import("express-rate-limit").RateLimitRequestHandler;
/**
 * PWA PRODUCTS LIMITER
 * Window: 15 minutes, Max 200 requests per IP
 * Purpose: Throttle public product catalog discovery
 */
export declare const pwaProductsLimiter: import("express-rate-limit").RateLimitRequestHandler;
/**
 * PWA LOCATIONS LIMITER
 * Window: 15 minutes, Max 30 requests per IP
 *
 * Public, customer-facing RajaOngkir reference data (provinces/cities/
 * subdistricts). Deliberately TIGHTER than pwaProductsLimiter: each hit also
 * consumes the EXTERNAL daily RajaOngkir quota (≈100/day, shared across all
 * stores), so this must protect the shared quota from anonymous abuse — not
 * just our own server load.
 */
export declare const pwaLocationsLimiter: import("express-rate-limit").RateLimitRequestHandler;
/**
 * PWA SHIPPING-OPTIONS LIMITER
 * Window: 15 minutes, Max 30 requests per IP
 *
 * Public, customer-facing shipping-cost quote (RajaOngkir Komerce). Same rationale
 * as pwaLocationsLimiter: each hit can consume the EXTERNAL daily RajaOngkir
 * quota (≈100/day, shared across all stores), so this must protect the shared
 * quota from anonymous abuse — not just our own server load. Tighter than the
 * general limiter on purpose.
 */
export declare const pwaShippingOptionsLimiter: import("express-rate-limit").RateLimitRequestHandler;
/**
 * WEBHOOK LIMITER
 * Window: 1 minute, Max 100 requests per IP
 * Purpose: Throttle inbound webhook producers (Gowa/Fonnte)
 */
export declare const webhookLimiter: import("express-rate-limit").RateLimitRequestHandler;
/**
 * ORDER MUTATION LIMITER
 * Window: 15 minutes, Max 100 requests per IP
 * Purpose: Throttle order status mutation endpoints
 */
export declare const orderMutationLimiter: import("express-rate-limit").RateLimitRequestHandler;
//# sourceMappingURL=rate-limiters.d.ts.map