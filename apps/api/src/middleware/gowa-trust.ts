/**
 * GOWA Network Trust Boundary (G2-B.2)
 *
 * GOWA runs on the same VPS as the API (localhost:3001).
 * Webhook calls from GOWA arrive on the loopback interface (127.0.0.1 / ::1).
 *
 * This middleware enforces source-restriction at the TCP level (NOT via
 * X-Forwarded-For which is spoofable). It checks `req.socket.remoteAddress`
 * to verify the connection originates from a loopback address.
 *
 * DO NOT add GOWA HMAC/secret — GOWA does not sign requests (UNVERIFIED).
 * device_id is NOT authentication — it is only tenant identification AFTER
 * the request source is trusted.
 *
 * Topology: Single VPS, Express API on :3000 behind Cloudflare Tunnel.
 * GOWA (localhost:3001) calls the API directly via loopback — NOT through
 * the tunnel. Therefore only loopback sources are trusted for GOWA webhooks.
 */

import type { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger.js';

/** Loopback addresses to trust for GOWA webhook origin */
const TRUSTED_ADDRESSES = new Set([
  '127.0.0.1',     // IPv4 loopback
  '::1',           // IPv6 loopback
  '::ffff:127.0.0.1', // IPv4-mapped IPv6 loopback
  '::ffff:0:0',    // alternative IPv4-mapped form
]);

/**
 * Check whether an IP address string is a loopback address.
 * Checks both the trusted set and prefix-based patterns.
 */
function isLoopback(ip: string | undefined | null): boolean {
  if (!ip) return false;
  if (TRUSTED_ADDRESSES.has(ip)) return true;
  // 127.0.0.0/8 range (all 127.x.x.x are loopback)
  if (ip.startsWith('127.')) return true;
  // ::ffff:127.0.0.0/104 mapped range
  if (ip.startsWith('::ffff:127.')) return true;
  return false;
}

/**
 * Extract the actual TCP-level remote address.
 * Uses req.socket.remoteAddress which is NOT affected by X-Forwarded-For
 * spoofing (it is the real network-layer source).
 */
function getRemoteAddress(req: Request): string | undefined {
  return (
    req.socket?.remoteAddress ||
    (req as any).connection?.remoteAddress ||
    undefined
  );
}

/**
 * GOWA trust middleware.
 *
 * Verifies the incoming request originates from a loopback address (same VPS).
 * Does NOT use X-Forwarded-For (spoofable). Does NOT implement HMAC (GOWA
 * does not sign webhooks — UNVERIFIED, per owner decision HOLD).
 *
 * On failure: 403 Forbidden.
 */
export function gowaTrustMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const remoteAddress = getRemoteAddress(req);

  if (!isLoopback(remoteAddress)) {
    // Log the actual TCP source (not X-Forwarded-For) for debugging
    const forwardedFor = req.headers['x-forwarded-for'];
    logger.warn('GOWA webhook rejected — source not loopback', {
      remoteAddress,
      xForwardedFor: forwardedFor,
      path: req.path,
      userAgent: req.get('user-agent'),
    });

    res.status(403).json({ error: 'Forbidden: source not trusted' });
    return;
  }

  next();
}
