/**
 * AIProviderManager Unit 5 Part 5 — flag-gated resolver cutover of generate().
 *
 * Runner: npx tsx --env-file=../../.env --test --test-force-exit src/tests/manager-dynamic.test.ts
 *
 * Mirrors LLMGateway Unit 3b (B1-B4) but for the SEPARATE manager.ts gateway
 * (adapters.ai / adapters.llm.chat via container.ts). manager.ts has its OWN
 * circuit breaker + provider-cooldown integration — this test proves the
 * resolver cutover swaps ONLY the provider source while the manager's
 * circuit-breaker/cooldown/stats logic runs UNCHANGED.
 *
 * Real production caller that this protects: product.service.ts:994
 * (adapters.ai.generate -> aiProviderManager.generate).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AIProviderManager } from '../adapters/ai/manager.js';
import {
  AIProvider,
  AIProviderError,
  ErrorCategory,
  type AIResponse,
  type AIGenerateOptions,
} from '../adapters/ai/types.js';
import type { AIProviderResolverService } from '../services/ai-provider-resolver.service.js';
import type { GroqAdapter } from '../adapters/ai/groq.adapter.js';

// ── Mock provider factory (mirrors ai-gateway.test.ts / llm-gateway-dynamic) ─

type Behavior = 'success' | 'fail';

function makeMockProvider(name: string, behavior: Behavior): AIProvider & { calls: number } {
  const provider = {
    calls: 0,
    getName: () => name,
    getModel: () => `${name}-model`,
    isHealthy: () => Promise.resolve(behavior !== 'fail'),
    generate: async (_prompt: string, _options?: AIGenerateOptions): Promise<AIResponse> => {
      provider.calls++;
      if (behavior === 'fail') {
        throw new AIProviderError(
          `${name} server error`,
          ErrorCategory.SERVER_ERROR,
          name,
          500,
          true,
        );
      }
      return {
        content: `Hello from ${name}`,
        provider: name,
        model: `${name}-model`,
        tokens: { input: 10, output: 5 },
        cost: 0.001,
      };
    },
  } as unknown as AIProvider & { calls: number };
  return provider;
}

// Minimal gatekeeper stub (manager ctor requires a GroqAdapter-typed gatekeeper;
// generate() never calls it, so a bare stub is enough for these tests).
const mockGatekeeper = {
  getName: () => 'groq-gk',
  getModel: () => 'groq-gk-model',
  generate: async () => ({ content: '{}', provider: 'groq-gk', model: 'groq-gk-model', tokens: { input: 1, output: 1 }, cost: 0 }),
  extractIntent: async () => ({ intent: 'COMPLEX_CONVERSATION' as const, confidence: 0.3, entities: {} }),
} as unknown as GroqAdapter;

function fakeResolver(routes: Record<string, AIProvider[]>): AIProviderResolverService & { roles: string[] } {
  const roles: string[] = [];
  return {
    getProvidersForRole: async (role: string) => {
      roles.push(role);
      return routes[role] ?? [];
    },
    roles,
  } as AIProviderResolverService & { roles: string[] };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('AIProviderManager dynamic cutover (Unit 5 Part 5, flag default OFF)', () => {
  test('M1: flag OFF -> resolver NOT consulted, default singletons used', async () => {
    const primary = makeMockProvider('default-primary', 'success');
    const fallback = makeMockProvider('default-fallback', 'success');
    const resolver = fakeResolver({});

    const mgr = new AIProviderManager(primary, fallback, mockGatekeeper, resolver, () => Promise.resolve(false));

    const result = await mgr.generate('hi', { temperature: 0.2 });

    assert.equal(result.provider, 'default-primary');
    assert.equal(primary.calls, 1);
    assert.equal(fallback.calls, 0);
    assert.equal(resolver.roles.length, 0, 'resolver must be bypassed on OFF path');
  });

  test('M2: flag ON -> resolver-backed providers used, singletons bypassed', async () => {
    const dynPrimary = makeMockProvider('dyn-primary', 'success');
    const dynFallback = makeMockProvider('dyn-fallback', 'success');
    const defaultPrimary = makeMockProvider('default-primary', 'success');
    const defaultFallback = makeMockProvider('default-fallback', 'success');
    const resolver = fakeResolver({ chat_primary: [dynPrimary], chat_fallback: [dynFallback] });

    const mgr = new AIProviderManager(defaultPrimary, defaultFallback, mockGatekeeper, resolver, () => Promise.resolve(true));

    const result = await mgr.generate('hi', { temperature: 0.2 });

    assert.equal(result.provider, 'dyn-primary');
    assert.equal(dynPrimary.calls, 1);
    assert.equal(defaultPrimary.calls, 0, 'default primary singleton must not be called on ON path');
    assert.deepEqual(resolver.roles, ['chat_primary', 'chat_fallback']);
  });

  test('M3: flag ON + empty DB list -> falls back to default singleton (no crash)', async () => {
    const defaultPrimary = makeMockProvider('default-primary', 'success');
    const defaultFallback = makeMockProvider('default-fallback', 'success');
    const resolver = fakeResolver({}); // both roles empty

    const mgr = new AIProviderManager(defaultPrimary, defaultFallback, mockGatekeeper, resolver, () => Promise.resolve(true));

    const result = await mgr.generate('hi');

    assert.equal(result.provider, 'default-primary', 'graceful fallback to default primary');
    assert.equal(defaultPrimary.calls, 1);
  });

  test('M4: flag ON + resolved primary fails -> resolved fallback succeeds (circuit breaker loop intact)', async () => {
    const dynPrimary = makeMockProvider('dyn-primary', 'fail');
    const dynFallback = makeMockProvider('dyn-fallback', 'success');
    const defaultPrimary = makeMockProvider('default-primary', 'fail');
    const defaultFallback = makeMockProvider('default-fallback', 'success');
    const resolver = fakeResolver({ chat_primary: [dynPrimary], chat_fallback: [dynFallback] });

    const mgr = new AIProviderManager(defaultPrimary, defaultFallback, mockGatekeeper, resolver, () => Promise.resolve(true));

    const result = await mgr.generate('hi');

    assert.equal(result.provider, 'dyn-fallback');
    assert.ok(dynPrimary.calls >= 1, 'resolved primary was attempted');
    assert.equal(dynFallback.calls, 1, 'resolved fallback recovered after primary failure');
    // Manager circuit breaker must NOT have opened after a single primary failure.
    const stats = mgr.getStats();
    assert.equal(stats.fallback.success, 1);
  });
});
