/**
 * BAGIAN 2 — AI Key Router & Redis Cooldown
 *
 * State disimpan di Redis (PM2 multi-instance safe).
 * Key format: groq:cooldown:{key_hash} dengan TTL = retryAfterSeconds (default 60s).
 *
 * Logikanya:
 *  1. getAvailableKey()   → loop semua key, lewati yang sedang cooldown, kembalikan pertama yang available.
 *  2. reportRateLimit(key, retryAfterSeconds) → set Redis cooldown key, log ke token-usage-tracker.
 *  3. Jika SEMUA key cooldown → return null (trigger fallback ke Gemini).
 */
import crypto from 'node:crypto';
import Redis from 'ioredis';
import { logTokenUsage } from './token-usage-tracker.js';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  db: 0,
  retryStrategy: (times: number) => Math.min(times * 50, 2000),
  enableOfflineQueue: false,
});

const DEFAULT_COOLDOWN_SECONDS = 60;
const CACHE_TTL_SECONDS = 300; // cache keys list selama 5 menit

const REDIS_KEY_PREFIX = 'groq:cooldown:';

const CACHE_KEY = 'groq:keys';

function hashKey(apiKey: string): string {
  return crypto.createHash('sha1').update(apiKey).digest('hex').slice(0, 16);
}

function redisCooldownKey(apiKey: string): string {
  return `${REDIS_KEY_PREFIX}${hashKey(apiKey)}`;
}

export interface KeyRouterStats {
  totalKeys: number;
  availableKeys: number;
  cooldownKeys: number;
  currentKey: string | null;
}

export class AiKeyRouter {
  private keys: string[] = [];
  private lastLoaded = 0;
  private readonly RELOAD_INTERVAL_MS = CACHE_TTL_SECONDS * 1000;

  /** Parse comma-separated env var. Validation: minimal 1 key. */
  parseKeys(envValue: string | undefined): string[] {
    if (!envValue || !envValue.trim()) {
      throw new Error('GROQ_API_KEYS tidak boleh kosong — setidaknya 1 key diperlukan');
    }
    const parsed = envValue
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);

    if (parsed.length === 0) {
      throw new Error('GROQ_API_KEYS tidak valid — setidaknya 1 key diperlukan');
    }
    return parsed;
  }

  /** Load keys from env / Redis cache. */
  async loadKeys(keysSource?: string): Promise<string[]> {
    const now = Date.now();

    if (keysSource) {
      this.keys = this.parseKeys(keysSource);
      this.lastLoaded = now;
      return this.keys;
    }

    // Check Redis cache
    try {
      const cached = await redis.get(CACHE_KEY);
      if (cached) {
        this.keys = JSON.parse(cached);
        this.lastLoaded = now;
        return this.keys;
      }
    } catch (e) {
      // Redis not available — fall back to env only
      console.warn('[AiKeyRouter] Redis cache read failed, using env only');
    }

    const envKeys = this.parseKeys(process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY);
    this.keys = envKeys;
    this.lastLoaded = now;

    // Cache in Redis
    try {
      await redis.setex(CACHE_KEY, CACHE_TTL_SECONDS, JSON.stringify(this.keys));
    } catch {
      // Redis not available — continue with in-memory
    }
    return this.keys;
  }

  /** Reload keys if cache expired or forced. */
  async reloadKeys(keysSource?: string): Promise<string[]> {
    if (keysSource) {
      return this.loadKeys(keysSource);
    }
    // Force reload from env
    this.lastLoaded = 0;
    return this.loadKeys();
  }

  /**
   * getAvailableKey — loop semua key, lewati yang sedang cooldown,
   * kembalikan key pertama yang available. Jika semua cooldown → null.
   */
  async getAvailableKey(): Promise<string | null> {
    if (this.keys.length === 0 || Date.now() - this.lastLoaded > this.RELOAD_INTERVAL_MS) {
      try {
        await this.loadKeys();
      } catch (e) {
        // If env is invalid, try process.env directly
        const envKeys = process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY;
        if (envKeys) {
          try {
            this.keys = this.parseKeys(envKeys);
            this.lastLoaded = Date.now();
          } catch {
            return null;
          }
        } else {
          return null;
        }
      }
    }

    for (const key of this.keys) {
      const inCooldown = await this.isInCooldown(key);
      if (!inCooldown) {
        return key;
      }
    }
    return null; // semua key cooldown → trigger Gemini fallback
  }

  /** Check if a key is in Redis cooldown. */
  private async isInCooldown(apiKey: string): Promise<boolean> {
    try {
      const ttl = await redis.ttl(redisCooldownKey(apiKey));
      return ttl > 0;
    } catch {
      return false; // Redis not available — assume not in cooldown
    }
  }

  /**
   * reportRateLimit — set Redis cooldown key dengan TTL = retryAfterSeconds.
   * Default 60 detik jika header tidak ada.
   */
  async reportRateLimit(apiKey: string, retryAfterSeconds?: number): Promise<void> {
    const ttl = retryAfterSeconds && retryAfterSeconds > 0 ? retryAfterSeconds : DEFAULT_COOLDOWN_SECONDS;
    const key = redisCooldownKey(apiKey);

    console.debug(`[AiKeyRouter] Key ${hashKey(apiKey)} rate-limited → cooldown ${ttl}s`);

    try {
      await redis.setex(key, ttl, '1');
    } catch (e) {
      console.warn('[AiKeyRouter] Redis setex failed, using in-memory fallback', { error: (e as Error).message });
      // In-memory fallback for environments without Redis
      const memKey = redisCooldownKey(apiKey);
      (globalThis as any).__GROQ_MEM_COOLDOWN__ = (globalThis as any).__GROQ_MEM_COOLDOWN__ || {};
      (globalThis as any).__GROQ_MEM_COOLDOWN__[memKey] = Date.now() + ttl * 1000;
    }

    // Log to token-usage-tracker
    logTokenUsage({
      timestamp: Date.now(),
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      intent: 'rate-limit-cooldown',
      conversationId: 'key-router',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    });
  }

  /** Get current router stats. */
  async getStats(): Promise<KeyRouterStats> {
    let available = 0;
    let cooldownCount = 0;

    for (const key of this.keys) {
      if (await this.isInCooldown(key)) {
        cooldownCount++;
      } else {
        available++;
      }
    }

    const currentKey = await this.getAvailableKey();
    return {
      totalKeys: this.keys.length,
      availableKeys: available,
      cooldownKeys: cooldownCount,
      currentKey,
    };
  }

  /** Clear all cooldowns (for testing/reset). */
  async clearCoolDowns(): Promise<void> {
    try {
      const keys = await redis.keys(`${REDIS_KEY_PREFIX}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch {
      // Redis not available
    }
    // Clear in-memory fallback
    (globalThis as any).__GROQ_MEM_COOLDOWN__ = {};
  }

  /** Get the active API key hash (for logging). */
  getCurrentKeyHash(): string | null {
    if (this.keys.length === 0) return null;
    return this.keys[0] ? hashKey(this.keys[0]) : null;
  }
}

export const aiKeyRouter = new AiKeyRouter();
