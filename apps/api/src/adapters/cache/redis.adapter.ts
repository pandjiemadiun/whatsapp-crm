import Redis from 'ioredis';
import winstonLogger from '../../utils/logger.js';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  db: 0,
  retryStrategy: (times) => Math.min(times * 50, 2000),
});

redis.on('connect', () => {
  winstonLogger.info('📍 Redis connected');
});

redis.on('error', (err) => {
  winstonLogger.error('Redis connection error', err);
});

export class RedisAdapter {
  async lpush(key: string, value: string): Promise<number> {
    try {
      return await redis.lpush(key, value);
    } catch (err) {
      winstonLogger.error(`Redis LPUSH failed: ${key}`, err as Error);
      return 0;
    }
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      return await redis.lrange(key, start, stop);
    } catch (err) {
      winstonLogger.error(`Redis LRANGE failed: ${key}`, err as Error);
      return [];
    }
  }

  async ltrim(key: string, start: number, stop: number): Promise<void> {
    try {
      await redis.ltrim(key, start, stop);
    } catch (err) {
      winstonLogger.error(`Redis LTRIM failed: ${key}`, err as Error);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      winstonLogger.error(`Redis GET failed: ${key}`, err as Error);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number = 3600): Promise<void> {
    try {
      await redis.setex(key, ttlSeconds, JSON.stringify(value));
    } catch (err) {
      winstonLogger.error(`Redis SET failed: ${key}`, err as Error);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await redis.del(key);
    } catch (err) {
      winstonLogger.error(`Redis DEL failed: ${key}`, err as Error);
    }
  }

  async keys(pattern: string): Promise<string[]> {
    try {
      return await redis.keys(pattern);
    } catch (err) {
      winstonLogger.error(`Redis KEYS failed: ${pattern}`, err as Error);
      return [];
    }
  }

  async clearStore(storeId: string): Promise<void> {
    try {
      const keys = await this.keys(`knowledge:${storeId}:*`);
      if (keys.length > 0) {
        await redis.del(...keys);
        winstonLogger.info(`Redis: cleared ${keys.length} keys for store ${storeId}`);
      }
    } catch (err) {
      winstonLogger.error(`Redis CLEAR failed: ${storeId}`, err as Error);
    }
  }

  async getTtl(key: string): Promise<number | null> {
    try {
      const ms = await redis.pttl(key);
      // -2 = key does not exist, -1 = key exists but has no associated expire
      if (ms < 0) return null;
      return Math.round(ms / 1000);
    } catch (err) {
      winstonLogger.error(`Redis PTTL failed: ${key}`, err as Error);
      return null;
    }
  }

  /**
   * Atomic SET key value EX ttlSeconds NX.
   * Returns true if the key was newly set (did NOT previously exist),
   * false if the key already existed (SET NX was a no-op).
   * Used by webhook dedup (multi-instance safe — shared Redis counter).
   */
  async setIfNotExists(key: string, value: string, ttlSeconds: number = 300): Promise<boolean> {
    try {
      const result = await redis.set(key, value, 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch (err) {
      winstonLogger.error(`Redis SET NX failed: ${key}`, err as Error);
      return false;
    }
  }

  async close(): Promise<void> {
    await redis.quit();
  }

  async ping(): Promise<boolean> {
    try {
      const result = await redis.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }
}

export const redisAdapter = new RedisAdapter();
