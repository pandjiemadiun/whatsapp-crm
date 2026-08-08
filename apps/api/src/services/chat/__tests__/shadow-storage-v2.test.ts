import { describe, it } from 'node:test';
import assert from 'node:assert';
import { saveShadowEntry, getRecentEntries, saveReviewItem, getPendingReviews, updateReviewDecision } from '../shadow-storage.js';
import { ShadowEntry, ShadowReviewItem } from '../shadow-types.js';

describe('shadow-storage', () => {
  it('saveShadowEntry + getRecentEntries', async () => {
    const entry: ShadowEntry = {
        conversation_id: 'conv1',
        message_id: 'msg1',
        engine_version: '3.2',
        schema_version: '1',
        timestamp: Date.now(),
        store_id: 'store1',
        old: { source: 'ai' as any, reply: 'hello', entities: [] },
        new: { outcome: 'reasoned', reply_draft: 'hi', intents: [], entities: [], unmatched: [], plannedActs: [], validatorReasons: [], validatorRetryable: false, llmCalls: 0 },
        mismatch: { replyDiffers: false, entitySetDiffers: false, oldEntityCount: 0, newEntityCount: 0 }
    };
    await saveShadowEntry(entry);
    const recent = await getRecentEntries(1);
    assert.strictEqual(recent[0].conversation_id, 'conv1');
  });

  it('getRecentEntries limit', async () => {
    // Add multiple entries
    for (let i = 0; i < 5; i++) {
        await saveShadowEntry({ conversation_id: `conv${i}` } as any);
    }
    const recent = await getRecentEntries(2);
    assert.strictEqual(recent.length, 2);
  });

  it('saveReviewItem + getPendingReviews', async () => {
    const item: ShadowReviewItem = {
        id: 'rev1',
        conversation_id: 'conv1',
        message_id: 'msg1',
        entry: {} as any,
        reviewed: false,
        decision: null,
        note: null,
        created_at: Date.now()
    };
    await saveReviewItem(item);
    const pending = await getPendingReviews(10);
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].id, 'rev1');
  });

  it('updateReviewDecision', async () => {
    await updateReviewDecision('rev1', 'correct', 'good');
    const pending = await getPendingReviews(10);
    assert.strictEqual(pending.length, 0);
  });
});
