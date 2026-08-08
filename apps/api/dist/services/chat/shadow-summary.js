import { getRecentEntries } from './shadow-storage.js';
export async function computeShadowSummary(storeId, hours = 24) {
    const allEntries = await getRecentEntries(500);
    const now = Date.now();
    const cutoff = now - hours * 60 * 60 * 1000;
    const filtered = allEntries.filter(e => {
        const matchesStore = storeId ? e.store_id === storeId : true;
        const matchesTime = e.timestamp >= cutoff;
        return matchesStore && matchesTime;
    });
    const total = filtered.length;
    if (total === 0) {
        return {
            total: 0,
            mismatchRate: 0,
            avgLlmCalls: 0,
            topRejectReasons: [],
            sampleMismatches: [],
            engineVersion: 'unknown',
            schemaVersion: 'unknown',
        };
    }
    const mismatches = filtered.filter(e => e.mismatch.replyDiffers || e.mismatch.entitySetDiffers);
    const mismatchRate = mismatches.length / total;
    const totalLlmCalls = filtered.reduce((sum, e) => sum + e.new.llmCalls, 0);
    const avgLlmCalls = totalLlmCalls / total;
    // Top reject reasons
    const reasonCounts = {};
    filtered.forEach(e => {
        e.new.validatorReasons?.forEach(r => {
            reasonCounts[r] = (reasonCounts[r] || 0) + 1;
        });
    });
    const topRejectReasons = Object.entries(reasonCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(e => e[0]);
    return {
        total,
        mismatchRate,
        avgLlmCalls,
        topRejectReasons,
        sampleMismatches: mismatches.slice(0, 10),
        engineVersion: filtered[0].engine_version,
        schemaVersion: filtered[0].schema_version,
    };
}
//# sourceMappingURL=shadow-summary.js.map