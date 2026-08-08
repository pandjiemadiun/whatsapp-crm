import { ShadowEntry } from './shadow-types.js';
export declare function computeShadowSummary(storeId?: string, hours?: number): Promise<{
    total: number;
    mismatchRate: number;
    avgLlmCalls: number;
    topRejectReasons: string[];
    sampleMismatches: ShadowEntry[];
    engineVersion: string;
    schemaVersion: string;
}>;
//# sourceMappingURL=shadow-summary.d.ts.map