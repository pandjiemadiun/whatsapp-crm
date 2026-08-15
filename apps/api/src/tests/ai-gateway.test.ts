/**
 * LLMGateway unit tests (G2-B.1)
 *
 * Runner: npx tsx --test --test-force-exit src/tests/ai-gateway.test.ts
 *
 * Tests: primary provider, fallback, provider failure, timeout, gateway mockability
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LLMGateway, CircuitOpenError } from '../adapters/ai/llm-gateway.js';
import {
  AIProvider,
  AIProviderError,
  ErrorCategory,
  type AIResponse,
  type AIGenerateOptions,
  type ExtractedIntent,
} from '../adapters/ai/types.js';

// ── Mock provider factory ─────────────────────────────────────────────────

function makeMockProvider(
  name: string,
  behavior: 'success' | 'fail' | 'timeout' | 'slow',
): AIProvider & { callCount: number } {
  const provider = {
    callCount: 0,
    getName: () => name,
    getModel: () => `${name}-model`,
    isHealthy: () => Promise.resolve(behavior !== 'fail'),
    generate: async (_prompt: string, _options?: AIGenerateOptions): Promise<AIResponse> => {
      provider.callCount++;
      if (behavior === 'timeout') {
        throw new AIProviderError(
          `${name} request timeout`,
          ErrorCategory.NETWORK_TIMEOUT,
          name,
          undefined,
          true,
        );
      }
      if (behavior === 'fail') {
        throw new AIProviderError(
          `${name} server error`,
          ErrorCategory.SERVER_ERROR,
          name,
          500,
          true,
        );
      }
      if (behavior === 'slow') {
        return new Promise<AIResponse>(() => {});
      }
      return {
        content: `Hello from ${name}`,
        provider: name,
        model: `${name}-model`,
        tokens: { input: 10, output: 5 },
        cost: 0.001,
      };
    },
  } as unknown as AIProvider & { callCount: number };
  return provider;
}

// ── Shared mock gatekeeper ────────────────────────────────────────────────

const mockGatekeeper = {
  getName: () => 'groq',
  getModel: () => 'groq-model',
  generate: async () => ({
    content: '{}', provider: 'groq', model: 'groq-model',
    tokens: { input: 1, output: 1 }, cost: 0,
  }),
  extractIntent: async (): Promise<ExtractedIntent> => ({
    intent: 'COMPLEX_CONVERSATION' as const,
    confidence: 0.3,
    entities: {},
  }),
} as unknown as AIProvider & {
  extractIntent(message: string, contextSummary?: string): Promise<ExtractedIntent>;
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe('LLMGateway', () => {
  test('primary provider succeeds without calling fallback', async () => {
    const primary = makeMockProvider('primary', 'success');
    const fallback = makeMockProvider('fallback', 'success');
    const gatekeeper = mockGatekeeper;

    const gateway = new LLMGateway(primary, fallback, gatekeeper, 5000, 3);
    const result = await gateway.generate('hello', { temperature: 0.2 });

    assert.equal(result.provider, 'primary');
    assert.equal(result.content, 'Hello from primary');
    assert.equal(primary.callCount, 1);
    assert.equal(fallback.callCount, 0);
  });

  test('fallback succeeds when primary fails', async () => {
    const primary = makeMockProvider('primary', 'fail');
    const fallback = makeMockProvider('fallback', 'success');
    const gatekeeper = mockGatekeeper;

    const gateway = new LLMGateway(primary, fallback, gatekeeper, 5000, 1);
    const result = await gateway.generate('hello', { temperature: 0.2 });

    assert.equal(result.provider, 'fallback');
    assert.equal(result.content, 'Hello from fallback');
    assert.equal(fallback.callCount, 1);
    assert.ok(primary.callCount >= 1);

    const stats = gateway.getStats();
    assert.equal(stats.primary.failed, primary.callCount);
    assert.equal(stats.fallback.success, 1);
  });

  test('provider failure — both fail throws AIProviderError', async () => {
    const primary = makeMockProvider('primary', 'fail');
    const fallback = makeMockProvider('fallback', 'fail');
    const gatekeeper = mockGatekeeper;

    const gateway = new LLMGateway(primary, fallback, gatekeeper, 5000, 1);
    await assert.rejects(
      () => gateway.generate('hello'),
      (err) => err instanceof AIProviderError,
    );

    const stats = gateway.getStats();
    assert.ok(stats.primary.failed > 0);
    assert.ok(stats.fallback.failed > 0);
  });

  test('timeout — slow provider triggers gateway deadline', async () => {
    const primary = makeMockProvider('primary', 'slow');
    const fallback = makeMockProvider('fallback', 'success');
    const gatekeeper = mockGatekeeper;

    // 100ms deadline — primary's slow() never resolves, so gateway deadline fires
    const gateway = new LLMGateway(primary, fallback, gatekeeper, 100, 1);
    const result = await gateway.generate('hello');

    // Should fall back to the fallback provider after timeout
    assert.equal(result.provider, 'fallback');
    assert.equal(result.content, 'Hello from fallback');
    assert.equal(fallback.callCount, 1);
  });

  test('gateway mockability — generate is replaceable', async () => {
    const primary = makeMockProvider('primary', 'success');
    const fallback = makeMockProvider('fallback', 'success');
    const gatekeeper = mockGatekeeper;

    const gateway = new LLMGateway(primary, fallback, gatekeeper, 5000, 3);

    // Mock the gateway's generate — simulates golden test pattern
    const originalGenerate = gateway.generate.bind(gateway);
    const mockResponse: AIResponse = {
      content: '{"intent":"clarify","cart_ops":[],"buy_signal":"no"}',
      provider: 'mocked',
      model: 'mock-model',
      tokens: { input: 1, output: 1 },
      cost: 0,
    };
    (gateway as any).generate = async () => mockResponse;

    const result = await gateway.generate('test prompt');
    assert.equal(result.provider, 'mocked');
    assert.equal(result.content, mockResponse.content);

    // Restore
    (gateway as any).generate = originalGenerate;
    const realResult = await gateway.generate('test prompt');
    assert.equal(realResult.provider, 'primary');
  });

  test('circuit breaker opens after threshold failures', async () => {
    const primary = makeMockProvider('primary', 'fail');
    const fallback = makeMockProvider('fallback', 'fail');
    const gatekeeper = mockGatekeeper;

    const gateway = new LLMGateway(primary, fallback, gatekeeper, 5000, 1);

    // Exhaust both providers (1 attempt each, both fail) → 2 failures
    // Need 5 to open the circuit (threshold 5)
    for (let i = 0; i < 5; i++) {
      try {
        await gateway.generate('fail');
      } catch {
        // expected
      }
    }

    const cbMetrics = gateway.getCircuitBreakerMetrics();
    assert.equal(cbMetrics.state, 'open');

    // Circuit open → should throw CircuitOpenError immediately
    await assert.rejects(
      () => gateway.generate('should-not-attempt'),
      (err) => err instanceof CircuitOpenError,
    );
  });

  test('getStats and getProviders return correct structure', () => {
    const primary = makeMockProvider('gemini', 'success');
    const fallback = makeMockProvider('groq', 'success');
    const gatekeeper = mockGatekeeper;

    const gateway = new LLMGateway(primary, fallback, gatekeeper, 5000, 3);

    const stats = gateway.getStats();
    assert.ok(stats.primary !== undefined);
    assert.ok(stats.fallback !== undefined);
    assert.ok(stats.errorLog !== undefined);
    assert.ok(stats.circuitBreaker !== undefined);

    const providers = gateway.getProviders();
    assert.equal(providers.primary, 'gemini');
    assert.equal(providers.fallback, 'groq');
    assert.equal(providers.gatekeeper, 'groq');
  });
});
