import Redis from 'ioredis';
import { adapters } from '../container.js';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  db: 0,
  retryStrategy: (times) => Math.min(times * 50, 2000),
});

redis.on('connect', () => {
  adapters.logger.info('📍 Redis connected');
});

redis.on('error', (err) => {
  adapters.logger.error('Redis connection error', err);
});

export class RedisAdapter {
  async lpush(key: string, value: string): Promise<number> {
    try {
      return await redis.lpush(key, value);
    } catch (err) {
      adapters.logger.error(`Redis LPUSH failed: ${key}`, err as Error);
      return 0;
    }
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      return await redis.lrange(key, start, stop);
    } catch (err) {
      adapters.logger.error(`Redis LRANGE failed: ${key}`, err as Error);
      return [];
    }
  }

  async ltrim(key: string, start: number, stop: number): Promise<void> {
    try {
      await redis.ltrim(key, start, stop);
    } catch (err) {
      adapters.logger.error(`Redis LTRIM failed: ${key}`, err as Error);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      adapters.logger.error(`Redis GET failed: ${key}`, err as Error);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number = 3600): Promise<void> {
    try {
      await redis.setex(key, ttlSeconds, JSON.stringify(value));
    } catch (err) {
      adapters.logger.error(`Redis SET failed: ${key}`, err as Error);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await redis.del(key);
    } catch (err) {
      adapters.logger.error(`Redis DEL failed: ${key}`, err as Error);
    }
  }

  async keys(pattern: string): Promise<string[]> {
    try {
      return await redis.keys(pattern);
    } catch (err) {
      adapters.logger.error(`Redis KEYS failed: ${pattern}`, err as Error);
      return [];
    }
  }

  async clearStore(storeId: string): Promise<void> {
    try {
      const keys = await this.keys(`knowledge:${storeId}:*`);
      if (keys.length > 0) {
        await redis.del(...keys);
        adapters.logger.info(`Redis: cleared ${keys.length} keys for store ${storeId}`);
      }
    } catch (err) {
      adapters.logger.error(`Redis CLEAR failed: ${storeId}`, err as Error);
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
