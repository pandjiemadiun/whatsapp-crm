/** Exact phrase admin must type to confirm rotation. */
export declare const ROTATION_CONFIRM_PHRASE = "ROTATE ENCRYPTION KEY";
interface ModelDryRun {
    rowCount: number;
    encryptedFieldCount: number;
    fields: Record<string, number>;
}
export interface DryRunResult {
    models: Record<string, ModelDryRun>;
    totalRows: number;
    totalEncryptedFields: number;
    currentSource: 'database' | 'cloudflare_worker' | 'env' | 'none';
}
export interface RotationResult {
    success: boolean;
    rowsReEncrypted: number;
    modelsAffected: string[];
    newKeyInstalled: boolean;
    errors?: string[];
}
export declare class KeyRotationService {
    /**
     * Count rows and encrypted fields per model. No writes.
     */
    dryRun(): Promise<DryRunResult>;
    private getCurrentKeySource;
    /**
     * Execute key rotation: re-encrypt all data with the new key.
     * - Requires a fresh backup (< 1 hour old) or auto-triggers one.
     * - All re-encryption happens in a single Prisma transaction.
     * - Any decryption/re-encryption failure rolls back the entire transaction.
     * - On success: writes new key to Platform Config, invalidates cache.
     */
    rotate(newKeyRaw: string): Promise<RotationResult>;
}
export declare const keyRotationService: KeyRotationService;
export {};
//# sourceMappingURL=key-rotation.service.d.ts.map