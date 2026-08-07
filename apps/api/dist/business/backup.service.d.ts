export declare class BackupService {
    private adapter;
    constructor();
    /**
     * Validate that pg_dump and psql are available before backup/restore operations.
     * Throws ApiError with helpful install instructions on failure.
     */
    private validateDatabaseTools;
    createDatabaseBackup(type?: 'daily' | 'weekly' | 'manual'): Promise<{
        filename: string;
        size: number;
        timestamp: Date;
        checksum: string;
    }>;
    getBackupsList(): Promise<{
        backups: {
            size: number;
            id: string;
            createdAt: Date;
            type: string;
            deletedAt: Date | null;
            status: string;
            errorMessage: string | null;
            filename: string;
            checksum: string;
            algorithm: string;
            encrypted: boolean;
            verifiedAt: Date | null;
            restoredAt: Date | null;
            restoredBy: string | null;
        }[];
        stats: {
            total: number;
            totalSize: number;
            oldest: Date;
            newest: Date;
        };
    }>;
    getBackupDetail(filename: string): Promise<{
        size: number;
        id: string;
        createdAt: Date;
        type: string;
        deletedAt: Date | null;
        status: string;
        errorMessage: string | null;
        filename: string;
        checksum: string;
        algorithm: string;
        encrypted: boolean;
        verifiedAt: Date | null;
        restoredAt: Date | null;
        restoredBy: string | null;
    }>;
    verifyBackupIntegrity(filename: string): Promise<{
        valid: boolean;
        checksum: string;
        size: number;
        lastVerified: string;
        error?: undefined;
    } | {
        valid: boolean;
        checksum: string;
        size: number;
        error: string;
        lastVerified?: undefined;
    }>;
    restoreDatabase(filename: string): Promise<void>;
    deleteBackup(filename: string): Promise<void>;
    deleteOldBackups(): Promise<{
        deleted: number;
        freedSize: number;
    }>;
    getLatestBackup(): Promise<{
        id: string;
        createdAt: Date;
        type: string;
        deletedAt: Date | null;
        status: string;
        errorMessage: string | null;
        filename: string;
        size: bigint;
        checksum: string;
        algorithm: string;
        encrypted: boolean;
        verifiedAt: Date | null;
        restoredAt: Date | null;
        restoredBy: string | null;
    } | null>;
}
export declare const backupService: BackupService;
//# sourceMappingURL=backup.service.d.ts.map