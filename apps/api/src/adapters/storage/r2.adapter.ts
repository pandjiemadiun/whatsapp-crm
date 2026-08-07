import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';
import { adapters } from '../container.js';
import { configService } from '../../business/config.service.js';

/**
 * StorageAdapter interface — kontrak yang sama untuk semua provider.
 */
export interface StorageAdapter {
  uploadImage(buffer: Buffer, folder: string): Promise<{ url: string }>;
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
export class R2Adapter implements StorageAdapter {
  private client: S3Client | null = null;
  private bucket: string;
  private publicBaseUrl: string;
  private configured: boolean;

  constructor() {
    this.bucket = '';
    this.publicBaseUrl = '';
    this.configured = false;
    // Sync load from env (fallback) — reconfigureFromConfig() will override from Platform Config
    this.reconfigureFromEnv();
  }

  /** Sync load from env vars (fallback before dotenv is loaded). */
  private reconfigureFromEnv(): void {
    const accountId = process.env.R2_ACCOUNT_ID || '';
    const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
    this.bucket = process.env.R2_BUCKET || '';
    this.publicBaseUrl = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');

    this.configured = !!(accountId && accessKeyId && secretAccessKey && this.bucket);

    if (this.configured) {
      this.client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
    } else {
      this.client = null;
    }
  }

  /** Hot-reload from Platform Config (DB-first, env as fallback). */
  async reconfigure(): Promise<void> {
    const [accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl] = await Promise.all([
      configService.getConfig('R2_ACCOUNT_ID'),
      configService.getConfig('R2_ACCESS_KEY_ID'),
      configService.getConfig('R2_SECRET_ACCESS_KEY'),
      configService.getConfig('R2_BUCKET'),
      configService.getConfig('R2_PUBLIC_BASE_URL'),
    ]);

    this.bucket = bucket || process.env.R2_BUCKET || '';
    this.publicBaseUrl = (publicBaseUrl || process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');

    const credAccountId = accountId || process.env.R2_ACCOUNT_ID || '';
    const credAccessKey = accessKeyId || process.env.R2_ACCESS_KEY_ID || '';
    const credSecret = secretAccessKey || process.env.R2_SECRET_ACCESS_KEY || '';

    this.configured = !!(credAccountId && credAccessKey && credSecret && this.bucket);

    if (this.configured) {
      this.client = new S3Client({
        region: 'auto',
        endpoint: `https://${credAccountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: credAccessKey,
          secretAccessKey: credSecret,
        },
      });
      adapters.logger.info('[R2] Reconfigured from Platform Config', {
        accountId: credAccountId.substring(0, 8) + '...',
        bucket: this.bucket,
      });
    } else {
      this.client = null;
    }
  }

/**
   * Generate presigned URL (valid 7 hari) — R2 tidak support public bucket ACL
   * via S3 API, jadi pakai presigned URL untuk akses gambar.
   */
  async getSignedUrl(key: string): Promise<string> {
    if (!this.configured || !this.client) {
      throw new Error('R2 not configured');
    }
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return await getSignedUrl(this.client, command, { expiresIn: 7 * 24 * 3600 });
  }

  /** Refresh presigned URL sebelum dikembalikan ke client (hindari expiry). */
  async refreshImageUrl(url: string): Promise<string> {
    if (!this.configured || !this.client) return url;
    if (this.publicBaseUrl) return url; // public URL, permanen
    try {
      const urlObj = new URL(url);
      const key = urlObj.pathname.slice(1); // hapus leading /
      if (!key) return url;
      return await this.getSignedUrl(key);
    } catch {
      return url; // bukan URL R2, lewati
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  getProviderName(): string {
    return 'r2';
  }

  async uploadImage(buffer: Buffer, folder: string): Promise<{ url: string }> {
    if (!this.configured || !this.client) {
      throw new Error('Cloudflare R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.');
    }

    const safeFolder = folder.replace(/[^\w/-]/g, '');
    const ext = 'webp'; // dikonversi ke webp via sharp
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const key = safeFolder ? `${safeFolder}/${filename}` : filename;

    try {
      // Resize + compress + konversi ke WebP (jangan terlalu ekstrem)
      // - Max 1024px (maintain aspect ratio, tidak upscale)
      // - WebP quality 80 (seimbang ukuran & kualitas)
      let processedBuffer: Buffer;
      try {
        processedBuffer = await sharp(buffer)
          .resize({ width: 1024, height: 1024, fit: 'inside' })
          .webp({ quality: 80 })
          .toBuffer();
      } catch {
        adapters.logger.warn('R2 sharp processing failed, uploading original', { key });
        processedBuffer = buffer;
      }

      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: processedBuffer,
          ContentType: 'image/webp',
          CacheControl: 'public, max-age=31536000, immutable',
        })
      );

      // Presigned URL (7 hari) — R2 tidak support public bucket ACL via S3 API
      const url = this.publicBaseUrl
        ? `${this.publicBaseUrl}/${key}`
        : await this.getSignedUrl(key);

      adapters.logger.info('R2 upload success', { key });
      return { url };
    } catch (error) {
      adapters.logger.error('R2 upload failed', error as Error, { key });
      throw new Error('Upload gambar gagal');
    }
  }

  async deleteImage(key: string): Promise<void> {
    if (!this.configured || !this.client) return;
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
      );
      adapters.logger.info('R2 delete success', { key });
    } catch (error) {
      adapters.logger.warn('R2 delete failed', error as Error);
    }
  }

}

export const r2Adapter = new R2Adapter();
