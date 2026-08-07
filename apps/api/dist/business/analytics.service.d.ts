export type DateRange = '7d' | '30d' | '90d';
export interface AnalyticsResult {
    range: DateRange;
    periodStart: string;
    periodEnd: string;
    messageVolumeTrend: Array<{
        date: string;
        customer: number;
        assistant: number;
        system: number;
    }>;
    costTrendUSD: Array<{
        date: string;
        cost: number;
    }>;
    responseTimeTrend: Array<{
        date: string;
        avgMs: number;
        count: number;
    }>;
    sourceBreakdown: Array<{
        source: string;
        count: number;
        percentage: number;
    }>;
    aiResponseRate: number;
    faqMatchRate: number;
    humanTakeoverRate: number;
    orderFunnel: Array<{
        status: string;
        count: number;
        percentage: number;
    }>;
    revenueTrend: Array<{
        date: string;
        revenue: number;
        orderCount: number;
    }>;
    activeStores: number;
    activeCustomers: number;
    totalMessages: number;
    totalOrders: number;
    totalCostUSD: number;
}
export declare class AnalyticsService {
    /**
     * Get aggregated analytics for the admin dashboard.
     * Uses 5-minute TTL caching (trend data is less time-sensitive than live health checks).
     */
    getAnalytics(range?: DateRange, forceRefresh?: boolean): Promise<AnalyticsResult>;
    /** Force-clear analytics cache. */
    invalidateCache(): void;
}
export declare const analyticsService: AnalyticsService;
//# sourceMappingURL=analytics.service.d.ts.map