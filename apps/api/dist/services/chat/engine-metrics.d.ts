export interface EngineV2Metric {
    storeId: string;
    conversationId: string;
    outcome: string;
    llmCalls: number;
    validatorReasons: string[];
    replyLength: number;
    timestamp: number;
}
export declare function logEngineV2Metrics(storeId: string, conversationId: string, outcome: string, llmCalls: number, validatorReasons: string[], replyLength: number): void;
export declare function getCanaryMetrics(storeId: string, days?: number): Promise<{
    totalMessages: number;
    avgLlmCalls: number;
    topValidatorReasons: Array<{
        reason: string;
        count: number;
    }>;
    avgReplyLength: number;
    errorRate: number;
}>;
//# sourceMappingURL=engine-metrics.d.ts.map