/**
 * Unit test — Workspace v2 Accessor (FASE A2)
 * Runner: node:test via tsx (proyek tidak memakai jest).
 *   npx tsx --env-file=../../.env --test --test-force-exit \
 *     src/services/chat/__tests__/workspace-v2.test.ts
 *
 * I8: semua test di bawah adalah 0-LLM — tidak ada panggilan model/DB.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadWorkspace,
  saveWorkspace,
  getPendings,
  parkPending,
  resumePending,
  resolvePending,
  dropPending,
  incrementAttempts,
  incrementDeferredTurns,
  shouldAutoDrop,
  addToDraft,
  confirmDraftItem,
  setFact,
  getFact,
  setLastBotMessage,
  getSummary,
  setSummary,
} from '../workspace.js';
import type { WorkspaceV2, PendingV2, ActV2, DraftCartOp } from '../types-v2.js';
import { DEFERRED_AUTO_DROP_TURNS } from '../constants-v2.js';

// ─────────────────────────────────────────────────────────────────────────────
// Factory helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeWorkspace(overrides: Partial<WorkspaceV2> = {}): WorkspaceV2 {
  return {
    schema_version: '3.2',
    conversation_summary: '',
    pendings: [],
    draft_cart: [],
    resolved_facts: {},
    options_presented: [],
    ...overrides,
  };
}

function makePending(overrides: Partial<PendingV2> = {}): PendingV2 {
  return {
    id: 'p1',
    question: 'Mau tambah?',
    options: ['iya', 'tidak'],
    status: 'active',
    attempts: 0,
    deferred_turns: 0,
    asked_at: '2026-08-07T00:00:00Z',
    ...overrides,
  };
}

function makeAct(overrides: Partial<ActV2> = {}): ActV2 {
  return {
    act_id: 'a1',
    intent: 'buy',
    entities: [{ type: 'product', value: 'Ayam Goreng', confidence: 0.9 }],
    qty: 1,
    qty_source: 'explicit',
    confidence: 0.85,
    supersedes: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Load / Save (JSON round-trip)
// ─────────────────────────────────────────────────────────────────────────────

describe('loadWorkspace / saveWorkspace (FASE A2)', () => {
  it('saveWorkspace lalu loadWorkspace mempertahankan seluruh bidang', () => {
    const ws = makeWorkspace({
      conversation_summary: 'customer mau ayam goreng',
      last_bot_message_type: 'text',
      options_presented: [['iya', 'tidak']],
    });
    const json = saveWorkspace(ws);
    const loaded = loadWorkspace(json);
    assert.equal(loaded.schema_version, '3.2');
    assert.equal(loaded.conversation_summary, 'customer mau ayam goreng');
    assert.equal(loaded.last_bot_message_type, 'text');
    assert.deepEqual(loaded.options_presented, [['iya', 'tidak']]);
    assert.equal(loaded.pendings.length, 0);
  });

  it('loadWorkspace meng-default bidang struktural bila hilang', () => {
    const loaded = loadWorkspace(JSON.stringify({ schema_version: '3.2' }));
    assert.equal(loaded.schema_version, '3.2');
    assert.equal(loaded.conversation_summary, '');
    assert.deepEqual(loaded.pendings, []);
    assert.deepEqual(loaded.draft_cart, []);
    assert.deepEqual(loaded.resolved_facts, {});
    assert.deepEqual(loaded.options_presented, []);
    assert.equal(loaded.last_bot_message_type, undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pending: park / resume / resolve / drop
// ─────────────────────────────────────────────────────────────────────────────

describe('pending lifecycle (FASE A2)', () => {
  it('parkPending menambahkan pending; getPendings memfilter per status (I10: 0 LLM)', () => {
    const ws = makeWorkspace();
    const p = makePending({ status: 'dropped' });
    parkPending(ws, makePending({ id: 'p1', status: 'active' }));
    parkPending(ws, p);

    assert.equal(ws.pendings.length, 2);
    assert.equal(getPendings(ws, 'active').length, 1);
    assert.equal(getPendings(ws, 'dropped').length, 1);
    assert.equal(getPendings(ws).length, 2);
    // chaining: parkPending mengembalikan ws
    assert.equal(parkPending(ws, makePending({ id: 'p3' })), ws);
  });

  it('resumePending menggeser deferred -> active', () => {
    const ws = makeWorkspace();
    parkPending(ws, makePending({ id: 'q1', status: 'deferred' }));
    const r = resumePending(ws, 'q1');
    assert.ok(r);
    assert.equal(r!.status, 'active');
  });

  it('resolvePending mengubah status -> resolved (I10: 0 LLM)', () => {
    const ws = makeWorkspace();
    parkPending(ws, makePending({ id: 'q2', status: 'active' }));
    const r = resolvePending(ws, 'q2');
    assert.equal(r?.status, 'resolved');
  });

  it('dropPending mengubah status -> dropped', () => {
    const ws = makeWorkspace();
    parkPending(ws, makePending({ id: 'q3', status: 'active' }));
    const r = dropPending(ws, 'q3');
    assert.equal(r?.status, 'dropped');
  });

  it('incrementAttempts menambah attempts (retry bookkeeping, 0-LLM)', () => {
    const ws = makeWorkspace();
    parkPending(ws, makePending({ id: 'q4', attempts: 0 }));
    assert.equal(incrementAttempts(ws, 'q4')?.attempts, 1);
    assert.equal(incrementAttempts(ws, 'q4')?.attempts, 2);
    assert.equal(incrementAttempts(ws, 'tidak-ada') , undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Deferred turns + shouldAutoDrop (0, 2, 3 turn)
// ─────────────────────────────────────────────────────────────────────────────

describe('incrementDeferredTurns + shouldAutoDrop (FASE A2)', () => {
  it('DEFERRED_AUTO_DROP_TURNS === 3', () => {
    assert.equal(DEFERRED_AUTO_DROP_TURNS, 3);
  });

  it('deferred_turns = 0 -> shouldAutoDrop false', () => {
    const p = makePending({ deferred_turns: 0 });
    assert.equal(shouldAutoDrop(p), false);
  });

  it('deferred_turns = 2 -> shouldAutoDrop false', () => {
    const p = makePending({ deferred_turns: 2 });
    assert.equal(shouldAutoDrop(p), false);
  });

  it('deferred_turns = 3 -> shouldAutoDrop true (>= DEFERRED_AUTO_DROP_TURNS)', () => {
    const p = makePending({ deferred_turns: 3 });
    assert.equal(shouldAutoDrop(p), true);
  });

  it('incrementDeferredTurns naik 0 -> 1 -> 2 -> 3, shouldAutoDrop baru true di 3', () => {
    const ws = makeWorkspace();
    parkPending(ws, makePending({ id: 'd1', deferred_turns: 0 }));

    assert.equal(shouldAutoDrop(ws.pendings[0]), false);
    incrementDeferredTurns(ws, 'd1'); // -> 1
    assert.equal(ws.pendings[0].deferred_turns, 1);
    assert.equal(shouldAutoDrop(ws.pendings[0]), false);
    incrementDeferredTurns(ws, 'd1'); // -> 2
    incrementDeferredTurns(ws, 'd1'); // -> 3
    assert.equal(ws.pendings[0].deferred_turns, 3);
    assert.equal(shouldAutoDrop(ws.pendings[0]), true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Draft cart: addToDraft (confirmed vs needs_clarification) + confirmDraftItem
// ─────────────────────────────────────────────────────────────────────────────

describe('addToDraft / confirmDraftItem (FASE A2)', () => {
  it('confidence >= threshold -> status "confirmed" (I15: belum divalidasi ke DB)', () => {
    const ws = makeWorkspace();
    const op = addToDraft(ws, makeAct({ confidence: 0.85 }));
    assert.equal(op.status, 'confirmed');
    assert.equal(op.action, 'add');
    assert.equal(op.product, 'Ayam Goreng');
    assert.equal(op.qty, 1);
    assert.equal(op.qty_source, 'explicit');
    assert.equal(ws.draft_cart.length, 1);
    // draft yang dikembalikan adalah referensi yang sama di ws.draft_cart
    assert.equal(op, ws.draft_cart[0]);
  });

  it('confidence < threshold -> status "needs_clarification"', () => {
    const ws = makeWorkspace();
    const op = addToDraft(ws, makeAct({ confidence: 0.4 }));
    assert.equal(op.status, 'needs_clarification');
  });

  it('intent "remove" -> action "remove"', () => {
    const ws = makeWorkspace();
    const op = addToDraft(ws, makeAct({ intent: 'remove', confidence: 0.9 }));
    assert.equal(op.action, 'remove');
  });

  it('confirmDraftItem memaksa status -> "confirmed"', () => {
    const ws = makeWorkspace();
    addToDraft(ws, makeAct({ confidence: 0.4 })); // needs_clarification
    const before = ws.draft_cart[0] as DraftCartOp;
    assert.equal(before.status, 'needs_clarification');

    const confirmed = confirmDraftItem(ws, 0);
    assert.equal(confirmed?.status, 'confirmed');
    assert.equal(ws.draft_cart[0].status, 'confirmed');
  });

  it('confirmDraftItem index di luar jangkauan -> undefined', () => {
    const ws = makeWorkspace();
    assert.equal(confirmDraftItem(ws, 99), undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Facts, last bot message, summary
// ─────────────────────────────────────────────────────────────────────────────

describe('facts / last bot message / summary (FASE A2)', () => {
  it('setFact/getFact round-trip; fact tak ada -> undefined', () => {
    const ws = makeWorkspace();
    assert.equal(getFact(ws, 'recipient'), undefined);
    setFact(ws, 'recipient', 'Budi');
    assert.equal(getFact(ws, 'recipient'), 'Budi');
  });

  it('setLastBotMessage mencatat type + menambah options_presented', () => {
    const ws = makeWorkspace();
    setLastBotMessage(ws, 'clarification', ['iya', 'tidak']);
    assert.equal(ws.last_bot_message_type, 'clarification');
    assert.deepEqual(ws.options_presented, [['iya', 'tidak']]);
    setLastBotMessage(ws, 'text', []);
    assert.equal(ws.last_bot_message_type, 'text');
    // options kosong tidak ditambahkan
    assert.equal(ws.options_presented.length, 1);
  });

  it('getSummary/setSummary round-trip', () => {
    const ws = makeWorkspace();
    assert.equal(getSummary(ws), '');
    setSummary(ws, 'pesan pertama');
    assert.equal(getSummary(ws), 'pesan pertama');
    assert.equal(ws.conversation_summary, 'pesan pertama');
  });
});
