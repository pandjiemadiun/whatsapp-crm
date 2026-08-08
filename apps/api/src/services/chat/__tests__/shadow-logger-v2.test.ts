/**
 * Unit test — Shadow Logger (FASE C1 / sub-fase 1/4)
 * Runner: node:test via tsx.
 *   npx tsx --env-file=../../.env --test --test-force-exit \
 *     src/services/chat/__tests__/shadow-logger-v2.test.ts
 *
 * I8: semua test di bawah adalah 0-LLM — adapters.logger.info DI-MOCK.
 *      Tidak ada panggilan logger asli, LLM, atau DB.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { adapters } from '../../../adapters/container.js';
import { ResponseSource } from '../../../domain/types.js';
import type { ActV2, InterpreterResultV2, ShadowOutcome } from '../types-v2.js';
import { ENGINE_VERSION } from '../constants-v2.js';
import { SCHEMA_VERSION } from '../decisionTrace.js';
import {
  logShadowEntry,
  computeMismatch,
  buildShadowEntry,
  type BuildShadowEntryParams,
} from '../shadow-logger.js';
import type { ShadowEntry } from '../shadow-types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Factory helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeAct(overrides: Partial<ActV2> = {}): ActV2 {
  return {
    act_id: 'a1',
    intent: 'cart_update',
    entities: [{ type: 'product', value: 'Beras', confidence: 0.9 }],
    qty: 1,
    qty_source: 'explicit',
    confidence: 0.9,
    supersedes: null,
    ...overrides,
  };
}

function makeResult(
  overrides: Partial<InterpreterResultV2> = {}
): InterpreterResultV2 {
  return {
    acts: [makeAct()],
    unmatched_mentions: [],
    topic_switch: false,
    draft_cart_ops: [],
    confidence: {
      entities: 0.9,
      intent: 0.9,
      selection: 0.95,
      topic: 0.9,
    },
    summary_update: 'Added Beras to cart',
    reply_draft: 'Membuatkan Beras ke keranjang.',
    ...overrides,
  };
}

function makeParams(
  overrides: Partial<BuildShadowEntryParams> = {}
): BuildShadowEntryParams {
  return {
    conversationId: 'conv-1',
    messageId: 'msg-1',
    storeId: 'store-1',
    oldSource: ResponseSource.AI,
    oldReply: 'Membuatkan Beras ke keranjang.',
    oldEntities: [{ type: 'product', value: 'Beras', confidence: 0.9 }],
    newOutcome: 'reasoned',
    reasoningResult: makeResult(),
    plannedActs: [makeAct()],
    validatorReasons: [],
    validatorRetryable: false,
    llmCalls: 1,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Logger mock — stub singleton adapters.logger.info
// ─────────────────────────────────────────────────────────────────────────────

let logCalls: Array<{ msg: string; meta: unknown }>;
const originalInfo = adapters.logger.info;

before(() => {
  adapters.logger.info = ((msg: string, meta?: unknown) => {
    logCalls.push({ msg, meta });
  }) as typeof adapters.logger.info;
});

after(() => {
  adapters.logger.info = originalInfo;
});

beforeEach(() => {
  logCalls = [];
});

// ─────────────────────────────────────────────────────────────────────────────
// A. logShadowEntry
// ─────────────────────────────────────────────────────────────────────────────

describe('logShadowEntry', () => {
  it('menghasilkan log info dengan field lengkap + stamp version', () => {
    const entry = buildShadowEntry(makeParams());
    logShadowEntry(entry);

    assert.equal(logCalls.length, 1);
    assert.equal(logCalls[0].msg, 'Shadow compare');
    const meta = logCalls[0].meta as Record<string, unknown>;
    // WAJIB stamp engine_version + schema_version
    assert.equal(meta.engine_version, ENGINE_VERSION);
    assert.equal(meta.schema_version, SCHEMA_VERSION);
    assert.equal((meta as unknown as ShadowEntry).conversation_id, 'conv-1');
    assert.equal((meta as unknown as ShadowEntry).message_id, 'msg-1');
    assert.equal((meta as unknown as ShadowEntry).store_id, 'store-1');
    assert.ok((meta as unknown as ShadowEntry).old !== undefined);
    assert.ok((meta as unknown as ShadowEntry).new !== undefined);
    assert.ok((meta as unknown as ShadowEntry).mismatch !== undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. computeMismatch — reply
// ─────────────────────────────────────────────────────────────────────────────

describe('computeMismatch — reply', () => {
  it('reply sama (case-insensitive) → replyDiffers=false', () => {
    const result = computeMismatch(
      { reply: 'Hello World', entities: [] },
      { reply_draft: 'hello world', entities: [] }
    );
    assert.equal(result.replyDiffers, false);
  });

  it('reply beda → replyDiffers=true', () => {
    const result = computeMismatch(
      { reply: 'Hello World', entities: [] },
      { reply_draft: 'Goodbye World', entities: [] }
    );
    assert.equal(result.replyDiffers, true);
  });

  it('reply_draft null → diperlakukan sebagai string kosong', () => {
    const result = computeMismatch(
      { reply: '', entities: [] },
      { reply_draft: null, entities: [] }
    );
    assert.equal(result.replyDiffers, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. computeMismatch — entity set
// ─────────────────────────────────────────────────────────────────────────────

describe('computeMismatch — entity set', () => {
  it('entity set sama → entitySetDiffers=false', () => {
    const oldEntities = [
      { type: 'product', value: 'Beras' },
      { type: 'product', value: 'Gula' },
    ];
    const newEntities = [
      { type: 'product', value: 'Gula' },
      { type: 'product', value: 'beras' }, // sama, urutan + case beda
    ];
    const result = computeMismatch(
      { reply: 'same', entities: oldEntities },
      { reply_draft: 'same', entities: newEntities }
    );
    assert.equal(result.entitySetDiffers, false);
    assert.equal(result.oldEntityCount, 2);
    assert.equal(result.newEntityCount, 2);
  });

  it('entity set beda → entitySetDiffers=true', () => {
    const oldEntities = [
      { type: 'product', value: 'Beras' },
      { type: 'product', value: 'Gula' },
    ];
    const newEntities = [
      { type: 'product', value: 'Beras' },
      { type: 'product', value: 'Kentang' }, // beda
    ];
    const result = computeMismatch(
      { reply: 'same', entities: oldEntities },
      { reply_draft: 'same', entities: newEntities }
    );
    assert.equal(result.entitySetDiffers, true);
    assert.equal(result.oldEntityCount, 2);
    assert.equal(result.newEntityCount, 2);
  });

  it('hanya menghitung entitas product (bukan entity lain)', () => {
    const result = computeMismatch(
      {
        reply: 'same',
        entities: [
          { type: 'product', value: 'Beras' },
          { type: 'quantity', value: '1' },
          { type: 'intent', value: 'buy' },
        ],
      },
      {
        reply_draft: 'same',
        entities: [
          { type: 'product', value: 'Beras' },
          { type: 'quantity', value: '2' },
        ],
      }
    );
    assert.equal(result.entitySetDiffers, false);
    assert.equal(result.oldEntityCount, 1);
    assert.equal(result.newEntityCount, 1);
  });

  it('entitas baru kosong → entitySetDiffers=true, newEntityCount=0', () => {
    const result = computeMismatch(
      { reply: 'same', entities: [{ type: 'product', value: 'Beras' }] },
      { reply_draft: 'same', entities: [] }
    );
    assert.equal(result.entitySetDiffers, true);
    assert.equal(result.newEntityCount, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. buildShadowEntry
// ─────────────────────────────────────────────────────────────────────────────

describe('buildShadowEntry', () => {
  it('menyusun struktur lengkap', () => {
    const params = makeParams();
    const entry = buildShadowEntry(params);

    // Top-level fields
    assert.equal(entry.conversation_id, 'conv-1');
    assert.equal(entry.message_id, 'msg-1');
    assert.equal(entry.store_id, 'store-1');
    assert.equal(entry.engine_version, ENGINE_VERSION);
    assert.equal(entry.schema_version, SCHEMA_VERSION);
    assert.ok(typeof entry.timestamp === 'number');

    // Old
    assert.equal(entry.old.source, ResponseSource.AI);
    assert.equal(entry.old.reply, 'Membuatkan Beras ke keranjang.');
    assert.deepEqual(entry.old.entities, params.oldEntities);

    // New
    assert.equal(entry.new.outcome, 'reasoned');
    assert.equal(entry.new.reply_draft, 'Membuatkan Beras ke keranjang.');
    assert.equal(entry.new.intents.length, 1);
    assert.equal(entry.new.intents[0].intent, 'cart_update');
    assert.deepEqual(
      entry.new.intents[0].entities,
      params.reasoningResult.acts![0].entities
    );
    assert.equal(entry.new.unmatched.length, 0);
    assert.equal(entry.new.plannedActs.length, 1);
    assert.equal(entry.new.validatorReasons.length, 0);
    assert.equal(entry.new.validatorRetryable, false);
    assert.equal(entry.new.llmCalls, 1);

    // Mismatch
    assert.ok(entry.mismatch !== undefined);
    assert.equal(typeof entry.mismatch.replyDiffers, 'boolean');
    assert.equal(typeof entry.mismatch.entitySetDiffers, 'boolean');
  });

  it('handle reply_draft undefined → new.reply_draft = null', () => {
    const entry = buildShadowEntry(
      makeParams({
        reasoningResult: makeResult({ reply_draft: undefined }),
        newOutcome: 'fallback_reasoning_failed' as ShadowOutcome,
      })
    );
    assert.equal(entry.new.reply_draft, null);
  });

  it('handle unmatched_mentions tidak kosong', () => {
    const entry = buildShadowEntry(
      makeParams({
        reasoningResult: makeResult({
          unmatched_mentions: ['Apel', 'Mangga'],
        }),
      })
    );
    assert.deepEqual(entry.new.unmatched, ['Apel', 'Mangga']);
  });

  it('gabung entities dari semua act → new.entities', () => {
    const entry = buildShadowEntry(
      makeParams({
        reasoningResult: makeResult({
          acts: [
            makeAct({
              act_id: 'a1',
              entities: [{ type: 'product', value: 'Beras', confidence: 0.9 }],
            }),
            makeAct({
              act_id: 'a2',
              entities: [{ type: 'product', value: 'Gula', confidence: 0.9 }],
            }),
          ],
        }),
      })
    );
    assert.equal(entry.new.entities.length, 2);
    assert.equal(entry.new.intents.length, 2);
  });

  it('mismatch dihitung dari oldEntities vs newEntities', () => {
    const entry = buildShadowEntry(
      makeParams({
        oldReply: 'Membuatkan Beras ke keranjang.',
        oldEntities: [{ type: 'product', value: 'Beras', confidence: 0.9 }],
        reasoningResult: makeResult({
          reply_draft: 'Saya tambahkan Gula ke keranjang.',
          acts: [
            makeAct({
              entities: [{ type: 'product', value: 'Gula', confidence: 0.9 }],
            }),
          ],
        }),
      })
    );
    assert.equal(entry.mismatch.replyDiffers, true);
    assert.equal(entry.mismatch.entitySetDiffers, true);
    assert.equal(entry.mismatch.oldEntityCount, 1);
    assert.equal(entry.mismatch.newEntityCount, 1);
  });
});
