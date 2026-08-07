import rateLimit from 'express-rate-limit';

/**
 * ADMIN AUTH LIMITER
 * Window: 15 minutes, Max 5 requests
 * Purpose: Prevent brute force attacks on admin login
 * Status: INTENTIONAL — load test hit this, not a pool error
 * Test note: Use NODE_ENV=test to bypass
 */
export const adminAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

/**
 * STORE AUTH LIMITER
 * Window: 15 minutes, Max 5 requests
 * Purpose: Prevent brute force attacks on store login/register
 * Status: KEEP AS-IS
 */
export const storeAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Terlalu banyak percobaan, coba lagi dalam beberapa menit' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

/**
 * GENERAL API LIMITER
 * Window: 15 minutes, Max 1000 requests per IP
 * Purpose: Global safety net
 * Status: SUITABLE for production
 */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * CONVERSATION API LIMITER
 * Window: 15 minutes, Max 100 requests per IP
 * Purpose: Prevent abuse of messaging endpoint
 * Status: SUITABLE for production
 */
export const conversationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});
