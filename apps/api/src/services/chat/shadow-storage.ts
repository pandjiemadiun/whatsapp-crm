import { ShadowEntry, ShadowReviewItem } from './shadow-types.js';

// Fallback in-memory
const memoryEntries: ShadowEntry[] = [];
const memoryReviews: Map<string, ShadowReviewItem> = new Map();

// Helper untuk limitasi 1000 entry (seperti Redis zremrangebyrank)
const MAX_ENTRIES = 1000;

export async function saveShadowEntry(entry: ShadowEntry): Promise<void> {
  memoryEntries.push(entry);
  memoryEntries.sort((a, b) => a.timestamp - b.timestamp);
  
  if (memoryEntries.length > MAX_ENTRIES) {
    memoryEntries.shift();
  }
}

export async function getRecentEntries(limit: number = 50): Promise<ShadowEntry[]> {
  return memoryEntries.slice(-limit);
}

export async function saveReviewItem(item: ShadowReviewItem): Promise<void> {
  memoryReviews.set(item.id, item);
}

export async function getPendingReviews(limit: number = 20): Promise<ShadowReviewItem[]> {
  return Array.from(memoryReviews.values())
    .filter(item => !item.reviewed)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit);
}

export async function updateReviewDecision(id: string, decision: ShadowReviewItem['decision'], note: string | null): Promise<void> {
  const item = memoryReviews.get(id);
  if (item) {
    item.reviewed = true;
    item.decision = decision;
    item.note = note;
    memoryReviews.set(id, item);
  }
}
