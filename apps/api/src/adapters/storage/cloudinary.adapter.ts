import { v2 as cloudinary } from 'cloudinary';
import { adapters } from '../container.js';
import { StorageAdapter } from './r2.adapter.js';
import { r2Adapter } from './r2.adapter.js';
import { configService } from '../../business/config.service.js';

class CloudinaryAdapter implements StorageAdapter {
  private configured: boolean;

  constructor() {
    this.configured = false;
    this.reconfigureFromEnv();
  }

  private reconfigureFromEnv(): void {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    this.configured = !!(cloudName && apiKey && apiSecret);

    if (this.configured) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
      });
    }
  }

  async reconfigure(): Promise<void> {
    const [cloudName, apiKey, apiSecret] = await Promise.all([
      configService.getConfig('CLOUDINARY_CLOUD_NAME'),
      configService.getConfig('CLOUDINARY_API_KEY'),
      configService.getConfig('CLOUDINARY_API_SECRET'),
    ]);

    const name = cloudName || process.env.CLOUDINARY_CLOUD_NAME;
    const key = apiKey || process.env.CLOUDINARY_API_KEY;
    const secret = apiSecret || process.env.CLOUDINARY_API_SECRET;

    this.configured = !!(name && key && secret);

    if (this.configured) {
      cloudinary.config({
        cloud_name: name,
        api_key: key,
        api_secret: secret,
      });
      console.log('[Cloudinary] reconfigured from Platform Config:', name);
    } else {
      console.log('[Cloudinary] NOT configured');
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  getProviderName(): string {
    return 'cloudinary';
  }

  async uploadImage(buffer: Buffer, folder: string): Promise<{ url: string }> {
    if (!this.configured) {
      throw new Error('Cloudinary is not configured');
    }

    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, resource_type: 'image', transformation: [{ width: 512, height: 512, crop: 'limit', quality: 80 }] },
        (error, result) => {
          if (error || !result) {
            adapters.logger.error('Cloudinary upload failed', error as Error);
            return reject(error || new Error('Upload failed'));
          }
          resolve({ url: result.secure_url });
        }
      );
      stream.end(buffer);
    });
  }

  /** Cloudinary URLs permanen — tidak perlu refresh. */
  async refreshImageUrl(url: string): Promise<string> {
    return url;
  }
}

export const cloudinaryAdapter = new CloudinaryAdapter();

/**
 * Storage factory — memilih provider berdasarkan env STORAGE_PROVIDER.
 * Nilai: "r2" (default jika terkonfigurasi) atau "cloudinary".
 * Ekspor `storageAdapter` agar konsumen (container.ts, routes) tidak berubah.
 */
/* Storage factory — memilih provider berdasarkan STORAGE_PROVIDER dari Platform Config */
let cachedProvider: string | null = null;
export let storageAdapter: StorageAdapter = selectStorageAdapterSync();

function selectStorageAdapterSync(): StorageAdapter {
  const provider = (cachedProvider ?? (process.env.STORAGE_PROVIDER || '')).toLowerCase();
  if (provider === 'r2') return r2Adapter;
  if (provider === 'cloudinary') return cloudinaryAdapter;
  if (r2Adapter.isConfigured()) return r2Adapter;
  return cloudinaryAdapter;
}

export async function reconfigureStorage(): Promise<void> {
  cachedProvider = await configService.getConfig('STORAGE_PROVIDER');
  storageAdapter = selectStorageAdapterSync();
  console.log('[Storage] Reconfigured from Platform Config:', cachedProvider || 'auto');
}

/**
 * Pemisahan provider per konteks:
 * - catalogStorage  → Cloudflare R2 (gambar katalog/produk)
 * - profileStorage  → Cloudinary (foto profil toko)
 * Konsumen dipilih eksplisit di route, tidak lagi satu factory global.
 */
export const catalogStorage: StorageAdapter = r2Adapter;
export const profileStorage: StorageAdapter = cloudinaryAdapter;
