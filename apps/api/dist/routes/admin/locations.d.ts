/**
 * Location reference endpoints (RajaOngkir Starter reference data).
 *
 * This router has NO internal auth on purpose: it is mounted TWICE in
 * index.ts — once under /api/admin/locations (adminAuthMiddleware) and once
 * under /api/store/locations (authMiddleware, for the merchant dashboard's
 * cascading address dropdown). Auth is enforced at the mount point.
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=locations.d.ts.map