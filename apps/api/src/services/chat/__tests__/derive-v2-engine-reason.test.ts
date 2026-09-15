/**
 * VERIFY-DERIVE-REASON-ISOLATION
 *
 * Unit test langsung untuk deriveV2EngineReason() — private method di
 * ConversationService. Dipanggil via prototype (bukan instantiate) untuk
 * hindari side-effect DI Prisma/adapters.
 *
 * Runner: npx tsx --test --test-force-exit src/services/chat/__tests__/derive-v2-engine-reason.test.ts
 * Jest:  npx node --experimental-vm-modules ./node_modules/.bin/jest --config jest.config.cjs --forceExit
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Import ConversationService — method deriveV2EngineReason adalah pure func
// (tidak memakai `this`), jadi bisa dipanggil via prototype tanpa instantiate.
import { ConversationService } from '../../../business/conversation.service.js';

// FEW_SHOTS dari prompts-v2.ts = DATA ASLI format InterpreterResultV2 yang
// pernah keluar dari reasoning.ts (JSON.parse(resp.content) di reasoning.ts:139).
import { FEW_SHOTS } from '../prompts-v2.js';

// Type imports for V2EngineOutput construction
import type { V2EngineOutput, V2Intent, V2ProposedAction, V2Entity, V2UncertaintySignal } from '../v2-engine/schema.js';

/**
 * Helper: akses private method deriveV2EngineReason via prototype cast.
 */
function callDeriveV2EngineReason(llmResult: unknown): string | undefined {
  return (ConversationService.prototype as any).deriveV2EngineReason(llmResult);
}

/**
 * Build a minimal, well-formed V2EngineOutput for test cases b & c.
 */
function makeV2EngineOutput(
  intent: V2Intent,
  proposed_actions: V2ProposedAction[],
  reply_text: string = 'test',
  needs_clarification: boolean = false,
): V2EngineOutput {
  return {
    schema_version: 'v1',
    intent,
    confidence: 0.9,
    entities: [],
    proposed_actions,
    reply_text,
    needs_clarification,
    uncertainty_signals: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1a: Real InterpreterResultV2 fixtures (dari FEW_SHOTS) → MUST be undefined
// ─────────────────────────────────────────────────────────────────────────────
// FEW_SHOTS berisi 11 `expected_json` string yang PASTI pernah keluar dari
// reasoning.ts (reasoning.ts:139: `JSON.parse(resp.content) as InterpreterResultV2`).
// Kita parse semua 11 dan verifikasi TIDAK ADA satu pun yang trigger deriveV2EngineReason
// — bukti bahwa method ini TIDAK akan mengganggu jalur lama reasoning.ts.
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveV2EngineReason — 1a: real InterpreterResultV2 fixtures (FEW_SHOTS)', () => {
  for (let i = 0; i < FEW_SHOTS.length; i++) {
    const fs = FEW_SHOTS[i];
    it(`FEW_SHOTS[${i}] "${fs.user_message}" → tidak boleh trigger reason (InterpreterResultV2, bukan V2EngineOutput)`, () => {
      // Parse expected_json sebagai InterpreterResultV2 — ini DATA ASLI
      // format yang pernah keluar dari reasoning.ts.
      const parsed = JSON.parse(fs.expected_json);

      const reason = callDeriveV2EngineReason(parsed);

      // InterpreterResultV2 punya fieldnya sendiri (acts, unmatched_mentions,
      // draft_cart_ops, confidence) — TIDAK punya proposed_actions/intent
      // sebagai V2EngineOutput. Jadi deriveV2EngineReason MUST return undefined.
      assert.strictEqual(
        reason,
        undefined,
        `FEW_SHOTS[${i}] "${fs.user_message}": InterpreterResultV2 tidak boleh trigger reason, dapat: ${reason}`
      );
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1b: V2EngineOutput with proposed_actions berisi ADD_TO_CART → 'modify_cart'
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveV2EngineReason — 1b: V2EngineOutput + ADD_TO_CART → modify_cart', () => {
  it('single ADD_TO_CART → modify_cart', () => {
    const output = makeV2EngineOutput('add_to_cart', [
      { action_type: 'ADD_TO_CART', payload: { product: 'ban', variant: '100/90-17', qty: 1 }, confidence: 0.95, requires_validation: true },
    ]);

    const reason = callDeriveV2EngineReason(output);

    assert.strictEqual(reason, 'modify_cart');
  });

  it('REMOVE_FROM_CART → modify_cart', () => {
    const output = makeV2EngineOutput('modify_cart', [
      { action_type: 'REMOVE_FROM_CART', payload: { product: 'kentang' }, confidence: 0.9, requires_validation: false },
    ]);

    const reason = callDeriveV2EngineReason(output);

    assert.strictEqual(reason, 'modify_cart');
  });

  it('UPDATE_CART_QUANTITY → modify_cart', () => {
    const output = makeV2EngineOutput('modify_cart', [
      { action_type: 'UPDATE_CART_QUANTITY', payload: { product: 'teh', qty: 2 }, confidence: 0.9, requires_validation: false },
    ]);

    const reason = callDeriveV2EngineReason(output);

    assert.strictEqual(reason, 'modify_cart');
  });

  it('campuran ADD_TO_CART + OPEN_CART → tetap modify_cart (ada mutation)', () => {
    const output = makeV2EngineOutput('add_to_cart', [
      { action_type: 'ADD_TO_CART', payload: { product: 'es teh', qty: 1 }, confidence: 0.95, requires_validation: true },
      { action_type: 'OPEN_CART', payload: {}, confidence: 0.8, requires_validation: false },
    ]);

    const reason = callDeriveV2EngineReason(output);

    assert.strictEqual(reason, 'modify_cart');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1b-extra: OPEN_CART (read-only) → 'view_cart'
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveV2EngineReason — 1b-extra: OPEN_CART → view_cart', () => {
  it('single OPEN_CART → view_cart', () => {
    const output = makeV2EngineOutput('view_cart' as V2Intent, [
      { action_type: 'OPEN_CART', payload: {}, confidence: 0.92, requires_validation: false },
    ]);

    const reason = callDeriveV2EngineReason(output);

    assert.strictEqual(reason, 'view_cart');
  });

  it('OPEN_CART + CONTACT_ADMIN → view_cart (escalation takes precedence in caller, not here)', () => {
    const output = makeV2EngineOutput('view_cart' as V2Intent, [
      { action_type: 'OPEN_CART', payload: {}, confidence: 0.92, requires_validation: false },
      { action_type: 'CONTACT_ADMIN', payload: {}, confidence: 0.85, requires_validation: false },
    ]);

    const reason = callDeriveV2EngineReason(output);

    // No mutation, no escalation intent — OPEN_CART wins
    assert.strictEqual(reason, 'view_cart');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1c: V2EngineOutput intent='escalation', no mutation → 'escalation_clarification_retry_exceeded'
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveV2EngineReason — 1c: V2EngineOutput intent=escalation (no mutation) → escalation_clarification_retry_exceeded', () => {
  it('escalation + empty proposed_actions → escalation_clarification_retry_exceeded', () => {
    const output = makeV2EngineOutput('escalation', [], 'Saya butuh bantuan admin.', false);

    const reason = callDeriveV2EngineReason(output);

    assert.strictEqual(reason, 'escalation_clarification_retry_exceeded');
  });

  it('escalation + only non-mutation actions (CONTACT_ADMIN) → escalation_clarification_retry_exceeded', () => {
    const output = makeV2EngineOutput('escalation', [
      { action_type: 'CONTACT_ADMIN', payload: {}, confidence: 0.8, requires_validation: false },
      { action_type: 'NONE', payload: {}, confidence: 0.9, requires_validation: false },
    ]);

    const reason = callDeriveV2EngineReason(output);

    assert.strictEqual(reason, 'escalation_clarification_retry_exceeded');
  });

  it('escalation + ADD_TO_CART (mutation present) → escalation WINS over modify_cart', () => {
    const output = makeV2EngineOutput('escalation', [
      { action_type: 'ADD_TO_CART', payload: { product: 'test', qty: 1 }, confidence: 0.7, requires_validation: true },
      { action_type: 'CONTACT_ADMIN', payload: {}, confidence: 0.8, requires_validation: false },
    ]);

    const reason = callDeriveV2EngineReason(output);

    // escalation + mutation together → escalation wins (handoff, not cart)
    assert.strictEqual(reason, 'escalation_clarification_retry_exceeded');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1d: Negative cases — V2EngineOutput without mutation atau escalation → undefined
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveV2EngineReason — 1d: V2EngineOutput non-mutation, non-escalation → undefined', () => {
  it('product_inquiry + SHOW_RELATED_PRODUCTS → undefined', () => {
    const output = makeV2EngineOutput('product_inquiry', [
      { action_type: 'SHOW_RELATED_PRODUCTS', payload: { product: 'ban' }, confidence: 0.85, requires_validation: false },
    ]);

    const reason = callDeriveV2EngineReason(output);

    assert.strictEqual(reason, undefined);
  });

  it('done_ordering + OPEN_CART → view_cart (BAGIAN 2 fix: OPEN_CART is read-only cart view)', () => {
    const output = makeV2EngineOutput('done_ordering', [
      { action_type: 'OPEN_CART', payload: {}, confidence: 0.9, requires_validation: false },
    ]);

    const reason = callDeriveV2EngineReason(output);

    assert.strictEqual(reason, 'view_cart');
  });

  it('smalltalk + NONE → undefined', () => {
    const output = makeV2EngineOutput('smalltalk', [
      { action_type: 'NONE', payload: {}, confidence: 0.8, requires_validation: false },
    ]);

    const reason = callDeriveV2EngineReason(output);

    assert.strictEqual(reason, undefined);
  });

  it('null/undefined input → undefined', () => {
    assert.strictEqual(callDeriveV2EngineReason(null), undefined);
    assert.strictEqual(callDeriveV2EngineReason(undefined), undefined);
  });

  it('string / number input → undefined', () => {
    assert.strictEqual(callDeriveV2EngineReason('hello'), undefined);
    assert.strictEqual(callDeriveV2EngineReason(42), undefined);
  });
});
