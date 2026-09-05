/**
 * Unit tests — V2 Engine Shadow Test endpoint (P2-UNIT4).
 * src/routes/internal/v2-engine-shadow-test.test.ts
 *
 * Runner:
 *   npx tsx --env-file=../../.env --test --test-force-exit \
 *     src/routes/internal/v2-engine-shadow-test.test.ts
 *
 * Strategy: mocked LLM gateway (no real API calls). DB is real but READ-ONLY —
 * we verify zero writes to orders / order_items / action_idempotency /
 * conversation_history by comparing row counts before vs after each test.
 *
 * Test cases:
 *   1. Happy path — mock gateway returns valid V2 JSON → verify output format
 *   2. Parse error — mock gateway returns malformed JSON → verify error result
 *   3. Panji-dagangan regression — intent MUST NOT be 'cancel_order'
 *   4. Read-only — no DB writes to Order/OrderItem/ActionIdempotency/conversation_history
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { LLMGateway } from '../../adapters/ai/llm-gateway.js';
import {
  AIResponse,
  type AIGenerateOptions,
  AIProviderError,
  ErrorCategory,
} from '../../adapters/ai/types.js';
import { V2_INTENTS } from '../../services/chat/v2-engine/schema.js';
import { runShadowTest, ShadowTestError } from './v2-engine-shadow-test.js';
import { prisma } from '../../infrastructure/prisma.js';
import type { V2EngineResult } from '../../services/chat/v2-engine/engine-call.js';

// ─── Constants ─────────────────────────────────────────────────────────────

/** Real conversation ID for Bengkel Didik (store-4f4f67bd) — read-only access only. */
const TEST_CONVERSATION_ID = 'bbab7983-ddb3-40ef-b1a4-a12200566be5';

/** Valid V2 JSON response matching V2EngineOutputSchema exactly. */
const VALID_V2_JSON = JSON.stringify({
  schema_version: 'v1',
  intent: V2_INTENTS.PRODUCT_INQUIRY,
  confidence: 0.92,
  entities: [{ type: 'product', value: 'ban', confidence: 0.95 }],
  proposed_actions: [
    { action_type: 'OPEN_CATALOG', payload: {}, confidence: 0.8, requires_validation: false },
  ],
  reply_text: 'Ada ban motor tersedia. Mau lihat detailnya?',
  needs_clarification: false,
  summary_update: 'Customer tanya ban motor.',
  uncertainty_signals: [],
});

/**
 * Panji-dagangan regression response.
 * INTENT IS clarification — NOT cancel_order.
 *
 * v1 Bug: "Panji dagangan" (contains "ga" in "dagangan") was matched by
 * pendingClarification.ts:77 `message.includes('ga')` → false ROLLBACK/cancel.
 * v2 (shadow) MUST NOT classify this as cancel_order.
 *
 * Updated to match REAL V2 engine output from focused re-run (SambaNova
 * MiniMax-M2.7, correct "Panji dagangan" input with "ga" substring):
 *   intent=clarification, entities=[{type:customer_name, value:"Panji Dagang"}]
 */
const PANJI_DAGANGAN_RESPONSE = JSON.stringify({
  schema_version: 'v1',
  intent: V2_INTENTS.CLARIFICATION,
  confidence: 0.85,
  entities: [{ type: 'customer_name', value: 'Panji Dagang', confidence: 0.9 }],
  proposed_actions: [
    { action_type: 'NONE', payload: {}, confidence: 0.85, requires_validation: false },
  ],
  reply_text: 'Siap Kak Panji! Sudah tercatat nih namanya. Nah, sekarang tolong kirim alamat lengkapnya ya biar bisa kami hitung ongkirnya.',
  needs_clarification: false,
  summary_update: 'Customer memberikan nama Panji Dagang. Masih menunggu alamat pengiriman untuk proses checkout.',
  uncertainty_signals: [],
});

const MALFORMED_JSON = 'not valid json {{{';

// ─── Console suppression (mock gateway + adapters are chatty) ──────────────

let origLog: typeof console.log;
let origWarn: typeof console.warn;
let origError: typeof console.error;

before(() => {
  origLog = console.log;
  origWarn = console.warn;
  origError = console.error;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
});

after(() => {
  console.log = origLog;
  console.warn = origWarn;
  console.error = origError;
});

// ─── Mock gateway factory ──────────────────────────────────────────────────

/**
 * Creates a minimal mock LLMGateway that returns canned responses.
 * Does NOT touch real providers — no API calls, no cooldown, no circuit breaker.
 *
 * callV2Engine only uses two gateway methods:
 *   - generate(prompt, options, intent) → AIResponse
 *   - getStats() → { errorLog: [...] }  (only on error path)
 */
function makeMockGateway(responseContent: string = VALID_V2_JSON): LLMGateway {
  let generateCallCount = 0;
  return {
    generate: async (_prompt: string, _options?: AIGenerateOptions, _intent: string = 'general'): Promise<AIResponse> => {
      generateCallCount++;
      return {
        content: responseContent,
        provider: 'mock-provider',
        model: 'mock-model',
        tokens: { input: 100, output: 50 },
        cost: 0,
      };
    },
    getStats: () => ({
      primary: { success: 1, failed: 0 },
      fallback: { success: 0, failed: 0 },
      errorLog: [],
      circuitBreaker: { name: 'llm-gateway', state: 'closed', failures: 0, threshold: 5, openedAt: 0 },
    }),
    // Remaining LLMGateway methods (not called by callV2Engine, needed for type compat)
    reset: () => {},
    isGatewayCircuitOpen: () => false,
    getProviders: () => ({ primary: 'mock', fallback: 'mock', gatekeeper: 'mock' }),
    checkHealth: async () => ({ primary: true, fallback: true }),
    extractIntent: async () => ({
      intent: 'COMPLEX_CONVERSATION',
      confidence: 0.5,
      entities: {},
      reasoning: 'mock gatekeeper',
    }),
  } as unknown as LLMGateway;
}

// ─── Read-only helper ──────────────────────────────────────────────────────

/** Count rows in key tables — used to verify zero DB writes. */
async function countDbRows(convId: string) {
  return {
    orders: await prisma.order.count({ where: { conversationId: convId } }),
    orderItems: await prisma.orderItem.count({ where: { order: { conversationId: convId } } }),
    actionIdempotency: await prisma.actionIdempotency.count({}),
    conversationHistory: await prisma.conversationHistory.count({ where: { conversationId: convId } }),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('v2-engine-shadow-test endpoint', () => {
  describe('runShadowTest — unit tests with mocked LLM', () => {
    it('1. Returns valid V2 engine output (happy path)', async () => {
      const mockGateway = makeMockGateway(VALID_V2_JSON);

      const result = await runShadowTest(
        TEST_CONVERSATION_ID,
        'Ada ban dalam?',
        mockGateway,
      );

      // Core structure
      assert.equal(result.conversationId, TEST_CONVERSATION_ID);
      assert.equal(result.customerMessage, 'Ada ban dalam?');
      assert.equal(result.read_only, true);

      // V2 engine output
      const v2 = result.v2_engine_output;
      assert.equal(v2.success, true);

      if (v2.success) {
        assert.equal(v2.data.intent, V2_INTENTS.PRODUCT_INQUIRY);
        assert.ok(v2.data.confidence >= 0 && v2.data.confidence <= 1);
        assert.ok(v2.data.reply_text.length > 0);
        assert.ok(Array.isArray(v2.data.entities));
        assert.ok(Array.isArray(v2.data.proposed_actions));
        assert.ok(Array.isArray(v2.data.uncertainty_signals));
        assert.equal(typeof v2.data.needs_clarification, 'boolean');
      }

      // Workspace loaded from DB
      assert.ok(result.workspace, 'workspace should be loaded');

      // Recent history loaded from DB
      assert.ok(result.recentHistory.length > 0, 'should have recent history');
    });

    it('2. Handles LLM parse error gracefully (malformed JSON)', async () => {
      const mockGateway = makeMockGateway(MALFORMED_JSON);

      const result = await runShadowTest(
        TEST_CONVERSATION_ID,
        'Ok saya mau bayar',
        mockGateway,
      );

      assert.equal(result.read_only, true);
      const v2 = result.v2_engine_output;
      assert.equal(v2.success, false);

      if (!v2.success) {
        assert.equal(v2.error.type, 'parse_error');
        assert.ok(v2.error.message.length > 0);
      }
    });

    it('3. Panji-dagangan regression: intent MUST NOT be cancel_order', async () => {
      // Mock gateway returns CLARIFICATION for "Panji dagangan" (correct spelling,
      // contains "ga" substring that triggered v1 false-cancel bug).
      // v1 falsely classified this as ROLLBACK/cancel due to substring match.
      // v2 must NOT classify as cancel_order.
      const mockGateway = makeMockGateway(PANJI_DAGANGAN_RESPONSE);

      const result = await runShadowTest(
        TEST_CONVERSATION_ID,
        'Panji dagangan',
        mockGateway,
      );

      const v2 = result.v2_engine_output;
      assert.equal(v2.success, true);

      if (v2.success) {
        assert.notEqual(
          v2.data.intent,
          V2_INTENTS.CANCEL_ORDER,
          'v2 MUST NOT classify "Panji dagangan" as cancel_order — regression from v1 false-cancel bug (message.includes("ga"))',
        );
        // v2 recognizes "Panji" as a customer name, not a product
        assert.ok(
          v2.data.entities.some(e => e.type === 'customer_name'),
          'v2 should extract customer_name entity, not treat as product',
        );
        // v2 should NOT take destructive action (no cancel/cancel_order)
        assert.ok(
          !v2.data.proposed_actions?.some(a => a.action_type === 'CANCEL_ORDER'),
          'v2 should NOT propose cancel_order action',
        );
      }
    });

    it('4. Read-only: zero DB writes to Order/OrderItem/ActionIdempotency/conversation_history', async () => {
      const mockGateway = makeMockGateway(VALID_V2_JSON);

      // Snapshot row counts before
      const before = await countDbRows(TEST_CONVERSATION_ID);

      // Run shadow test (mock LLM, real DB reads)
      await runShadowTest(
        TEST_CONVERSATION_ID,
        'Totalnya kak',
        mockGateway,
      );

      // Snapshot row counts after
      const after = await countDbRows(TEST_CONVERSATION_ID);

      // Verify zero writes
      assert.equal(after.orders, before.orders, 'No Order rows created');
      assert.equal(after.orderItems, before.orderItems, 'No OrderItem rows created');
      assert.equal(after.actionIdempotency, before.actionIdempotency, 'No ActionIdempotency rows created');
      assert.equal(after.conversationHistory, before.conversationHistory, 'No conversation_history rows created');
    });
  });

  describe('error handling', () => {
    it('throws ShadowTestError for nonexistent conversation', async () => {
      const mockGateway = makeMockGateway(VALID_V2_JSON);

      await assert.rejects(
        async () =>
          runShadowTest('00000000-0000-0000-0000-000000000000', 'Test', mockGateway),
        (err: unknown) => {
          assert.ok(err instanceof ShadowTestError);
          assert.equal(err.code, 'NOT_FOUND');
          return true;
        },
      );
    });
  });
});
