/**
 * Unit test — Act Planner (FASE A2 / planner v3.2)
 * Runner: node:test via tsx (proyek tidak memakai jest).
 *   npx tsx --env-file=../../.env --test --test-force-exit \
 *     src/services/chat/__tests__/planner-v2.test.ts
 *
 * I8: semua test di bawah adalah 0-LLM — tidak ada panggilan model/DB.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planActs } from '../planner.js';
import type { ActV2 } from '../types-v2.js';

// ─────────────────────────────────────────────────────────────────────────────
// Factory helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeAct(overrides: Partial<ActV2> = {}): ActV2 {
  return {
    act_id: 'a1',
    intent: 'smalltalk',
    entities: [],
    qty_source: 'default',
    confidence: 0.5,
    supersedes: null,
    ...overrides,
  };
}

function ids(acts: ActV2[]): string[] {
  return acts.map((a) => a.act_id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Supersede chain resolution (act_id based)
// ─────────────────────────────────────────────────────────────────────────────

describe('planActs — supersede chain (BAGIAN 2)', () => {
  it('chain 2-level "es teh" -> "es jeruk" -> "kentang": hanya kentang di output', () => {
    const esTeh = makeAct({
      act_id: 'es_teh',
      intent: 'cart_update',
      entities: [{ type: 'product', value: 'es teh', confidence: 0.9 }],
    });
    const esJeruk = makeAct({
      act_id: 'es_jeruk',
      intent: 'cart_update',
      supersedes: 'es_teh',
      entities: [{ type: 'product', value: 'es jeruk', confidence: 0.9 }],
    });
    const kentang = makeAct({
      act_id: 'kentang',
      intent: 'cart_update',
      supersedes: 'es_jeruk',
      entities: [{ type: 'product', value: 'kentang', confidence: 0.9 }],
    });

    const result = planActs([esTeh, esJeruk, kentang]);
    assert.equal(result.length, 1);
    assert.equal(result[0].act_id, 'kentang');
    assert.equal(ids(result).includes('es_teh'), false); // I15: superseded tidak muncul
    assert.equal(ids(result).includes('es_jeruk'), false);
  });

  it('resolusi berdasarkan act_id, bukan index — urutan input dibalik tetap benar', () => {
    const kentang = makeAct({ act_id: 'kentang', supersedes: 'es_jeruk' });
    const esJeruk = makeAct({ act_id: 'es_jeruk', supersedes: 'es_teh' });
    const esTeh = makeAct({ act_id: 'es_teh' });

    const result = planActs([kentang, esJeruk, esTeh]);
    assert.deepEqual(ids(result), ['kentang']);
  });

  it('act yang di-supersede tidak muncul di output final', () => {
    const a = makeAct({ act_id: 'a', intent: 'cart_update' });
    const b = makeAct({ act_id: 'b', intent: 'safety', supersedes: 'a' });

    const result = planActs([a, b]);
    assert.equal(result.length, 1);
    assert.equal(result[0].act_id, 'b');
    assert.equal(ids(result).includes('a'), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cycle detection
// ─────────────────────────────────────────────────────────────────────────────

describe('planActs — cycle detection (BAGIAN 2)', () => {
  it('siklus a1 -> a2 -> a1: kedua act dibuang', () => {
    const a1 = makeAct({ act_id: 'a1', supersedes: 'a2' });
    const a2 = makeAct({ act_id: 'a2', supersedes: 'a1' });

    const result = planActs([a1, a2]);
    assert.equal(result.length, 0);
  });

  it('act di luar siklus tetap bertahan bila tidak tersentuh siklus', () => {
    const a1 = makeAct({ act_id: 'a1', supersedes: 'a2' });
    const a2 = makeAct({ act_id: 'a2', supersedes: 'a1' }); // siklus a1<->a2
    const b = makeAct({ act_id: 'b', intent: 'cart_update' }); // tidak tersentuh

    const result = planActs([a1, a2, b]);
    assert.deepEqual(ids(result), ['b']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Priority ordering
// ─────────────────────────────────────────────────────────────────────────────

describe('planActs — prioritas (BAGIAN 2)', () => {
  it('cart_update sebelum smalltalk', () => {
    const sm = makeAct({ act_id: 'sm', intent: 'smalltalk' });
    const cu = makeAct({ act_id: 'cu', intent: 'cart_update' });

    const result = planActs([sm, cu]);
    assert.deepEqual(result.map((a) => a.intent), ['cart_update', 'smalltalk']);
  });

  it('act tanpa supersedes tetap urut per prioritas (6 kategori)', () => {
    const acts = [
      makeAct({ act_id: 'smalltalk', intent: 'smalltalk' }),
      makeAct({ act_id: 'recommendation', intent: 'recommendation' }),
      makeAct({ act_id: 'info_answer', intent: 'info_answer' }),
      makeAct({ act_id: 'cart_update', intent: 'cart_update' }),
      makeAct({ act_id: 'clarification', intent: 'clarification' }),
      makeAct({ act_id: 'safety', intent: 'safety' }),
    ];

    const result = planActs(acts);
    // safety(1) > clarification(2) > cart_update(3) > info_answer(4) > recommendation(5) > smalltalk(6)
    assert.deepEqual(result.map((a) => a.intent), [
      'safety',
      'clarification',
      'cart_update',
      'info_answer',
      'recommendation',
      'smalltalk',
    ]);
  });

  it('prioritas tetap terjaga setelah supersede chain diselesaikan', () => {
    // smalltalk supersede-nya safety; hanya safety yang survive, dan safety (rank 1)
    const sm = makeAct({ act_id: 'sm', intent: 'smalltalk' });
    const safety = makeAct({
      act_id: 'safety',
      intent: 'safety',
      supersedes: 'sm',
    });
    const cu = makeAct({ act_id: 'cu', intent: 'cart_update' });

    const result = planActs([sm, safety, cu]);
    // sm supersede -> hilang; survivor: safety (1) < cart_update (3)
    assert.deepEqual(result.map((a) => a.intent), ['safety', 'cart_update']);
  });
});
