/**
 * WIRE-V2ENGINE-QUICK-REPLY — Isolation Unit Test
 *
 * Memanggil deriveV2EngineQuickReply() langsung via prototype — tidak lewat
 * conversation.service.ts penuh. Mock canonicalConversationStateService.getV1PendingClarification
 * untuk kontrol sumber options DB state.
 *
 * BUKTI WAJIB:
 * - 11 fixture InterpreterResultV2 ASLI dari FEW_SHOTS → semua undefined (inert)
 * - V2EngineOutput needs_clarification=true + DB pending ada options → return {reason, question, options}
 * - V2EngineOutput needs_clarification=true + DB pending TIDAK ada options → undefined (JUNGKAL, bukan paksa)
 * - V2EngineOutput needs_clarification=false → undefined
 */
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { ConversationService } from '../../../business/conversation.service.js';
import { canonicalConversationStateService } from '../../../business/canonical-context.service.js';
import { FEW_SHOTS } from '../prompts-v2.js';
import type { PendingClarification, ClarificationOption } from '../../../domain/types.js';

/**
 * Helper: panggil private method deriveV2EngineQuickReply via prototype.
 */
async function callDerive(llmResult: unknown, storeId: string = 'store-test', conversationId: string = 'conv-test') {
  return (ConversationService.prototype as any).deriveV2EngineQuickReply(llmResult, storeId, conversationId);
}

/**
 * Stub canonicalConversationStateService.getV1PendingClarification —
 * ini adalah DB state source yang SAMA dipakai fetchClarificationOptions
 * di structured-message.mapper.ts:225.
 */
function stubGetV1PendingClarification(fn: (conversationId: string) => Promise<PendingClarification | null>) {
  const original = canonicalConversationStateService.getV1PendingClarification.bind(canonicalConversationStateService);
  canonicalConversationStateService.getV1PendingClarification = fn;
  return () => {
    canonicalConversationStateService.getV1PendingClarification = original;
  };
}

const MOCK_OPTIONS: ClarificationOption[] = [
  { id: '0', label: '100/90-17', cartOps: [] },
  { id: '1', label: '110/90-17', cartOps: [] },
];

function makePendingClarification(question: string, options: ClarificationOption[]): PendingClarification {
  return {
    id: 'pending-test',
    type: 'clarification',
    question,
    options,
    expected_type: 'choice',
    snapshot: {},
    asked_at: new Date().toISOString(),
    retry_count: 0,
  };
}

function makeV2EngineOutput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 'v1',
    intent: 'product_inquiry',
    confidence: 0.9,
    entities: [],
    proposed_actions: [],
    reply_text: 'reply',
    needs_clarification: false,
    uncertainty_signals: [],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1a: 11 real InterpreterResultV2 fixtures (FEW_SHOTS) → semua undefined
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveV2EngineQuickReply — 1a: real InterpreterResultV2 fixtures (FEW_SHOTS, 11 items) → INERT', () => {
  for (let i = 0; i < FEW_SHOTS.length; i++) {
    const fs = FEW_SHOTS[i];
    it(`FEW_SHOTS[${i}] "${fs.user_message}" → InterpreterResultV2, return undefined`, async () => {
      const parsed = JSON.parse(fs.expected_json);
      const result = await callDerive(parsed, 'store-test', 'conv-test');
      assert.strictEqual(
        result,
        undefined,
        `FEW_SHOTS[${i}] "${fs.user_message}": InterpreterResultV2 tidak boleh trigger quick_reply, dapat: ${JSON.stringify(result)}`
      );
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1b: V2EngineOutput needs_clarification=true + DB pending ada options
//          → return {reason: 'clarification_asked', question, options}
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveV2EngineQuickReply — 1b: V2EngineOutput needs_clarification + DB pending ada options', () => {
  let restore: (() => void) | null = null;

  afterEach(() => {
    if (restore) restore();
    restore = null;
  });

  it('needs_clarification=true + pending ada options → return reason + question + options', async () => {
    const pending = makePendingClarification('Mau ukuran berapa?', MOCK_OPTIONS);
    restore = stubGetV1PendingClarification(async () => pending);

    const v2Output = makeV2EngineOutput({
      intent: 'clarification',
      needs_clarification: true,
      clarification_question: 'Untuk ban dalam motor ukuran ring berapa Kak?',
      proposed_actions: [],
      reply_text: 'Untuk ban dalam motor ukuran ring berapa Kak?',
    });

    const result = await callDerive(v2Output, 'store-test', 'conv-1');

    assert.ok(result, 'harus return quick_reply data (bukan undefined)');
    assert.strictEqual(result!.reason, 'clarification_asked');
    assert.strictEqual(result!.question, 'Untuk ban dalam motor ukuran ring berapa Kak?');
    assert.deepStrictEqual(result!.options, MOCK_OPTIONS);
  });

  it('needs_clarification=true + clarification_question empty → fallback ke reply_text sebagai question', async () => {
    const pending = makePendingClarification('old question', MOCK_OPTIONS);
    restore = stubGetV1PendingClarification(async () => pending);

    const v2Output = makeV2EngineOutput({
      intent: 'clarification',
      needs_clarification: true,
      clarification_question: '', // empty
      reply_text: 'Boleh dibantu dipilih Kak, ukuran berapa?',
      proposed_actions: [],
    });

    const result = await callDerive(v2Output, 'store-test', 'conv-2');

    assert.ok(result);
    assert.strictEqual(result!.reason, 'clarification_asked');
    assert.strictEqual(result!.question, 'Boleh dibantu dipilih Kak, ukuran berapa?'); // fallback ke reply_text
    assert.deepStrictEqual(result!.options, MOCK_OPTIONS);
  });

  it('needs_clarification=true + clarification_question undefined → fallback ke reply_text', async () => {
    const pending = makePendingClarification('old question', MOCK_OPTIONS);
    restore = stubGetV1PendingClarification(async () => pending);

    const v2Output = makeV2EngineOutput({
      intent: 'clarification',
      needs_clarification: true,
      // clarification_question undefined
      reply_text: 'Mau pilih yang mana nih?',
      proposed_actions: [],
    });

    const result = await callDerive(v2Output, 'store-test', 'conv-3');

    assert.ok(result);
    assert.strictEqual(result!.question, 'Mau pilih yang mana nih?');
    assert.deepStrictEqual(result!.options, MOCK_OPTIONS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1c: V2EngineOutput needs_clarification=true TAPI tidak ada sumber options
//          aman → undefined (BUKAN text biasa, BUKAN quick_reply kosong)
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveV2EngineQuickReply — 1c: needs_clarification=true tapi tidak ada options di DB → undefined', () => {
  let restore: (() => void) | null = null;

  afterEach(() => {
    if (restore) restore();
    restore = null;
  });

  it('pending ada tapi options kosong → undefined', async () => {
    const pending = makePendingClarification('Mau ukuran berapa?', []); // options kosong
    restore = stubGetV1PendingClarification(async () => pending);

    const v2Output = makeV2EngineOutput({
      intent: 'clarification',
      needs_clarification: true,
      clarification_question: 'ukuran berapa?',
      proposed_actions: [],
      reply_text: 'ukuran berapa?',
    });

    const result = await callDerive(v2Output, 'store-test', 'conv-4');

    // HARUS undefined — tidak ada options aman, JANGAN paksa quick_reply
    assert.strictEqual(result, undefined);
  });

  it('getV1PendingClarification return null (tidak ada pending) → undefined', async () => {
    restore = stubGetV1PendingClarification(async () => null);

    const v2Output = makeV2EngineOutput({
      intent: 'clarification',
      needs_clarification: true,
      clarification_question: 'ukuran berapa?',
      proposed_actions: [],
      reply_text: 'ukuran berapa?',
    });

    const result = await callDerive(v2Output, 'store-test', 'conv-5');

    // HARUS undefined — source: DB state, tidak ada pending → tidak ada options
    assert.strictEqual(result, undefined);
  });

  it('pending ada tapi options undefined → undefined', async () => {
    const pending = makePendingClarification('old question', MOCK_OPTIONS);
    // override: options undefined
    (pending as any).options = undefined;
    restore = stubGetV1PendingClarification(async () => pending);

    const v2Output = makeV2EngineOutput({
      needs_clarification: true,
      clarification_question: 'ukuran berapa?',
      reply_text: 'ukuran berapa?',
    });

    const result = await callDerive(v2Output, 'store-test', 'conv-6');

    assert.strictEqual(result, undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1d: V2EngineOutput needs_clarification=false → undefined (semua kasus)
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveV2EngineQuickReply — 1d: needs_clarification=false → undefined', () => {
  it('needs_clarification=false + entity product + pending ada options → tetap undefined', async () => {
    const pending = makePendingClarification('old', MOCK_OPTIONS);
    const restore = stubGetV1PendingClarification(async () => pending);

    const v2Output = makeV2EngineOutput({
      intent: 'product_inquiry',
      needs_clarification: false,
      entities: [{ type: 'product', value: 'ban', confidence: 0.9 }],
      proposed_actions: [{ action_type: 'NONE', payload: {}, confidence: 0.8, requires_validation: false }],
    });

    const result = await callDerive(v2Output, 'store-test', 'conv-7');

    assert.strictEqual(result, undefined);
    restore();
  });

  it('needs_clarification tidak ada di V2EngineOutput → undefined', async () => {
    const pending = makePendingClarification('old', MOCK_OPTIONS);
    const restore = stubGetV1PendingClarification(async () => pending);

    const v2Output = makeV2EngineOutput({
      intent: 'add_to_cart',
      // needs_clarification: omitempty (undefined)
      proposed_actions: [{ action_type: 'ADD_TO_CART', payload: { product: 'ban', qty: 1 }, confidence: 0.9, requires_validation: true }],
    });

    const result = await callDerive(v2Output, 'store-test', 'conv-8');

    assert.strictEqual(result, undefined);
    restore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1e: InterpreterResultV2 punya field clarification tapi TIDAK punya
//          proposed_actions → tetap inert (duck-type check gagal)
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveV2EngineQuickReply — 1e: InterpreterResultV2 has clarification but NO proposed_actions → inert', () => {
  it('InterpreterResultV2 dengan clarification field → tetap undefined (duck-type block)', async () => {
    // Ini bentuk InterpreterResultV2 ASLI — punya clarification, tapi tidak punya proposed_actions
    const interpreterResult = {
      acts: [],
      unmatched_mentions: [],
      topic_switch: false,
      draft_cart_ops: [],
      confidence: { entities: 0.3, intent: 0.3, selection: 0.3, topic: 0.3 },
      clarification: { question: 'Mau pilih mana?', options: ['A', 'B', 'C'], expected_type: 'choice' as const },
      summary_update: 'test',
    };

    // Stub getV1PendingClarification untuk return pending dengan options
    const pending = makePendingClarification('Mau pilih mana?', [
      { id: '0', label: 'A', cartOps: [] },
      { id: '1', label: 'B', cartOps: [] },
      { id: '2', label: 'C', cartOps: [] },
    ]);
    const restore = stubGetV1PendingClarification(async () => pending);

    const result = await callDerive(interpreterResult, 'store-test', 'conv-9');

    // InterpreterResultV2 TIDAK punya proposed_actions → duck-type check gagal → undefined
    // Walaupun punya clarification + DB pending ada options — tetap inert
    assert.strictEqual(result, undefined);
    restore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1f: Edge cases — null, non-object, invalid types
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveV2EngineQuickReply — 1f: edge cases', () => {
  it('null → undefined', async () => {
    assert.strictEqual(await callDerive(null, 'store-test', 'conv'), undefined);
  });

  it('undefined → undefined', async () => {
    assert.strictEqual(await callDerive(undefined, 'store-test', 'conv'), undefined);
  });

  it('string → undefined', async () => {
    assert.strictEqual(await callDerive('hello', 'store-test', 'conv'), undefined);
  });

  it('number → undefined', async () => {
    assert.strictEqual(await callDerive(42, 'store-test', 'conv'), undefined);
  });

  it('objek tanpa proposed_actions → undefined', async () => {
    assert.strictEqual(await callDerive({ intent: 'clarification', needs_clarification: true }, 'store-test', 'conv'), undefined);
  });

  it('proposed_actions string (bukan array) → undefined', async () => {
    const v2Output = makeV2EngineOutput({
      needs_clarification: true,
      proposed_actions: 'bukan array',
    });
    assert.strictEqual(await callDerive(v2Output, 'store-test', 'conv'), undefined);
  });
});
