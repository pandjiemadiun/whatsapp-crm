import { StorageAdapter } from './r2.adapter.js';
declare class CloudinaryAdapter implements StorageAdapter {
    private configured;
    constructor();
    private reconfigureFromEnv;
    reconfigure(): Promise<void>;
    isConfigured(): boolean;
    getProviderName(): string;
    uploadImage(buffer: Buffer, folder: string): Promise<{
        url: string;
    }>;
    /** Cloudinary URLs permanen — tidak perlu refresh. */
    refreshImageUrl(url: string): Promise<string>;
}
export declare const cloudinaryAdapter: CloudinaryAdapter;
export declare let storageAdapter: StorageAdapter;
export declare function reconfigureStorage(): Promise<void>;
/**
 * Pemisahan provider per konteks:
 * - catalogStorage  → Cloudflare R2 (gambar katalog/produk)
 * - profileStorage  → Cloudinary (foto profil toko)
 * Konsumen dipilih eksplisit di route, tidak lagi satu factory global.
 */
export declare const catalogStorage: StorageAdapter;
export declare const profileStorage: StorageAdapter;
export {};
//# sourceMappingURL=cloudinary.adapter.d.ts.map