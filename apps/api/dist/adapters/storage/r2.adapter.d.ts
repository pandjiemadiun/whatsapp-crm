/**
 * StorageAdapter interface — kontrak yang sama untuk semua provider.
 */
export interface StorageAdapter {
    uploadImage(buffer: Buffer, folder: string): Promise<{
        url: string;
    }>;
    /** Opsional: hapus object dari storage. Provider yang tidak mendukung cukup no-op. */
    deleteImage?(key: string): Promise<void>;
    /** Opsional: refresh URL gambar sebelum dikirim ke client (mis. presigned URL yang akan expire). */
    refreshImageUrl?(url: string): Promise<string>;
}
/**
 * Cloudflare R2 adapter (S3-compatible API).
 *
 * Konfigurasi via env (lihat .env.example):
 *   STORAGE_PROVIDER=r2
 *   R2_ACCOUNT_ID=<cloudflare account id>
 *   R2_ACCESS_KEY_ID=<s3 api token access key>
 *   R2_SECRET_ACCESS_KEY=<s3 api token secret>
 *   R2_BUCKET=<bucket name>
 *   R2_PUBLIC_BASE_URL=<opsional, mis. https://cdn.example.com atau https://pub-xxx.r2.dev>
 *
 * URL yang dihasilkan: `${R2_PUBLIC_BASE_URL}/${folder}/${filename}` — object
 * harus public-readable (bucket policy Allowed Origins / public access) atau
 * di-serve via public bucket URL.
 */
export declare class R2Adapter implements StorageAdapter {
    private client;
    private bucket;
    private publicBaseUrl;
    private configured;
    constructor();
    /** Sync load from env vars (fallback before dotenv is loaded). */
    private reconfigureFromEnv;
    /** Hot-reload from Platform Config (DB-first, env as fallback). */
    reconfigure(): Promise<void>;
    /**
       * Generate presigned URL (valid 7 hari) — R2 tidak support public bucket ACL
       * via S3 API, jadi pakai presigned URL untuk akses gambar.
       */
    getSignedUrl(key: string): Promise<string>;
    /** Refresh presigned URL sebelum dikembalikan ke client (hindari expiry). */
    refreshImageUrl(url: string): Promise<string>;
    isConfigured(): boolean;
    getProviderName(): string;
    uploadImage(buffer: Buffer, folder: string): Promise<{
        url: string;
    }>;
    deleteImage(key: string): Promise<void>;
}
export declare const r2Adapter: R2Adapter;
//# sourceMappingURL=r2.adapter.d.ts.map