import { backupService } from '../business/backup.service.js';
import { backupConfig } from '../config/backup.config.js';
import { adapters } from '../adapters/container.js';
export async function getBackupHealth() {
    try {
        const latest = await backupService.getLatestBackup();
        const now = Date.now();
        const hoursSinceLastBackup = latest
            ? (now - latest.createdAt.getTime()) / 1000 / 60 / 60
            : Infinity;
        const issues = [];
        if (!backupConfig.encryptionKey) {
            issues.push('Encryption key not set');
        }
        if (hoursSinceLastBackup > 48) {
            issues.push(`Last backup > 48 hours ago (${Math.round(hoursSinceLastBackup)}h)`);
        }
        let status;
        if (issues.length === 0) {
            status = 'healthy';
        }
        else if (issues.length <= 2) {
            status = 'degraded';
        }
        else {
            status = 'unhealthy';
        }
        return {
            status,
            lastBackup: latest?.createdAt?.toISOString() || null,
            hoursSinceLastBackup: Math.round(hoursSinceLastBackup * 10) / 10,
            encryptionKeyPresent: !!backupConfig.encryptionKey,
            issues: issues.length > 0 ? issues : undefined,
        };
    }
    catch (error) {
        adapters.logger.warn('Backup health check failed', error);
        return {
            status: 'unhealthy',
            lastBackup: null,
            hoursSinceLastBackup: null,
            encryptionKeyPresent: !!backupConfig.encryptionKey,
            issues: ['Backup health check failed'],
        };
    }
}
//# sourceMappingURL=backup.health.js.map