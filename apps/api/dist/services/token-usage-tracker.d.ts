export interface TokenLogEntry {
    timestamp: number;
    provider: string;
    role?: string;
    model: string;
    intent: string;
    conversationId: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
}
export interface UsageSummary {
    totalRequests: number;
    totalTokens: number;
    totalCostUsd: number;
    perProvider: Record<string, {
        requests: number;
        inputTokens: number;
        outputTokens: number;
        costUsd: number;
    }>;
    perIntent: Record<string, {
        requests: number;
        tokens: number;
        costUsd: number;
    }>;
    requestsPerMinute: number;
    timeSeries: Array<{
        minute: string;
        requests: number;
        tokens: number;
    }>;
}
export declare function logTokenUsage(entry: TokenLogEntry): void;
export declare function getUsageLastHour(): UsageSummary;
export interface TimeRangeQuery {
    from: Date;
    to: Date;
}
export declare function validateTimeRange(query: TimeRangeQuery): string | null;
/**
 * Flexible time-range aggregation from DB. Returns the same per-provider shape
 * as getUsageLastHour() for consistency, but for any range (day/week/month/historical).
 */
export declare function queryUsage(range: TimeRangeQuery): Promise<Record<string, {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
}>>;
//# sourceMappingURL=token-usage-tracker.d.ts.map