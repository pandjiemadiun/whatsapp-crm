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
/**
 * GOWA trust middleware.
 *
 * Verifies the incoming request originates from a loopback address (same VPS).
 * Does NOT use X-Forwarded-For (spoofable). Does NOT implement HMAC (GOWA
 * does not sign webhooks — UNVERIFIED, per owner decision HOLD).
 *
 * On failure: 403 Forbidden.
 */
export declare function gowaTrustMiddleware(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=gowa-trust.d.ts.map