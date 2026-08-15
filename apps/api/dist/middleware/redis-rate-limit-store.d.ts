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
interface HitRecord {
    totalHits: number;
    resetTime: Date;
}
export declare class RedisRateLimitStore {
    prefix: string;
    windowMs: number;
    constructor(prefix: string, windowMs: number);
    key(key: string): string;
    /**
     * Increment the rate limit counter for a key.
     * Atomic via Redis INCR + PEXPIRE (pipeline for atomicity).
     * Returns { totalHits, resetTime } as required by express-rate-limit v8.
     */
    increment(key: string): Promise<HitRecord>;
    /** Decrement the counter for a key (used on route completion) */
    decrement(key: string): Promise<void>;
    /** Reset the counter for a specific key */
    resetKey(key: string): Promise<void>;
    /** Reset all counters (flush the entire database) */
    resetAll(): Promise<void>;
    /** Return the current hit count for a key (for monitoring) */
    getHitCount(key: string): Promise<number>;
}
export declare function getRateLimitRedis(): Redis;
export {};
//# sourceMappingURL=redis-rate-limit-store.d.ts.map