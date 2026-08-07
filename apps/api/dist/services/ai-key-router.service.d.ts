export interface KeyRouterStats {
    totalKeys: number;
    availableKeys: number;
    cooldownKeys: number;
    currentKey: string | null;
}
export declare class AiKeyRouter {
    private keys;
    private lastLoaded;
    private readonly RELOAD_INTERVAL_MS;
    /** Parse comma-separated env var. Validation: minimal 1 key. */
    parseKeys(envValue: string | undefined): string[];
    /** Load keys from env / Redis cache. */
    loadKeys(keysSource?: string): Promise<string[]>;
    /** Reload keys if cache expired or forced. */
    reloadKeys(keysSource?: string): Promise<string[]>;
    /**
     * getAvailableKey — loop semua key, lewati yang sedang cooldown,
     * kembalikan key pertama yang available. Jika semua cooldown → null.
     */
    getAvailableKey(): Promise<string | null>;
    /** Check if a key is in Redis cooldown. */
    private isInCooldown;
    /**
     * reportRateLimit — set Redis cooldown key dengan TTL = retryAfterSeconds.
     * Default 60 detik jika header tidak ada.
     */
    reportRateLimit(apiKey: string, retryAfterSeconds?: number): Promise<void>;
    /** Get current router stats. */
    getStats(): Promise<KeyRouterStats>;
    /** Clear all cooldowns (for testing/reset). */
    clearCoolDowns(): Promise<void>;
    /** Get the active API key hash (for logging). */
    getCurrentKeyHash(): string | null;
}
export declare const aiKeyRouter: AiKeyRouter;
//# sourceMappingURL=ai-key-router.service.d.ts.map