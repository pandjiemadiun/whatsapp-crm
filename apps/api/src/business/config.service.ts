import logger from '../utils/logger.js';
import { prisma } from '../infrastructure/prisma.js';

interface CacheEntry {
  value: string | null;
  expiresAt: number;
}

export class ConfigService {
  private cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * getConfig — Get a config value by key.
   * Priority: env override → DB → process.env fallback.
   *
   * ENV_OVERRIDE melebihi DB agar:
   *  1. `dotenv` load dari .env SELALU menang (single source of truth)
   *  2. Admin panel (DB) hanya dipakai jika .env TIDAK mendefinisikan key tersebut
   *  3. Tidak ada lagi placeholder `isi_key_kamu` yang menyelinap ke production
   */
  async getConfig(key: string): Promise<string | null> {
    // 1. Check in-memory cache (TTL 5 min)
    const cached = this.cache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }

    // 2. DB FIRST (primary source) — allows Admin Panel changes to take effect immediately
    try {
      const setting = await prisma.systemSetting.findUnique({ where: { key } });
      if (setting) {
        const value = setting.isSecret
          ? Buffer.from(setting.value, 'base64').toString()
          : setting.value;

        // Skip DB value if it's empty or still a placeholder
        if (value && value !== 'isi_key_kamu') {
          this.cache.set(key, { value, expiresAt: Date.now() + this.CACHE_TTL });
          return value;
        }
      }
    } catch (error) {
      logger.warn('ConfigService DB lookup failed', { key, error: (error as Error).message });
    }

    // 3. ENV OVERRIDE (fallback) — only used if DB has no value
    const envValue = process.env[key] ?? null;
    if (envValue !== null && envValue.length > 0 && envValue !== 'isi_key_kamu') {
      this.cache.set(key, { value: envValue, expiresAt: Date.now() + this.CACHE_TTL });
      return envValue;
    }

    // 4. Nothing found
    this.cache.set(key, { value: null, expiresAt: Date.now() + this.CACHE_TTL });
    return null;
  }

  /**
   * Sync .env value ke DB (non-blocking, best-effort).
   * Hanya update jika DB kosong atau masih placeholder.
   */
  private async syncEnvToDb(key: string, envValue: string): Promise<void> {
    try {
      const existing = await prisma.systemSetting.findUnique({ where: { key } });
      const currentDbValue = existing
        ? (existing.isSecret ? Buffer.from(existing.value, 'base64').toString() : existing.value)
        : null;

      if (!currentDbValue || currentDbValue === 'isi_key_kamu') {
        const isSecret = existing?.isSecret ?? true;
        const stored = isSecret ? Buffer.from(envValue).toString('base64') : envValue;
        await prisma.systemSetting.upsert({
          where: { key },
          update: { value: stored },
          create: { key, value: stored, isSecret, category: existing?.category || 'ai', description: existing?.description || null },
        });
        logger.info('Config auto-synced from .env to DB', { key });
      }
    } catch {
      // best-effort — jangan ganggu hot path
    }
  }

  /**
   * setConfig — Upsert a config value, then invalidate cache.
   */
  async setConfig(
    key: string,
    value: string,
    options?: { category?: string; isSecret?: boolean; description?: string }
  ): Promise<void> {
    const category = options?.category || 'general';
    const isSecret = options?.isSecret ?? false;
    const description = options?.description ?? null;

    // Encrypt if secret
    const storedValue = isSecret ? Buffer.from(value).toString('base64') : value;

    await prisma.systemSetting.upsert({
      where: { key },
      update: { value: storedValue, isSecret, category, description },
      create: { key, value: storedValue, isSecret, category, description },
    });

    // Invalidate cache so next getConfig re-reads from DB
    this.cache.delete(key);

    logger.info('Config updated', { key, category, isSecret });
  }

  /**
   * getAllConfigs — List all settings, masking secret values for API output.
   */
  async getAllConfigs(filterCategory?: string) {
    const where = filterCategory ? { category: filterCategory } : {};
    const settings = await prisma.systemSetting.findMany({ where, orderBy: { key: 'asc' } });

    return settings.map((s) => ({
      key: s.key,
      value: s.isSecret ? '***' : s.value,
      category: s.category,
      isSecret: s.isSecret,
      description: s.description,
      updatedAt: s.updatedAt,
    }));
  }

  /**
   * getSingleConfig — Get a single config for API output (masks secrets).
   */
  async getSingleConfig(key: string) {
    const setting = await prisma.systemSetting.findUnique({ where: { key } });
    if (!setting) return null;

    return {
      key: setting.key,
      value: setting.isSecret ? '***' : setting.value,
      category: setting.category,
      isSecret: setting.isSecret,
      description: setting.description,
      updatedAt: setting.updatedAt,
    };
  }

  /**
   * deleteConfig — Delete a config key from DB + cache.
   */
  async deleteConfig(key: string): Promise<boolean> {
    const existing = await prisma.systemSetting.findUnique({ where: { key } });
    if (!existing) return false;

    await prisma.systemSetting.delete({ where: { key } });
    this.cache.delete(key);
    logger.info('Config deleted', { key });
    return true;
  }

  /**
   * invalidateCache — Clear entire cache (force re-read on next getConfig).
   */
  invalidateCache(): void {
    this.cache.clear();
  }
}

export const configService = new ConfigService();
