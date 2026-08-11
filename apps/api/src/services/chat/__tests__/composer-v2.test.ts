import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { composeReply, composeEscalateReply, escalateStatusUpdate, ESCALATE_REPLY } from '../composer-v2.js';
import type { ActV2, InterpreterResultV2, WorkspaceV2 } from '../types-v2.js';
import { adapters } from '../../../adapters/container.js';

describe('composer-v2', () => {
  const mockWorkspace: WorkspaceV2 = {
    schema_version: '1',
    conversation_summary: '',
    pendings: [],
    draft_cart: [],
    resolved_facts: {},
    options_presented: []
  };

  // ── Logger mock untuk P5.1 #3 (slice(0,3) warning) ────────────────────
  let warnCalls: Array<{ msg: string; meta: unknown }>;
  const originalWarn = adapters.logger.warn;
  beforeEach(() => {
    warnCalls = [];
    adapters.logger.warn = ((msg: string, meta?: unknown) => {
      warnCalls.push({ msg, meta });
    }) as typeof adapters.logger.warn;
  });
  after(() => {
    adapters.logger.warn = originalWarn;
  });

  it('clarification attempt 1 → output dari composeClarification', () => {
    const result: InterpreterResultV2 = {
      acts: [],
      unmatched_mentions: [],
      topic_switch: false,
      draft_cart_ops: [],
      confidence: { entities: 1, intent: 1, selection: 1, topic: 1 },
      clarification: { question: 'Apa?', options: ['A', 'B'], expected_type: 'choice' }
    };
    const reply = composeReply({
      plannedActs: [],
      reasoningResult: result,
      workspace: mockWorkspace,
      catalog: [],
      clarificationAttempt: 1
    });
    assert.match(reply, /Apa\?/);
  });

  it('clarification attempt 3 → fallback message', () => {
    const result: InterpreterResultV2 = {
      acts: [],
      unmatched_mentions: [],
      topic_switch: false,
      draft_cart_ops: [],
      confidence: { entities: 1, intent: 1, selection: 1, topic: 1 },
      clarification: { question: 'Apa?', options: [], expected_type: 'choice' }
    };
    const reply = composeReply({
      plannedActs: [],
      reasoningResult: result,
      workspace: mockWorkspace,
      catalog: [],
      clarificationAttempt: 3
    });
    assert.strictEqual(reply, 'Sepertinya saya kurang paham, mau saya bantu manual?');
  });

  it('plannedActs kosong + reply_draft → return reply_draft', () => {
    const result: InterpreterResultV2 = {
      acts: [],
      unmatched_mentions: [],
      topic_switch: false,
      draft_cart_ops: [],
      confidence: { entities: 1, intent: 1, selection: 1, topic: 1 },
      reply_draft: 'Halo!'
    };
    const reply = composeReply({
      plannedActs: [],
      reasoningResult: result,
      workspace: mockWorkspace,
      catalog: [],
      clarificationAttempt: 0
    });
    assert.strictEqual(reply, 'Halo!');
  });

  it('plannedActs kosong + no reply → return Maaf kak...', () => {
    const result: InterpreterResultV2 = {
      acts: [],
      unmatched_mentions: [],
      topic_switch: false,
      draft_cart_ops: [],
      confidence: { entities: 1, intent: 1, selection: 1, topic: 1 },
    };
    const reply = composeReply({
      plannedActs: [],
      reasoningResult: result,
      workspace: mockWorkspace,
      catalog: [],
      clarificationAttempt: 0
    });
    assert.strictEqual(reply, 'Maaf kak, saya kurang paham.');
  });

  it('cart_update confirmed → Ditambahkan ke keranjang', () => {
    const result: InterpreterResultV2 = {
      acts: [{ act_id: '1', intent: 'add_cart', entities: [], qty_source: 'explicit', confidence: 1, supersedes: null }],
      unmatched_mentions: [],
      topic_switch: false,
      draft_cart_ops: [{ action: 'add', product: 'Ayam', qty: 1, qty_source: 'explicit', status: 'confirmed' }],
      confidence: { entities: 1, intent: 1, selection: 1, topic: 1 },
    };
    const reply = composeReply({
      plannedActs: [{ act_id: '1', intent: 'add_cart', entities: [], qty_source: 'explicit', confidence: 1, supersedes: null }],
      reasoningResult: result,
      workspace: mockWorkspace,
      catalog: [],
      clarificationAttempt: 0
    });
    assert.strictEqual(reply, '🛒 Ditambahkan ke keranjang: Ayam x1');
  });

  it('topic_switch=true → ada reminder pending', () => {
    const result: InterpreterResultV2 = {
      acts: [{ act_id: '1', intent: 'switch_topic', entities: [], qty_source: 'default', confidence: 1, supersedes: null }],
      unmatched_mentions: [],
      topic_switch: true,
      draft_cart_ops: [],
      confidence: { entities: 1, intent: 1, selection: 1, topic: 1 },
    };
    const reply = composeReply({
      plannedActs: [{ act_id: '1', intent: 'switch_topic', entities: [], qty_source: 'default', confidence: 1, supersedes: null }],
      reasoningResult: result,
      workspace: { ...mockWorkspace, pendings: [{ id: '1', question: '?', options: [], status: 'active', attempts: 0, deferred_turns: 0, asked_at: '2026-08-08T00:00:00Z' }] },
      catalog: [],
      clarificationAttempt: 0
    });
    assert.match(reply, /Oh ya Kak, tadi masih lanjut pesan/);
  });

  it('A: greeting (plannedActs kosong) + reply_draft ramah → tidak balas "kurang paham"', () => {
    const result: InterpreterResultV2 = {
      acts: [],
      unmatched_mentions: [],
      topic_switch: false,
      draft_cart_ops: [],
      confidence: { entities: 0, intent: 0.1, selection: 0, topic: 0.2 },
      reply_draft: 'Halo kak! Ada yang bisa saya bantu?',
    };
    const reply = composeReply({
      plannedActs: [],
      reasoningResult: result,
      workspace: mockWorkspace,
      catalog: [],
      clarificationAttempt: 0
    });
    assert.equal(reply, 'Halo kak! Ada yang bisa saya bantu?');
    assert.ok(!reply.includes('kurang paham'));
  });

  it('C: plannedActs cancel act (tanpa draft_cart_ops) → dirender "Dihapus dari keranjang"', () => {
    const result: InterpreterResultV2 = {
      acts: [{ act_id: 'c1', intent: 'cancel', entities: [{ type: 'product', value: 'Wortel', confidence: 0.9 }], qty_source: 'default', confidence: 1, supersedes: null }],
      unmatched_mentions: [],
      topic_switch: false,
      draft_cart_ops: [],
      confidence: { entities: 1, intent: 1, selection: 1, topic: 0.6 },
      reply_draft: 'Oke, wortel sudah saya batalkan.',
    };
    const reply = composeReply({
      plannedActs: [{ act_id: 'c1', intent: 'cancel', entities: [{ type: 'product', value: 'Wortel', confidence: 0.9 }], qty_source: 'default', confidence: 1, supersedes: null }],
      reasoningResult: result,
      workspace: mockWorkspace,
      catalog: [],
      clarificationAttempt: 0
    });
    assert.match(reply, /Dihapus dari keranjang: Wortel/);
    assert.ok(!reply.includes('kurang paham'));
  });

  // ── TASK C1 Stage 2: escalation must be a REAL action, not a generic reply ──
  it('TASK C1: composeEscalateReply() adalah balasan jujur, bukan generic "kurang paham"', () => {
    const reply = composeEscalateReply();
    assert.equal(reply, ESCALATE_REPLY);
    // Wajib menyatakan dengan jujur akan menyambungkan ke admin/pemilik
    assert.match(reply.toLowerCase(), /admin toko|pemilik toko/);
    // Wajib TIDAK sama dengan balasan generik dead-end
    assert.ok(!reply.includes('kurang paham'), 'escalate reply must not be the generic dead-end text');
    // Bandingkan lewat string-typed const agar tidak TS2367 literal-overlap.
    const OLD_CANNED: string = 'Saya akan hubungkan ke pemilik toko.';
    assert.notStrictEqual(reply, OLD_CANNED, 'must not reuse the old canned-only text');
    assert.notStrictEqual(reply, 'Maaf kak, saya kurang paham. Bisa diulang?');
  });

  it('TASK C1: escalateStatusUpdate() memakai konvensi existing (human_takeover + humanTakeoverAt), bukan status baru', () => {
    const update = escalateStatusUpdate();
    // Konvensi yang SUDAH ADA di codebase:
    //   routes/conversations.ts:88   -> status='human_takeover', set humanTakeoverAt
    //   message-processor.service.ts:491 -> sama
    //   schema.prisma Conversation.humanTakeoverAt DateTime?
    assert.equal(update.status, 'human_takeover');
    assert.ok(update.humanTakeoverAt instanceof Date, 'humanTakeoverAt must be a Date');
    assert.ok(update.humanTakeoverAt.getTime() > 0, 'humanTakeoverAt must be populated');
    // JANGAN memperkenalkan enum status baru ('escalated') — pakai konvensi existing.
    assert.equal(update.status, 'human_takeover');
  });

  // ── P5.1: Unit test untuk 5 bug objektif reply composition ──────────────

  // I-2 FIX: v2 path sekarang truncate reply_draft ke ≤2 kalimat
  it('P5.1 I-2: reply_draft >2 kalimat di-truncate ke 2 kalimat pertama', () => {
    const result: InterpreterResultV2 = {
      acts: [],
      unmatched_mentions: [],
      topic_switch: false,
      draft_cart_ops: [],
      confidence: { entities: 1, intent: 1, selection: 1, topic: 1 },
      reply_draft: 'Pertama. Kedua. Ketiga. Keempat!',
    };
    const reply = composeReply({
      plannedActs: [],
      reasoningResult: result,
      workspace: mockWorkspace,
      catalog: [],
      clarificationAttempt: 0,
    });
    // Harus truncate ke 2 kalimat pertama ("Pertama. Kedua.")
    assert.strictEqual(reply, 'Pertama. Kedua.');
    assert.ok(!reply.includes('Ketiga'), 'ketiga kalimat tidak boleh ada');
  });

  // I-2 FIX: reply_draft di info_answer path juga di-truncate
  it('P5.1 I-2: reply_draft di info_answer path di-truncate', () => {
    const result: InterpreterResultV2 = {
      acts: [{ act_id: '1', intent: 'info_answer', entities: [], qty_source: 'default', confidence: 1, supersedes: null }],
      unmatched_mentions: [],
      topic_switch: false,
      draft_cart_ops: [],
      confidence: { entities: 1, intent: 1, selection: 1, topic: 1 },
      reply_draft: 'Harga ayam Rp 36.000. Silakan pesan ya. Terima kasih.',
    };
    const reply = composeReply({
      plannedActs: [{ act_id: '1', intent: 'info_answer', entities: [], qty_source: 'default', confidence: 1, supersedes: null }],
      reasoningResult: result,
      workspace: mockWorkspace,
      catalog: [],
      clarificationAttempt: 0,
    });
    const sentences = reply.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
    assert.ok(sentences.length <= 2, `harus ≤2 kalimat, dapat ${sentences.length}`);
    assert.ok(!reply.includes('Terima kasih'), 'kalimat ketiga tidak boleh ada');
  });

  // #3 FIX: messages >3 → log warning (bukan silently) 
  it('P5.1 #3: 4+ messages → log warning, reply tetap slice(0,3)', () => {
    const manyCartOps = Array.from({ length: 4 }, (_, i) => ({
      action: 'add' as const,
      product: `Produk${i + 1}`,
      qty: 1,
      qty_source: 'explicit' as const,
      status: 'confirmed' as const,
    }));
    const result: InterpreterResultV2 = {
      acts: [{ act_id: '1', intent: 'add_cart', entities: [], qty_source: 'explicit', confidence: 1, supersedes: null }],
      unmatched_mentions: [],
      topic_switch: true,
      draft_cart_ops: manyCartOps,
      confidence: { entities: 1, intent: 1, selection: 1, topic: 1 },
    };
    const reply = composeReply({
      plannedActs: [{ act_id: '1', intent: 'add_cart', entities: [], qty_source: 'explicit', confidence: 1, supersedes: null }],
      reasoningResult: result,
      workspace: mockWorkspace,
      catalog: [],
      clarificationAttempt: 0,
    });
    // Verify warning was logged
    assert.ok(warnCalls.length >= 1, 'harus ada warning log');
    assert.match(warnCalls[0].msg, /truncated to 3/);
    // Verify reply hanya 3 messages (4 cart ops + 1 topic = 5, slice to 3)
    const msgCount = reply.split('\n').length;
    assert.ok(msgCount <= 3, `reply harus ≤3 messages, dapat ${msgCount}`);
  });

  // #4 FIX: draft_cart_ops qty=0 → render "x1" (bukan "x0")
  it('P5.1 #4: draft_cart_ops qty=0 → "x1" (bukan "x0")', () => {
    const result: InterpreterResultV2 = {
      acts: [{ act_id: '1', intent: 'add_cart', entities: [], qty_source: 'default', confidence: 1, supersedes: null }],
      unmatched_mentions: [],
      topic_switch: false,
      draft_cart_ops: [{ action: 'add', product: 'Ayam', qty: 0, qty_source: 'default', status: 'confirmed' }],
      confidence: { entities: 1, intent: 1, selection: 1, topic: 1 },
    };
    const reply = composeReply({
      plannedActs: [{ act_id: '1', intent: 'add_cart', entities: [], qty_source: 'default', confidence: 1, supersedes: null }],
      reasoningResult: result,
      workspace: mockWorkspace,
      catalog: [],
      clarificationAttempt: 0,
    });
    assert.match(reply, /Ayam x1/);
    assert.ok(!reply.includes('x0'), 'tidak boleh ada x0 di reply');
  });

  // #5 FIX: reply_draft hanya spasi → fallback "Maaf kak..."
  it('P5.1 #5: reply_draft hanya spasi → fallback "Maaf kak..."', () => {
    const result: InterpreterResultV2 = {
      acts: [],
      unmatched_mentions: [],
      topic_switch: false,
      draft_cart_ops: [],
      confidence: { entities: 1, intent: 1, selection: 1, topic: 1 },
      reply_draft: '   ',
    };
    const reply = composeReply({
      plannedActs: [],
      reasoningResult: result,
      workspace: mockWorkspace,
      catalog: [],
      clarificationAttempt: 0,
    });
    assert.strictEqual(reply, 'Maaf kak, saya kurang paham.');
  });

  // #5 FIX: reply_draft undefined → fallback (existing test sudah ada, ini verifikasi tambahan)
  it('P5.1 #5: reply_draft undefined → fallback', () => {
    const result: InterpreterResultV2 = {
      acts: [],
      unmatched_mentions: [],
      topic_switch: false,
      draft_cart_ops: [],
      confidence: { entities: 1, intent: 1, selection: 1, topic: 1 },
      reply_draft: undefined,
    };
    const reply = composeReply({
      plannedActs: [],
      reasoningResult: result,
      workspace: mockWorkspace,
      catalog: [],
      clarificationAttempt: 0,
    });
    assert.strictEqual(reply, 'Maaf kak, saya kurang paham.');
  });
});
