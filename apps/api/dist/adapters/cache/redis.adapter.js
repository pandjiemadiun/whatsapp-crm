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
    async get(key) {
        try {
            const data = await redis.get(key);
            return data ? JSON.parse(data) : null;
        }
        catch (err) {
            adapters.logger.error(`Redis GET failed: ${key}`, err);
            return null;
        }
    }
    async set(key, value, ttlSeconds = 3600) {
        try {
            await redis.setex(key, ttlSeconds, JSON.stringify(value));
        }
        catch (err) {
            adapters.logger.error(`Redis SET failed: ${key}`, err);
        }
    }
    async del(key) {
        try {
            await redis.del(key);
        }
        catch (err) {
            adapters.logger.error(`Redis DEL failed: ${key}`, err);
        }
    }
    async keys(pattern) {
        try {
            return await redis.keys(pattern);
        }
        catch (err) {
            adapters.logger.error(`Redis KEYS failed: ${pattern}`, err);
            return [];
        }
    }
    async clearStore(storeId) {
        try {
            const keys = await this.keys(`knowledge:${storeId}:*`);
            if (keys.length > 0) {
                await redis.del(...keys);
                adapters.logger.info(`Redis: cleared ${keys.length} keys for store ${storeId}`);
            }
        }
        catch (err) {
            adapters.logger.error(`Redis CLEAR failed: ${storeId}`, err);
        }
    }
    async close() {
        await redis.quit();
    }
    async ping() {
        try {
            const result = await redis.ping();
            return result === 'PONG';
        }
        catch {
            return false;
        }
    }
}
export const redisAdapter = new RedisAdapter();
//# sourceMappingURL=redis.adapter.js.map