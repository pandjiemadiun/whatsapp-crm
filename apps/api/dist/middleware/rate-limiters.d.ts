/**
 * ADMIN AUTH LIMITER
 * Window: 15 minutes, Max 5 requests
 * Purpose: Prevent brute force attacks on admin login
 * Status: INTENTIONAL — load test hit this, not a pool error
 * Test note: Use NODE_ENV=test to bypass
 */
export declare const adminAuthLimiter: import("express-rate-limit").RateLimitRequestHandler;
/**
 * STORE AUTH LIMITER
 * Window: 15 minutes, Max 5 requests
 * Purpose: Prevent brute force attacks on store login/register
 * Status: KEEP AS-IS
 */
export declare const storeAuthLimiter: import("express-rate-limit").RateLimitRequestHandler;
/**
 * GENERAL API LIMITER
 * Window: 15 minutes, Max 1000 requests per IP
 * Purpose: Global safety net
 * Status: SUITABLE for production
 */
export declare const generalLimiter: import("express-rate-limit").RateLimitRequestHandler;
/**
 * CONVERSATION API LIMITER
 * Window: 15 minutes, Max 100 requests per IP
 * Purpose: Prevent abuse of messaging endpoint
 * Status: SUITABLE for production
 */
export declare const conversationLimiter: import("express-rate-limit").RateLimitRequestHandler;
//# sourceMappingURL=rate-limiters.d.ts.map