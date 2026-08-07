interface FollowUpScanResult {
    conversationId: string;
    storeId: string;
    customerId: string;
    matched: boolean;
    reasons: string[];
}
interface ScanOpts {
    dryRun?: boolean;
    now?: Date;
}
/**
 * Proactive follow-up scheduler.
 *
 * Every 10 minutes (configurable via FOLLOWUP_CRON env), scans for open conversations
 * that have been inactive for >= (store.config.followUpDelayHours ?? 4) JAM and < 24 jam.
 * Generates a proactive follow-up via Groq and sends it via the store's configured
 * gateway (Fonnte → GOWA fallback). Skips night-mode stores (fallback 08.00–20.00 WIB).
 */
export declare function scheduleFollowUps(): void;
export declare function runFollowUpScan(opts?: ScanOpts): Promise<FollowUpScanResult[]>;
export {};
//# sourceMappingURL=scheduleFollowUps.d.ts.map