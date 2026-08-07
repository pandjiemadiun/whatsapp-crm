import { Router } from 'express';
import { adapters } from '../../adapters/container.js';
import { logAction } from '../../business/auditLog.service.js';
import { backupService } from '../../business/backup.service.js';
import { requireAdminRole } from '../../middleware/adminAuthGuard.js';
const router = Router();
// ─── GET /api/admin/backups — List all backups ───
router.get('/', async (req, res) => {
    try {
        const result = await backupService.getBackupsList();
        res.json({ success: true, data: result });
    }
    catch (error) {
        adapters.logger.error('Failed to list backups', error);
        res.status(500).json({ error: error?.message || 'Failed to list backups' });
    }
});
// ─── GET /api/admin/backups/:filename/verify — Verify integrity ───
router.get('/:filename/verify', async (req, res) => {
    try {
        const result = await backupService.verifyBackupIntegrity(req.params.filename);
        res.json({ success: true, data: result });
    }
    catch (error) {
        adapters.logger.error('Failed to verify backup', error);
        res.status(500).json({ error: error?.message || 'Failed to verify backup' });
    }
});
// ─── POST /api/admin/backups — Create manual backup ───
router.post('/', async (req, res) => {
    try {
        const result = await backupService.createDatabaseBackup('manual');
        await logAction({
            storeId: 'system',
            action: 'backup_manual',
            entity: 'Backup',
            entityId: result.filename,
            adminId: req.admin.adminId,
            changes: { type: 'manual', size: result.size },
            ipAddress: req.ip,
        });
        res.status(201).json({ success: true, data: result });
    }
    catch (error) {
        adapters.logger.error('Failed to create backup', error);
        res.status(500).json({ error: error?.message || 'Failed to create backup' });
    }
});
// ─── POST /api/admin/backups/:filename/restore — Restore from backup ───
router.post('/:filename/restore', requireAdminRole(['super_admin']), async (req, res) => {
    try {
        await backupService.restoreDatabase(req.params.filename);
        await logAction({
            storeId: 'system',
            action: 'backup_restored',
            entity: 'Backup',
            entityId: req.params.filename,
            adminId: req.admin.adminId,
            changes: { filename: req.params.filename },
            ipAddress: req.ip,
        });
        res.json({ success: true, message: 'Database restored' });
    }
    catch (error) {
        adapters.logger.error('Failed to restore backup', error);
        res.status(500).json({ error: error?.message || 'Failed to restore backup' });
    }
});
// ─── DELETE /api/admin/backups/:filename — Delete backup ───
router.delete('/:filename', requireAdminRole(['super_admin']), async (req, res) => {
    try {
        await backupService.deleteBackup(req.params.filename);
        await logAction({
            storeId: 'system',
            action: 'backup_deleted',
            entity: 'Backup',
            entityId: req.params.filename,
            adminId: req.admin.adminId,
            changes: { filename: req.params.filename },
            ipAddress: req.ip,
        });
        res.json({ success: true, message: 'Backup deleted' });
    }
    catch (error) {
        adapters.logger.error('Failed to delete backup', error);
        res.status(500).json({ error: error?.message || 'Failed to delete backup' });
    }
});
export default router;
//# sourceMappingURL=backups.js.map