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