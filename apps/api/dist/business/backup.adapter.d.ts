export interface BackupAdapter {
    upload(filename: string, buffer: Buffer): Promise<void>;
    download(filename: string): Promise<Buffer>;
    list(): Promise<string[]>;
    delete(filename: string): Promise<void>;
}
export declare class LocalBackupAdapter implements BackupAdapter {
    private readonly basePath;
    constructor(basePath?: string);
    private ensureDir;
    upload(filename: string, buffer: Buffer): Promise<void>;
    download(filename: string): Promise<Buffer>;
    list(): Promise<string[]>;
    delete(filename: string): Promise<void>;
    getBasePath(): string;
}
export declare function getBackupAdapter(): BackupAdapter;
//# sourceMappingURL=backup.adapter.d.ts.map