// Fallback in-memory
const memoryEntries = [];
const memoryReviews = new Map();
// Helper untuk limitasi 1000 entry (seperti Redis zremrangebyrank)
const MAX_ENTRIES = 1000;
export async function saveShadowEntry(entry) {
    memoryEntries.push(entry);
    memoryEntries.sort((a, b) => a.timestamp - b.timestamp);
    if (memoryEntries.length > MAX_ENTRIES) {
        memoryEntries.shift();
    }
}
export async function getRecentEntries(limit = 50) {
    return memoryEntries.slice(-limit);
}
export async function saveReviewItem(item) {
    memoryReviews.set(item.id, item);
}
export async function getPendingReviews(limit = 20) {
    return Array.from(memoryReviews.values())
        .filter(item => !item.reviewed)
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, limit);
}
export async function updateReviewDecision(id, decision, note) {
    const item = memoryReviews.get(id);
    if (item) {
        item.reviewed = true;
        item.decision = decision;
        item.note = note;
        memoryReviews.set(id, item);
    }
}
//# sourceMappingURL=shadow-storage.js.map