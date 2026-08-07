import { configService } from '../business/config.service.js';
export const backupConfig = {
    enabled: true,
    scheduleDaily: '0 2 * * *',
    scheduleWeekly: '0 3 * * 0',
    retentionDays: 30,
    encryptionKey: '',
    s3Bucket: '',
    s3Region: 'us-east-1',
    s3Prefix: 'backups/database/',
    maxBackupsPerType: 52,
    backupTimeout: 3600000,
    compressionLevel: 9,
    includeFiles: true,
    fileBackupS3Prefix: 'backups/files/',
    notifyOnFailure: true,
    notificationEmail: '',
    provider: 'local',
};
/**
 * Re-reads sensitive config from Platform Config (hot-reloadable).
 * Called at startup and when config is updated via admin UI.
 * .env remains as fallback only.
 */
export async function reconfigureBackupConfig() {
    backupConfig.encryptionKey = (await configService.getConfig('BACKUP_ENCRYPTION_KEY')) || process.env.BACKUP_ENCRYPTION_KEY || '';
    backupConfig.s3Bucket = (await configService.getConfig('BACKUP_S3_BUCKET')) || process.env.BACKUP_S3_BUCKET || '';
    backupConfig.s3Region = (await configService.getConfig('BACKUP_S3_REGION')) || process.env.AWS_REGION || 'us-east-1';
    backupConfig.notificationEmail = (await configService.getConfig('BACKUP_ALERT_EMAIL')) || process.env.BACKUP_ALERT_EMAIL || '';
    backupConfig.provider = (await configService.getConfig('BACKUP_PROVIDER')) || process.env.BACKUP_PROVIDER || 'local';
}
//# sourceMappingURL=backup.config.js.map