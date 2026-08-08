export declare class RedisAdapter {
    lpush(key: string, value: string): Promise<number>;
    lrange(key: string, start: number, stop: number): Promise<string[]>;
    ltrim(key: string, start: number, stop: number): Promise<void>;
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    del(key: string): Promise<void>;
    keys(pattern: string): Promise<string[]>;
    clearStore(storeId: string): Promise<void>;
    close(): Promise<void>;
    ping(): Promise<boolean>;
}
export declare const redisAdapter: RedisAdapter;
//# sourceMappingURL=redis.adapter.d.ts.map