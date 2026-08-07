/**
 * BAGIAN 1 — Token Usage Tracking
 *
 * In-memory tracking per-request (per-hour window).
 * - logRequest: record successful LLM call
 * - getUsageLastHour: aggregate stats
 */
export interface TokenLogEntry {
    timestamp: number;
    provider: string;
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
//# sourceMappingURL=token-usage-tracker.d.ts.map