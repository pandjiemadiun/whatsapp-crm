import rateLimit from 'express-rate-limit';
import { RedisRateLimitStore } from './redis-rate-limit-store.js';

/**
 * Shared skip predicate: rate limiters that protect auth surfaces are bypassed
 * under NODE_ENV=test so test suites are not throttled. The conversation/general
 * /webhook/product limiters are intentionally NOT skipped (they must stay active
 * even in test) — their limits are high enough that normal tests stay under them.
 */
const skipInTest = () => process.env.NODE_ENV === 'test';

/**
 * ADMIN AUTH LIMITER
 * Window: 15 minutes, Max 5 requests
 * Purpose: Prevent brute force attacks on admin login
 */
export const adminAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  store: new RedisRateLimitStore('rl:admin-auth', 15 * 60 * 1000),
});

/**
 * STORE AUTH LIMITER
 * Window: 15 minutes, Max 5 requests
 * Purpose: Prevent brute force attacks on store login/register
 */
export const storeAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Terlalu banyak percobaan, coba lagi dalam beberapa menit' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  store: new RedisRateLimitStore('rl:store-auth', 15 * 60 * 1000),
});

/**
 * GENERAL API LIMITER
 * Window: 15 minutes, Max 1000 requests per IP
 * Purpose: Global safety net
 */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
  // Skipped under NODE_ENV=test (jest). The tsx-based suites run with
  // NODE_ENV=production and are expected to stay under the 1000/15m ceiling.
  skip: skipInTest,
  store: new RedisRateLimitStore('rl:general', 15 * 60 * 1000),
});

/**
 * CONVERSATION API LIMITER
 * Window: 15 minutes, Max 100 requests per IP
 * Purpose: Prevent abuse of messaging endpoint
 */
export const conversationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore('rl:conversation', 15 * 60 * 1000),
});

/**
 * PWA INIT CONTACT LIMITER
 * Window: 15 minutes, Max 30 requests per IP
 * Purpose: Throttle PWA first-open /init-contact discovery
 */
export const pwaInitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  store: new RedisRateLimitStore('rl:pwa-init', 15 * 60 * 1000),
});

/**
 * PWA PRODUCTS LIMITER
 * Window: 15 minutes, Max 200 requests per IP
 * Purpose: Throttle public product catalog discovery
 */
export const pwaProductsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore('rl:pwa-products', 15 * 60 * 1000),
});

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
export const pwaLocationsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore('rl:pwa-locations', 15 * 60 * 1000),
});

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
export const pwaShippingOptionsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  store: new RedisRateLimitStore('rl:pwa-shipping-options', 15 * 60 * 1000),
});

/**
 * WEBHOOK LIMITER
 * Window: 1 minute, Max 100 requests per IP
 * Purpose: Throttle inbound webhook producers (Gowa/Fonnte)
 */
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many webhook requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore('rl:webhook', 60 * 1000),
});

/**
 * ORDER MUTATION LIMITER
 * Window: 15 minutes, Max 100 requests per IP
 * Purpose: Throttle order status mutation endpoints
 */
export const orderMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  store: new RedisRateLimitStore('rl:order-mutation', 15 * 60 * 1000),
});
