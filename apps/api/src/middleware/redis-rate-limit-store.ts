/**
 * Redis-backed rate limit store for express-rate-limit v8 (G2-B.4).
 *
 * Implements the express-rate-limit Store interface:
 *   increment(key) → { totalHits, resetTime }
 *   decrement(key)
 *   resetKey(key)
 *   resetAll()
 *
 * Uses Redis atomic INCR + EXPIRE (SET with TTL on first hit) for multi-instance
 * safety. Key prefix: rate-limit:<surface>:<ip>
 */

import { Redis } from 'ioredis';
import logger from '../utils/logger.js';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  db: 0,
  retryStrategy: (times) => Math.min(times * 50, 2000),
});

redis.on('error', (err) => {
  logger.error('Redis rate-limit store connection error', err);
});

interface HitRecord {
  totalHits: number;
  resetTime: Date;
}

export class RedisRateLimitStore {
  prefix: string;
  windowMs: number;
  /**
   * localKeys = false: this store is centralised (Redis), NOT per-instance
   * in-memory. express-rate-limit uses this to decide whether rate-limit state
   * is shared across worker processes. For Redis it MUST be false.
   */
  localKeys = false;

  constructor(prefix: string, windowMs: number) {
    this.prefix = prefix;
    this.windowMs = windowMs;
  }

  key(key: string): string {
    return `${this.prefix}:${key}`;
  }

  /**
   * Increment the rate limit counter for a key.
   * Atomic via Redis INCR + PEXPIRE (pipeline for atomicity).
   * Returns { totalHits, resetTime } as required by express-rate-limit v8.
   */
  async increment(key: string): Promise<HitRecord> {
    try {
      const redisKey = this.key(key);
      const now = Date.now();

      // Use a pipeline: INCR then set expiry only on first hit (when totalHits === 1)
      // This ensures the TTL is set exactly once when the key is first created.
      const results = await redis
        .pipeline()
        .incr(redisKey)
        .pexpire(redisKey, this.windowMs, 'NX')
        .exec();

      // results is an array of [err, reply] pairs
      const totalHits = results ? ((results[0][1] as number) || 0) : 0;

      // Calculate reset time based on the TTL
      const ttlResult = await redis.pttl(redisKey);
      const resetMs = ttlResult > 0 ? ttlResult : this.windowMs;
      const resetTime = new Date(now + resetMs);

      return { totalHits, resetTime };
    } catch (err) {
      logger.error('Redis rate limit increment failed', err as Error);
      // Fail-open: allow the request if Redis is down
      return { totalHits: 0, resetTime: new Date(Date.now() + this.windowMs) };
    }
  }

  /** Decrement the counter for a key (used on route completion) */
  async decrement(key: string): Promise<void> {
    try {
      await redis.decr(this.key(key));
    } catch (err) {
      logger.error('Redis rate limit decrement failed', err as Error);
    }
  }

  /** Reset the counter for a specific key */
  async resetKey(key: string): Promise<void> {
    try {
      await redis.del(this.key(key));
    } catch (err) {
      logger.error('Redis rate limit resetKey failed', err as Error);
    }
  }

  /** Reset all counters (flush the entire database) */
  async resetAll(): Promise<void> {
    try {
      await redis.flushdb();
    } catch (err) {
      logger.error('Redis rate limit resetAll failed', err as Error);
    }
  }

  /** Return the current hit count for a key (for monitoring) */
  async getHitCount(key: string): Promise<number> {
    try {
      const result = await redis.get(this.key(key));
      return result ? parseInt(result, 10) : 0;
    } catch {
      return 0;
    }
  }
}

// Singleton Redis connection for the rate-limit store
// (reused by all per-surface limiters to avoid connection proliferation)
let rateLimitRedis: Redis | null = null;

export function getRateLimitRedis(): Redis {
  if (!rateLimitRedis) {
    rateLimitRedis = redis;
  }
  return rateLimitRedis;
}
