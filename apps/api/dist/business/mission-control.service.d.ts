export interface SystemHealth {
    db: boolean;
    redis: boolean;
    gowa: boolean;
}
export interface MissionControlPulse {
    totalActiveMerchants: number;
    totalMessagesToday: number;
    aiCostToday: number;
    systemHealth: SystemHealth;
}
export interface ModelUsageEntry {
    model: string;
    count: number;
    totalCostUSD: number;
}
export interface AiOpsResult {
    modelUsage: ModelUsageEntry[];
    fallbackRate: number;
}
export interface HourlyActivityEntry {
    hour: number;
    messageCount: number;
}
export interface HeatmapResult {
    hourlyActivity: HourlyActivityEntry[];
}
export interface MerchantStat {
    storeId: string;
    storeName: string;
    messageCount: number;
    lastActiveAt: string | null;
}
export interface LeaderboardResult {
    topMerchants: MerchantStat[];
}
export interface StoreWhatsAppStatus {
    storeId: string;
    storeName: string;
    hasGowa: boolean;
    hasFonnte: boolean;
    lastMessageAt: string | null;
}
export declare class MissionControlService {
    /**
     * GET /api/admin/mission-control/pulse
     * Real-time platform pulse: active merchants, message volume, AI cost, system health.
     */
    getPulse(): Promise<MissionControlPulse>;
    /**
     * GET /api/admin/mission-control/ai-ops?range=7d|30d|90d
     * AI provider usage breakdown: model usage counts, total costs, fallback rate.
     */
    getAiOps(range: string): Promise<AiOpsResult>;
    /**
     * GET /api/admin/mission-control/heatmap?days=7
     * Hourly activity distribution across all stores (UTC hour grouping).
     */
    getHeatmap(days: number): Promise<HeatmapResult>;
    /**
     * GET /api/admin/mission-control/leaderboard?range=7d|30d|90d
     * Top 10 merchants by message volume, with store name and last active timestamp.
     */
    getLeaderboard(range: string): Promise<LeaderboardResult>;
    /**
     * GET /api/admin/mission-control/wa-status
     * WhatsApp gateway connection status for all active stores.
     */
    getWaStatus(): Promise<StoreWhatsAppStatus[]>;
}
export declare const missionControlService: MissionControlService;
//# sourceMappingURL=mission-control.service.d.ts.map