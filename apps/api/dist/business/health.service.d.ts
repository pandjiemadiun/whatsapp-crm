interface DependencyStatus {
    status: 'ok' | 'down' | 'error' | 'unconfigured';
    responseTime?: number;
    lastCheck?: string;
    error?: string;
}
interface SystemStatus {
    status: 'ok' | 'degraded' | 'down';
    timestamp: string;
    uptime: number;
    dependencies: {
        database: DependencyStatus;
        redis: DependencyStatus;
        groq: DependencyStatus;
        gemini: DependencyStatus;
        /** Dynamic AIProviderConfig-backed providers (per role). Present when
         *  llm.useDynamicProviders is ON; omitted/empty when OFF. Added in Unit 5. */
        aiProviders?: Record<string, {
            providers: string[];
            healthy: boolean;
            error?: string;
        }>;
    };
    metrics: {
        totalStores: number;
        activeStores: number;
        totalConversations: number;
        totalMessages: number;
        aiResponsesLast24h: number;
        avgResponseTime: number;
        whatsappConnected: number;
        whatsappDisconnected: number;
    };
}
export declare class HealthService {
    getSystemStatus(forceRefresh?: boolean): Promise<SystemStatus>;
    checkDatabase(): Promise<DependencyStatus>;
    checkRedis(): Promise<DependencyStatus>;
    checkGroq(): Promise<DependencyStatus>;
    checkGemini(): Promise<DependencyStatus>;
    /**
     * Unit 5 — health for dynamic AIProviderConfig-backed providers.
     * Shape choice: a SEPARATE `aiProviders` section on the dependencies object
     * (merged alongside groq/gemini, which are NOT removed). Gated on the
     * feature flag: when OFF (default, no DB rows) returns {} with no DB read,
     * preserving the existing health response exactly.
     */
    checkAiProviders(): Promise<Record<string, {
        providers: string[];
        healthy: boolean;
        error?: string;
    }>>;
    getMetrics(): Promise<{
        totalStores: number;
        activeStores: number;
        totalConversations: number;
        totalMessages: number;
        aiResponsesLast24h: number;
        avgResponseTime: number;
        whatsappConnected: number;
        whatsappDisconnected: number;
    }>;
}
export declare const healthService: HealthService;
export declare function startHealthCheckInterval(): void;
export {};
//# sourceMappingURL=health.service.d.ts.map