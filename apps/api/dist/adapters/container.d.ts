export declare const adapters: {
    logger: {
        info: (msg: string, meta?: unknown) => import("winston").Logger;
        debug: (msg: string, meta?: unknown) => import("winston").Logger;
        warn: (msg: string, meta?: unknown) => import("winston").Logger;
        error: (msg: string, error?: unknown, meta?: unknown) => void;
    };
    ai: {
        generate: (prompt: string, options?: any) => Promise<import("./ai/types.js").AIResponse>;
        extractIntent: (message: string, contextSummary?: string) => Promise<import("./ai/types.js").ExtractedIntent>;
        getStats: () => {
            primary: {
                success: number;
                failed: number;
                retried: number;
            };
            fallback: {
                success: number;
                failed: number;
            };
            errorLog: {
                provider: string;
                category: import("./ai/types.js").ErrorCategory;
                timestamp: Date;
            }[];
        };
        getProviders: () => {
            primary: string;
            fallback: string;
            gatekeeper: string;
        };
    };
    cache: import("./cache/redis.adapter.js").RedisAdapter;
    llm: {
        chat: (messages: any[], options?: any) => Promise<import("./ai/types.js").AIResponse>;
    };
    catalogStorage: import("./storage/r2.adapter.js").StorageAdapter;
    profileStorage: import("./storage/r2.adapter.js").StorageAdapter;
};
export declare function initAdapters(): Promise<void>;
export declare function reloadAdaptersConfig(): Promise<void>;
//# sourceMappingURL=container.d.ts.map