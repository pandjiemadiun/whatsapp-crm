/**
 * Unit test — Pending Clarification Resolver (BAGIAN 2)
 * Runner: node:test via tsx (proyek tidak memakai jest).
 *   npx tsx --env-file=../../.env --test --test-force-exit \
 *     src/services/chat/__tests__/pendingClarification.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePending } from '../pendingClarification.js';
function makeCtx(pending) {
    return { pending, requiresHumanReview: false };
}
const NEUTRAL = 'permintaan baru 123xyz'; // tidak mengandung aff/neg substring
describe('resolvePending (BAGIAN 2)', () => {
    it('"dua duanya" + pending.ops -> action: EXECUTE', () => {
        const ops = [
            { type: 'add', product: 'Beras', qty: 1 },
        ];
        const ctx = makeCtx({ ops, retryCount: 0 });
        const r = resolvePending(ctx, 'dua duanya');
        assert.equal(r.action, 'EXECUTE');
        assert.equal(r.ops, ops);
    });
    it('"semua" + pending.ops -> action: EXECUTE', () => {
        const ops = [
            { type: 'add', product: 'Gula', qty: 2 },
        ];
        const ctx = makeCtx({ ops, retryCount: 0 });
        const r = resolvePending(ctx, 'semua');
        assert.equal(r.action, 'EXECUTE');
        assert.equal(r.ops, ops);
    });
    it('"ga jadi" + pending.snapshot -> action: ROLLBACK', () => {
        const snapshot = { cart: [{ product: 'Beras', qty: 1 }] };
        const ctx = makeCtx({ snapshot, retryCount: 0 });
        const r = resolvePending(ctx, 'ga jadi');
        assert.equal(r.action, 'ROLLBACK');
        assert.equal(r.snapshot, snapshot);
    });
    it('"iya" + pending.ops -> action: EXECUTE (I10: 0 LLM)', () => {
        const ops = [
            { type: 'add', product: 'Teh', qty: 1 },
        ];
        const ctx = makeCtx({ ops, retryCount: 0 });
        const r = resolvePending(ctx, 'iya');
        assert.equal(r.action, 'EXECUTE');
    });
    it('"random" + retryCount=0 -> action: RETRY, retryCount jadi 1', () => {
        const ctx = makeCtx({ retryCount: 0 });
        const r = resolvePending(ctx, NEUTRAL);
        assert.equal(r.action, 'RETRY');
        assert.equal(ctx.pending.retryCount, 1);
    });
    it('"random" + retryCount=1 -> action: ESCALATE', () => {
        const ctx = makeCtx({ retryCount: 1 });
        const r = resolvePending(ctx, NEUTRAL);
        assert.equal(r.action, 'ESCALATE');
        assert.equal(ctx.requiresHumanReview, true);
    });
});
//# sourceMappingURL=pendingClarification.test.js.map