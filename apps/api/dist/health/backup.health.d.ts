export declare function getBackupHealth(): Promise<{
    status: "degraded" | "healthy" | "unhealthy";
    lastBackup: string | null;
    hoursSinceLastBackup: number;
    encryptionKeyPresent: boolean;
    issues: string[] | undefined;
} | {
    status: string;
    lastBackup: null;
    hoursSinceLastBackup: null;
    encryptionKeyPresent: boolean;
    issues: string[];
}>;
//# sourceMappingURL=backup.health.d.ts.map