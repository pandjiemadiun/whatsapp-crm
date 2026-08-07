import { Router } from 'express';
import { adapters } from '../../adapters/container.js';
import { searchLogs, getLogDetail, getLogStats, exportLogs, } from '../../business/auditLog.service.js';
const router = Router();
// ─── GET /api/admin/audit-logs/stats — Activity statistics (must be before /:logId) ───
router.get('/stats', async (req, res) => {
    try {
        const storeId = req.query.storeId;
        const stats = await getLogStats(storeId);
        res.json({ success: true, data: stats });
    }
    catch (error) {
        adapters.logger.error('Failed to get audit log stats', error);
        res.status(500).json({ error: error?.message || 'Failed to get stats' });
    }
});
// ─── GET /api/admin/audit-logs — Search & list logs ───
router.get('/', async (req, res) => {
    try {
        const { page, pageSize, action, entity, storeId, userId, startDate, endDate } = req.query;
        const result = await searchLogs({
            page: page ? parseInt(page) : undefined,
            pageSize: pageSize ? parseInt(pageSize) : undefined,
            action: action,
            entity: entity,
            storeId: storeId,
            userId: userId,
            startDate: startDate ? new Date(startDate) : undefined,
            endDate: endDate ? new Date(endDate) : undefined,
        });
        res.json({ success: true, data: result });
    }
    catch (error) {
        adapters.logger.error('Failed to search audit logs', error);
        res.status(500).json({ error: error?.message || 'Failed to search logs' });
    }
});
// ─── GET /api/admin/audit-logs/:logId — Get single log detail ───
router.get('/:logId', async (req, res) => {
    try {
        const log = await getLogDetail(req.params.logId);
        res.json({ success: true, data: log });
    }
    catch (error) {
        if (error.message === 'Log not found') {
            return res.status(404).json({ error: 'Log not found' });
        }
        adapters.logger.error('Failed to get audit log', error);
        res.status(500).json({ error: error?.message || 'Failed to get log' });
    }
});
// ─── POST /api/admin/audit-logs/export — Export logs ───
router.post('/export', async (req, res) => {
    try {
        const { format, filters } = req.body;
        if (!format || !['json', 'csv'].includes(format)) {
            return res.status(400).json({ error: 'format must be "json" or "csv"' });
        }
        const data = await exportLogs(filters || {}, format);
        const dateStr = new Date().toISOString().slice(0, 10);
        const filename = `audit-logs-${dateStr}.${format}`;
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', format === 'json' ? 'application/json' : 'text/csv');
        res.send(data);
    }
    catch (error) {
        adapters.logger.error('Failed to export audit logs', error);
        res.status(500).json({ error: error?.message || 'Failed to export logs' });
    }
});
export default router;
//# sourceMappingURL=audit-logs.js.map