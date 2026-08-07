interface BackupConfig {
    enabled: boolean;
    scheduleDaily: string;
    scheduleWeekly: string;
    retentionDays: number;
    encryptionKey: string;
    s3Bucket: string;
    s3Region: string;
    s3Prefix: string;
    maxBackupsPerType: number;
    backupTimeout: number;
    compressionLevel: number;
    includeFiles: boolean;
    fileBackupS3Prefix: string;
    notifyOnFailure: boolean;
    notificationEmail: string;
    provider: string;
}
export declare const backupConfig: BackupConfig;
/**
 * Re-reads sensitive config from Platform Config (hot-reloadable).
 * Called at startup and when config is updated via admin UI.
 * .env remains as fallback only.
 */
export declare function reconfigureBackupConfig(): Promise<void>;
export {};
//# sourceMappingURL=backup.config.d.ts.map