/**
 * Unit tests — callV2Engine (P2-UNIT3).
 *
 * Runner:
 *   npx tsx --env-file=../../.env --test --test-force-exit \
 *     src/services/chat/v2-engine/engine-call.test.ts
 *
 * Tests: mocked LLM provider via real LLMGateway with injected mock
 * providers (verifies provider rotation / cooldown / retry reuse).
 * Does NOT call any real API.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { LLMGateway } from '../../../adapters/ai/llm-gateway.js';
import { AIProviderResolverService } from '../../../services/ai-provider-resolver.service.js';
import {
  AIProvider,
  AIProviderError,
  ErrorCategory,
  type AIResponse,
  type AIGenerateOptions,
  type ExtractedIntent,
} from '../../../adapters/ai/types.js';
import { V2_INTENTS } from './schema.js';
import { callV2Engine } from './engine-call.js';

// ─────────────────────────────────────────────────────────────────────────────
// Valid V2 JSON payload (matches V2EngineOutputSchema exactly)
// ─────────────────────────────────────────────────────────────────────────────

const VALID_V2_JSON = JSON.stringify({
  schema_version: 'v1',
  intent: V2_INTENTS.PRODUCT_INQUIRY,
  confidence: 0.92,
  entities: [{ type: 'product', value: 'ban', confidence: 0.95 }],
  proposed_actions: [
    {
      action_type: 'OPEN_CATALOG',
      payload: {},
      confidence: 0.8,
      requires_validation: false,
    },
  ],
  reply_text: 'Ada ban depan dan ban belakang tersedia. Mau lihat detailnya?',
  needs_clarification: false,
  summary_update: 'Customer tanya ban motor.',
  uncertainty_signals: [],
});

// ─────────────────────────────────────────────────────────────────────────────
// Console suppression (gateway + adapters are very chatty)
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Mock provider factory
// ─────────────────────────────────────────────────────────────────────────────

interface MockProvider extends AIProvider {
  callCount: number;
  lastOptions?: AIGenerateOptions;
  calls: AIGenerateOptions[];
}

/**
 * Creates a mock AIProvider with configurable behavior.
 *
 * - 'success': returns `responseContent` (or VALID_V2_JSON by default)
 * - 'fail': throws AIProviderError (SERVER_ERROR)
 * - 'malformed': returns invalid JSON string
 * - 'missing-field': returns valid JSON but missing required schema fields
 */
function makeMockProvider(
  name: string,
  behavior: 'success' | 'fail' | 'malformed' | 'missing-field',
  responseContent?: string,
): MockProvider {
  const calls: AIGenerateOptions[] = [];
  const provider = {
    callCount: 0,
    lastOptions: undefined as AIGenerateOptions | undefined,
    calls,
    getName: () => name,
    getModel: () => `${name}-model`,
    generate: async (_prompt: string, options?: AIGenerateOptions): Promise<AIResponse> => {
      provider.callCount++;
      provider.lastOptions = options;
      calls.push(options || {});

      if (behavior === 'fail') {
        throw new AIProviderError(
          `${name} server error`,
          ErrorCategory.SERVER_ERROR,
          name,
          500,
          true,
        );
      }

      let content: string;
      if (responseContent !== undefined) {
        content = responseContent;
      } else if (behavior === 'malformed') {
        content = 'not valid json {{{';
      } else if (behavior === 'missing-field') {
        content = JSON.stringify({ intent: 'product_inquiry' });
      } else {
        content = VALID_V2_JSON;
      }

      return {
        content,
        provider: name,
        model: `${name}-model`,
        tokens: { input: 10, output: 10 },
        cost: 0.001,
      };
    },
  } as unknown as MockProvider;
  return provider;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock gatekeeper (required by LLMGateway constructor, never called by
// callV2Engine since it only invokes gateway.generate())
// ─────────────────────────────────────────────────────────────────────────────

const mockGatekeeper = {
  getName: () => 'mock-gatekeeper',
  getModel: () => 'mock-gatekeeper-model',
  generate: async () => ({
    content: '{}', provider: 'mock-gatekeeper', model: 'm',
    tokens: { input: 1, output: 1 }, cost: 0,
  }),
  extractIntent: async (): Promise<ExtractedIntent> => ({
    intent: 'COMPLEX_CONVERSATION',
    confidence: 0.3,
    entities: {},
    reasoning: 'mock gatekeeper',
  }),
} as unknown as AIProvider & {
  extractIntent(message: string, contextSummary?: string): Promise<ExtractedIntent>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Test resolver (enables dynamic provider resolution with mock providers)
// ─────────────────────────────────────────────────────────────────────────────

class TestResolver extends AIProviderResolverService {
  constructor(private providers: AIProvider[]) {
    super(() => Promise.resolve([]));
  }

  override async getProvidersForRole(role: string): Promise<AIProvider[]> {
    if (role === 'chat_primary') return this.providers;
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared minimal context
// ─────────────────────────────────────────────────────────────────────────────

const MINIMAL_CONTEXT = '=== PESAN SEKARANG ===\nCustomer: Ada ban dalam?';

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('callV2Engine', () => {
  it('case1: valid JSON response → parsed correctly, matches schema', async () => {
    const provider = makeMockProvider('test-valid-1', 'success');
    const gateway = new LLMGateway(
      provider,
      mockGatekeeper,
      mockGatekeeper,
      5000,  // turnDeadlineMs
      1,     // maxAttempts
      undefined,
      () => Promise.resolve(false), // dynamic OFF
    );

    const result = await callV2Engine(MINIMAL_CONTEXT, 'chat_primary', gateway);

    assert.ok(result.success, `expected success, got: ${JSON.stringify(result)}`);
    if (result.success) {
      assert.equal(result.data.schema_version, 'v1');
      assert.equal(result.data.intent, V2_INTENTS.PRODUCT_INQUIRY);
      assert.equal(result.data.confidence, 0.92);
      assert.equal(result.data.entities[0].type, 'product');
      assert.equal(result.data.entities[0].value, 'ban');
      assert.equal(result.data.reply_text, 'Ada ban depan dan ban belakang tersedia. Mau lihat detailnya?');
      assert.equal(result.data.proposed_actions[0].action_type, 'OPEN_CATALOG');
      assert.equal(result.provider, 'test-valid-1');
      assert.equal(result.model, 'test-valid-1-model');
    }
    assert.equal(provider.callCount, 1, 'provider.generate should be called exactly once');
  });

  it('case2: malformed JSON response → graceful error, no throw', async () => {
    const provider = makeMockProvider('test-malformed-2', 'malformed');
    const gateway = new LLMGateway(
      provider,
      mockGatekeeper,
      mockGatekeeper,
      5000,
      1,
      undefined,
      () => Promise.resolve(false),
    );

    const result = await callV2Engine(MINIMAL_CONTEXT, 'chat_primary', gateway);

    assert.ok(!result.success, 'expected failure for malformed JSON');
    if (!result.success) {
      assert.equal(result.error.type, 'parse_error');
      assert.ok(result.error.message.includes('not valid JSON'), `message should mention JSON: ${result.error.message}`);
      assert.equal(result.error.rawOutput, 'not valid json {{{');
    }
  });

  it('case3: valid JSON but missing required field → rejected with clear message', async () => {
    const provider = makeMockProvider('test-missing-3', 'missing-field');
    const gateway = new LLMGateway(
      provider,
      mockGatekeeper,
      mockGatekeeper,
      5000,
      1,
      undefined,
      () => Promise.resolve(false),
    );

    const result = await callV2Engine(MINIMAL_CONTEXT, 'chat_primary', gateway);

    assert.ok(!result.success, 'expected failure for missing required fields');
    if (!result.success) {
      assert.equal(result.error.type, 'parse_error');
      assert.ok(
        result.error.message.includes('Schema validation failed'),
        `message should mention schema validation: ${result.error.message}`,
      );
      // The schema should flag missing fields — at minimum schema_version,
      // confidence, entities, reply_text, needs_clarification (uncertainty_signals
      // has a .default([]) and will NOT be flagged as missing)
      assert.ok(
        result.error.rawOutput !== undefined,
        'rawOutput should be present for debugging',
      );
      const raw = JSON.parse(result.error.rawOutput);
      assert.equal(raw.intent, 'product_inquiry');
      assert.equal(raw.schema_version, undefined, 'raw JSON should be missing schema_version');
    }
  });

  it('case4: primary provider fails → rotation to next provider in same role succeeds (reuse existing gateway rotation)', async () => {
    const failing = makeMockProvider('test-fail-4a', 'fail');
    const success = makeMockProvider('test-success-4b', 'success');

    // Use a real LLMGateway with dynamic resolution enabled + TestResolver
    // that returns [failing, success] for chat_primary. This exercises the
    // gateway's N-provider rotation logic (same-role retry before fallback).
    const resolver = new TestResolver([failing, success]);
    const gateway = new LLMGateway(
      mockGatekeeper,    // primary singleton (not used — dynamic ON)
      mockGatekeeper,    // fallback singleton (not used — dynamic ON, primaryList succeeds)
      mockGatekeeper,
      5000,
      1,     // maxAttempts=1 so the failing provider is tried once before rotating
      resolver,
      () => Promise.resolve(true), // dynamic ON
    );

    const result = await callV2Engine(MINIMAL_CONTEXT, 'chat_primary', gateway);

    // The failing provider should have been attempted
    assert.ok(failing.callCount >= 1, 'failing provider should have been tried at least once');
    // The success provider should have been tried after the failing one
    assert.ok(success.callCount >= 1, 'success provider should have been tried (rotation)');
    // The result should come from the success provider
    assert.ok(result.success, `expected success from rotated provider, got: ${JSON.stringify(result)}`);
    if (result.success) {
      assert.equal(result.provider, 'test-success-4b');
      assert.equal(result.data.intent, V2_INTENTS.PRODUCT_INQUIRY);
    }
  });

  it('case5: all providers exhausted → structured error, no crash', async () => {
    const failing1 = makeMockProvider('test-all-fail-5a', 'fail');
    const failing2 = makeMockProvider('test-all-fail-5b', 'fail');
    const failingFallback = makeMockProvider('test-all-fail-5c', 'fail');

    // Dynamic ON: resolver returns [failing1, failing2] for primary,
    // gateway falls back to this.fallback (failingFallback) when primary exhausted.
    const resolver = new TestResolver([failing1, failing2]);
    const gateway = new LLMGateway(
      mockGatekeeper,
      failingFallback,    // fallback singleton (used when primaryList exhausted + fallbackList empty)
      mockGatekeeper,
      5000,
      1,     // maxAttempts=1, fast failure
      resolver,
      () => Promise.resolve(true), // dynamic ON
    );

    const result = await callV2Engine(MINIMAL_CONTEXT, 'chat_primary', gateway);

    assert.ok(!result.success, 'expected failure when all providers exhausted');
    if (!result.success) {
      assert.equal(result.error.type, 'provider_exhausted');
      assert.ok(
        result.error.failedProviders.length > 0,
        'should list at least one failed provider',
      );
      // All providers should have been tried
      assert.ok(failing1.callCount >= 1, 'failing1 should have been tried');
      assert.ok(failing2.callCount >= 1, 'failing2 should have been tried');
    }
  });

  it('case6: jsonMode:true is forwarded to the provider call (spy assertion)', async () => {
    const provider = makeMockProvider('test-jsonmode-6', 'success');
    const gateway = new LLMGateway(
      provider,
      mockGatekeeper,
      mockGatekeeper,
      5000,
      1,
      undefined,
      () => Promise.resolve(false),
    );

    const result = await callV2Engine(MINIMAL_CONTEXT, 'chat_primary', gateway);

    assert.ok(result.success, 'call should succeed');
    // Spy assertion: jsonMode was forwarded in the options
    assert.ok(provider.lastOptions, 'provider.generate should have received options');
    assert.equal(
      provider.lastOptions?.jsonMode,
      true,
      'jsonMode must be true in the options passed to the provider',
    );
    // Also verify the intent label includes the provider role
    assert.ok(
      provider.lastOptions?.intent === 'v2-engine:chat_primary',
      `intent should be labeled with provider role, got: ${provider.lastOptions?.intent}`,
    );
    // Verify provider was called exactly once (no retry on success)
    assert.equal(provider.calls.length, 1, 'provider.generate should be called exactly once');
  });

  it('case7: LLM returns null for optional fields → normalized to undefined, parse succeeds', async () => {
    // This is the exact scenario discovered in the LIVE smoke test: the LLM
    // returns `"clarification_question": null` and Zod's `.optional()` rejects
    // null. The normalizeNulls() step in engine-call.ts fixes this.
    const rawWithNulls = JSON.stringify({
      schema_version: 'v1',
      intent: V2_INTENTS.PRODUCT_INQUIRY,
      confidence: 0.92,
      entities: [{ type: 'product', value: 'ban', confidence: 0.95 }],
      proposed_actions: [
        { action_type: 'OPEN_CATALOG', payload: {}, confidence: 0.8, requires_validation: false },
      ],
      reply_text: 'Ada ban depan dan ban belakang tersedia.',
      needs_clarification: false,
      clarification_question: null, // ← LLM emits null for absent optional
      summary_update: null,           // ← LLM emits null for absent optional
      uncertainty_signals: [],
    });

    const provider = makeMockProvider('test-nulls-7', 'success', rawWithNulls);
    const gateway = new LLMGateway(
      provider,
      mockGatekeeper,
      mockGatekeeper,
      5000,
      1,
      undefined,
      () => Promise.resolve(false),
    );

    const result = await callV2Engine(MINIMAL_CONTEXT, 'chat_primary', gateway);

    assert.ok(result.success, `expected success after null normalization, got: ${JSON.stringify(result)}`);
    if (result.success) {
      assert.equal(result.data.intent, V2_INTENTS.PRODUCT_INQUIRY);
      assert.equal(
        result.data.reply_text,
        'Ada ban depan dan ban belakang tersedia.',
      );
      // null fields should be normalized to undefined (absent from output)
      assert.equal(result.data.clarification_question, undefined);
      assert.equal(result.data.summary_update, undefined);
    }
  });

  it('case8: LLM omits uncertainty_signals entirely → defaults to [], parse succeeds (P2-UNIT4-FIXUP)', async () => {
    // MiniMax-M2.7 (SambaNova) sometimes omits uncertainty_signals entirely.
    // Schema fix: .default([]) on the Zod field + normalizeNulls(null→undefined)
    // ensures this is handled gracefully.
    const rawMissingField = JSON.stringify({
      schema_version: 'v1',
      intent: V2_INTENTS.PRODUCT_INQUIRY,
      confidence: 0.92,
      entities: [{ type: 'product', value: 'ban', confidence: 0.95 }],
      proposed_actions: [
        { action_type: 'OPEN_CATALOG', payload: {}, confidence: 0.8, requires_validation: false },
      ],
      reply_text: 'Ada ban depan dan ban belakang tersedia.',
      needs_clarification: false,
      // uncertainty_signals intentionally OMITTED
    });

    const provider = makeMockProvider('test-missing-field-8', 'success', rawMissingField);
    const gateway = new LLMGateway(
      provider,
      mockGatekeeper,
      mockGatekeeper,
      5000,
      1,
      undefined,
      () => Promise.resolve(false),
    );

    const result = await callV2Engine(MINIMAL_CONTEXT, 'chat_primary', gateway);

    assert.ok(result.success, `expected success when uncertainty_signals is omitted, got: ${JSON.stringify(result)}`);
    if (result.success) {
      assert.deepEqual(result.data.uncertainty_signals, [], 'uncertainty_signals should default to []');
      assert.equal(result.data.intent, V2_INTENTS.PRODUCT_INQUIRY);
    }
  });

  it('case9: LLM returns uncertainty_signals: null → normalized to undefined → defaults to [], parse succeeds', async () => {
    const rawWithNull = JSON.stringify({
      schema_version: 'v1',
      intent: V2_INTENTS.CANCEL_ORDER,
      confidence: 0.95,
      entities: [],
      proposed_actions: [
        { action_type: 'CANCEL_ORDER', payload: {}, confidence: 0.95, requires_validation: false },
      ],
      reply_text: 'Oke siap Kak, pesanan sudah dibatalkan ya!',
      needs_clarification: false,
      uncertainty_signals: null, // ← LLM emits null instead of array
    });

    const provider = makeMockProvider('test-null-9', 'success', rawWithNull);
    const gateway = new LLMGateway(
      provider,
      mockGatekeeper,
      mockGatekeeper,
      5000,
      1,
      undefined,
      () => Promise.resolve(false),
    );

    const result = await callV2Engine(MINIMAL_CONTEXT, 'chat_primary', gateway);

    assert.ok(result.success, `expected success when uncertainty_signals is null, got: ${JSON.stringify(result)}`);
    if (result.success) {
      assert.deepEqual(result.data.uncertainty_signals, [], 'null uncertainty_signals should default to []');
      assert.equal(result.data.intent, V2_INTENTS.CANCEL_ORDER);
    }
  });
});
