import { Router } from 'express';
import { healthService } from '../business/health.service.js';
import { getBackupHealth } from '../health/backup.health.js';
import { adminAuthMiddleware } from '../middleware/adminAuth.js';
import { adapters } from '../adapters/container.js';
const router = Router();
// ─── GET /api/health — Public (no auth), lightweight cached status ───
router.get('/health', async (_req, res) => {
    try {
        const status = await healthService.getSystemStatus();
        res.json({
            status: status.status,
            message: status.status === 'ok'
                ? 'All systems operational'
                : status.status === 'degraded'
                    ? 'Some systems degraded'
                    : 'Critical systems down',
        });
    }
    catch (error) {
        adapters.logger.error('Health check failed', error);
        res.json({ status: 'down', message: 'Health check failed' });
    }
});
// ─── GET /api/admin/health — Detailed (requires adminAuth) ───
router.get('/admin/health', (req, _res, next) => adminAuthMiddleware(req, _res, next), async (req, res) => {
    try {
        const [status, backupHealth] = await Promise.all([
            healthService.getSystemStatus(true),
            getBackupHealth(),
        ]);
        res.json({ success: true, data: { ...status, backup: backupHealth } });
    }
    catch (error) {
        adapters.logger.error('Admin health check failed', error);
        res.status(500).json({ error: error?.message || 'Health check failed' });
    }
});
export default router;
//# sourceMappingURL=health.js.map