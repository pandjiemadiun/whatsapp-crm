import { describe, it } from 'node:test';
import assert from 'node:assert';
import { computeShadowSummary } from '../shadow-summary.js';
import * as storage from '../shadow-storage.js';

describe('shadow-summary', () => {
  it('computeShadowSummary dengan 0 entry', async () => {
    const summary = await computeShadowSummary();
    assert.strictEqual(summary.total, 0);
    assert.strictEqual(summary.mismatchRate, 0);
  });

  it('computeShadowSummary dengan mismatch', async () => {
    // Clear storage (simulated by overwriting with fresh data)
    // In real app, might need a cleanup method
    const entryBase = {
        engine_version: '3.2',
        schema_version: '1',
        timestamp: Date.now(),
        new: { llmCalls: 1 }
    };
    
    await storage.saveShadowEntry({ ...entryBase, store_id: 's1', mismatch: { replyDiffers: true, entitySetDiffers: false } } as any);
    await storage.saveShadowEntry({ ...entryBase, store_id: 's1', mismatch: { replyDiffers: false, entitySetDiffers: false } } as any);

    const summary = await computeShadowSummary('s1');
    assert.strictEqual(summary.total, 2);
    assert.strictEqual(summary.mismatchRate, 0.5);
    assert.strictEqual(summary.avgLlmCalls, 1);
  });
});
