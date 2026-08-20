import { Router } from 'express';
import { adminAuthMiddleware } from '../../middleware/adminAuth.js';
import { metricsStore } from '../../middleware/metrics.middleware.js';
const router = Router();
router.use(adminAuthMiddleware);
// GET /api/admin/metrics/system — basic system observability (single-instance, in-memory).
// NOTE: intentionally NOT on /api/health (that endpoint is the LB probe and must stay
// lightweight — SELECT 1 only). This endpoint is separate and may be slightly heavier
// since it is rarely called.
router.get('/system', (req, res) => {
    const mem = process.memoryUsage();
    const requests = metricsStore.snapshot();
    res.json({
        memory: {
            rss: mem.rss,
            heapUsed: mem.heapUsed,
            heapTotal: mem.heapTotal,
            external: mem.external,
            arrayBuffers: mem.arrayBuffers,
        },
        uptime: process.uptime(),
        requests,
        timestamp: new Date().toISOString(),
    });
});
export default router;
//# sourceMappingURL=system-metrics.js.map