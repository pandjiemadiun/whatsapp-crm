/**
 * Unit tests — pendingClarification.resolvePending (word-boundary fix).
 *
 * Runner:
 *   npx tsx --env-file=../../.env --test --test-force-exit src/tests/pending-clarification.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePending } from '../services/chat/pendingClarification.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function ctxWith(ops?: any[], snapshot?: any[], retryCount = 0) {
  return {
    pending: { ops, snapshot, retryCount },
    requiresHumanReview: false,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('resolvePending — true positive: "ga jadi deh" → ROLLBACK', () => {
  const result = resolvePending(ctxWith([{ type: 'ADD_TO_CART' }], [{ id: 'x' }]), 'ga jadi deh');
  assert.equal(result.action, 'ROLLBACK');
});

test('resolvePending — true positive: "gak usah" → ROLLBACK', () => {
  const result = resolvePending(ctxWith([{ type: 'ADD_TO_CART' }], [{ id: 'x' }]), 'gak usah');
  assert.equal(result.action, 'ROLLBACK');
});

test('resolvePending — true positive: "batal" → ROLLBACK', () => {
  const result = resolvePending(ctxWith([{ type: 'ADD_TO_CART' }], [{ id: 'x' }]), 'batal');
  assert.equal(result.action, 'ROLLBACK');
});

test('resolvePending — true negative: "Panji dagangan" → NOT ROLLBACK', () => {
  const result = resolvePending(ctxWith([{ type: 'ADD_TO_CART' }], [{ id: 'x' }]), 'Panji dagangan');
  assert.notEqual(result.action, 'ROLLBACK');
});

test('resolvePending — true negative: "harga bagus" → NOT ROLLBACK', () => {
  const result = resolvePending(ctxWith([{ type: 'ADD_TO_CART' }], [{ id: 'x' }]), 'harga bagus');
  assert.notEqual(result.action, 'ROLLBACK');
});

test('resolvePending — true negative: "juga boleh" → NOT ROLLBACK', () => {
  const result = resolvePending(ctxWith([{ type: 'ADD_TO_CART' }], [{ id: 'x' }]), 'juga boleh');
  assert.notEqual(result.action, 'ROLLBACK');
});

test('resolvePending — true positive: "iya" → EXECUTE', () => {
  const result = resolvePending(ctxWith([{ type: 'ADD_TO_CART' }]), 'iya');
  assert.equal(result.action, 'EXECUTE');
});

test('resolvePending — true positive: "oke" → EXECUTE', () => {
  const result = resolvePending(ctxWith([{ type: 'ADD_TO_CART' }]), 'oke');
  assert.equal(result.action, 'EXECUTE');
});

test('resolvePending — retry cap: unknown message → RETRY then ESCALATE', () => {
  const ctx = ctxWith([{ type: 'ADD_TO_CART' }]);
  const r1 = resolvePending(ctx, 'mungkin');
  assert.equal(r1.action, 'RETRY');
  const r2 = resolvePending(ctx, 'mungkin lagi');
  assert.equal(r2.action, 'ESCALATE');
  assert.equal(ctx.requiresHumanReview, true);
});
