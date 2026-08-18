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