import { ShadowEntry, ShadowReviewItem } from './shadow-types.js';
export declare function saveShadowEntry(entry: ShadowEntry): Promise<void>;
export declare function getRecentEntries(limit?: number): Promise<ShadowEntry[]>;
export declare function saveReviewItem(item: ShadowReviewItem): Promise<void>;
export declare function getPendingReviews(limit?: number): Promise<ShadowReviewItem[]>;
export declare function updateReviewDecision(id: string, decision: ShadowReviewItem['decision'], note: string | null): Promise<void>;
//# sourceMappingURL=shadow-storage.d.ts.map