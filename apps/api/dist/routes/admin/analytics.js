import { Router } from 'express';
import { requireAdminRole } from '../../middleware/adminAuthGuard.js';
import { analyticsService } from '../../business/analytics.service.js';
import { adapters } from '../../adapters/container.js';
const router = Router();
// ─── GET /api/admin/analytics?range=7d|30d|90d ───
// Super_admin only. Returns aggregated analytics over the specified time range.
// Uses 5-minute TTL caching.
router.get('/', requireAdminRole(['super_admin']), async (req, res) => {
    try {
        const range = req.query.range || '30d';
        const validRanges = ['7d', '30d', '90d'];
        if (!validRanges.includes(range)) {
            return res.status(400).json({ error: `range must be one of: ${validRanges.join(', ')}` });
        }
        const forceRefresh = req.query.refresh === 'true';
        const result = await analyticsService.getAnalytics(range, forceRefresh);
        res.json({
            success: true,
            data: result,
        });
    }
    catch (error) {
        adapters.logger.error('Failed to fetch analytics', error);
        res.status(500).json({ error: error?.message || 'Failed to fetch analytics' });
    }
});
// ─── POST /api/admin/analytics/invalidate-cache ───
// Force-clear the analytics cache so the next request recomputes.
router.post('/invalidate-cache', requireAdminRole(['super_admin']), (_req, res) => {
    analyticsService.invalidateCache();
    res.json({ success: true, message: 'Analytics cache invalidated' });
});
export default router;
//# sourceMappingURL=analytics.js.map