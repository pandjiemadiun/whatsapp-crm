/**
 * LLMGateway Unit 3b — feature-flag-gated dynamic provider resolution.
 * Runner: npx tsx --env-file=../../.env --test --test-force-exit src/tests/llm-gateway-dynamic.test.ts
 *
 * Acceptance #6 demonstration (both paths, hermetic — mock providers + fake
 * resolver, no real API, no DB):
 *   B1 flag OFF  -> resolver NOT consulted; original singletons used.
 *   B2 flag ON   -> resolver-backed providers used; singletons bypassed.
 *   B3 flag ON + empty DB list -> falls back to default singleton (no crash).
 *   B4 flag ON + resolved primary fails -> resolved fallback succeeds
 *      (proves the circuit-breaker/retry loop is intact on the ON path).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LLMGateway } from '../adapters/ai/llm-gateway.js';
import {
  AIProvider,
  AIProviderError,
  ErrorCategory,
  type AIResponse,
  type AIGenerateOptions,
  type ExtractedIntent,
} from '../adapters/ai/types.js';
import type { AIProviderResolverService } from '../services/ai-provider-resolver.service.js';
import { cooldown } from '../services/provider-cooldown.js';

// ── Mock provider factory (mirrors ai-gateway.test.ts) ─────────────────────

type Behavior = 'success' | 'fail' | 'rate_limit';

function makeMockProvider(name: string, behavior: Behavior): AIProvider & { calls: number } {
  const provider = {
    calls: 0,
    getName: () => name,
    getModel: () => `${name}-model`,
    isHealthy: () => Promise.resolve(behavior !== 'fail'),
    generate: async (_prompt: string, _options?: AIGenerateOptions): Promise<AIResponse> => {
      provider.calls++;
      if (behavior === 'rate_limit') {
        throw new AIProviderError(
          `${name} rate limited`,
          ErrorCategory.RATE_LIMIT,
          name,
          429,
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
      return {
        content: `Hello from ${name}`,
        provider: name,
        model: `${name}-model`,
        tokens: { input: 10, output: 5 },
        cost: 0.001,
      };
    },
  } as AIProvider & { calls: number };
  return provider;
}

const mockGatekeeper = {
  getName: () => 'groq-gk',
  getModel: () => 'groq-gk-model',
  generate: async () => ({
    content: '{}',
    provider: 'groq-gk',
    model: 'groq-gk-model',
    tokens: { input: 1, output: 1 },
    cost: 0,
  }),
  extractIntent: async (): Promise<ExtractedIntent> => ({
    intent: 'COMPLEX_CONVERSATION' as const,
    confidence: 0.3,
    entities: {},
  }),
} as unknown as AIProvider & {
  extractIntent(message: string, contextSummary?: string): Promise<ExtractedIntent>;
};

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

describe('LLMGateway dynamic-provider cutover (Unit 3b, flag default OFF)', () => {
  test('B1: flag OFF -> resolver NOT consulted, original singletons used', async () => {
    const primary = makeMockProvider('default-primary', 'success');
    const fallback = makeMockProvider('default-fallback', 'success');
    const resolver = fakeResolver({});

    const gw = new LLMGateway(
      primary,
      fallback,
      mockGatekeeper,
      5000,
      1,
      resolver,
      () => Promise.resolve(false), // flag OFF
    );

    const result = await gw.generate('hi', { temperature: 0.2 });

    assert.equal(result.provider, 'default-primary');
    assert.equal(result.content, 'Hello from default-primary');
    assert.equal(primary.calls, 1);
    assert.equal(fallback.calls, 0);
    assert.equal(resolver.roles.length, 0, 'resolver must be bypassed on OFF path');
  });

  test('B2: flag ON -> resolver-backed providers used, singletons bypassed', async () => {
    const dynPrimary = makeMockProvider('dyn-primary', 'success');
    const dynFallback = makeMockProvider('dyn-fallback', 'success');
    const defaultPrimary = makeMockProvider('default-primary', 'success');
    const defaultFallback = makeMockProvider('default-fallback', 'success');
    const resolver = fakeResolver({
      chat_primary: [dynPrimary],
      chat_fallback: [dynFallback],
    });

    const gw = new LLMGateway(
      defaultPrimary,
      defaultFallback,
      mockGatekeeper,
      5000,
      1,
      resolver,
      () => Promise.resolve(true), // flag ON
    );

    const result = await gw.generate('hi', { temperature: 0.2 });

    assert.equal(result.provider, 'dyn-primary');
    assert.equal(dynPrimary.calls, 1);
    assert.equal(defaultPrimary.calls, 0, 'default primary singleton must not be called on ON path');
    assert.deepEqual(resolver.roles, ['chat_primary', 'chat_fallback']);
  });

  test('B3: flag ON + empty DB list -> falls back to default singleton (no crash)', async () => {
    const defaultPrimary = makeMockProvider('default-primary', 'success');
    const defaultFallback = makeMockProvider('default-fallback', 'success');
    const resolver = fakeResolver({}); // both roles empty

    const gw = new LLMGateway(
      defaultPrimary,
      defaultFallback,
      mockGatekeeper,
      5000,
      1,
      resolver,
      () => Promise.resolve(true), // flag ON
    );

    const result = await gw.generate('hi');

    assert.equal(result.provider, 'default-primary', 'graceful fallback to default primary');
    assert.equal(defaultPrimary.calls, 1);
  });

  test('B4: flag ON + resolved primary fails -> resolved fallback succeeds (breaker loop intact)', async () => {
    const dynPrimary = makeMockProvider('dyn-primary', 'fail');
    const dynFallback = makeMockProvider('dyn-fallback', 'success');
    const defaultPrimary = makeMockProvider('default-primary', 'fail');
    const defaultFallback = makeMockProvider('default-fallback', 'success');
    const resolver = fakeResolver({
      chat_primary: [dynPrimary],
      chat_fallback: [dynFallback],
    });

    // maxAttempts=1 so the failed primary doesn't retry; falls straight to fallback
    const gw = new LLMGateway(
      defaultPrimary,
      defaultFallback,
      mockGatekeeper,
      5000,
      1,
      resolver,
      () => Promise.resolve(true), // flag ON
    );

    const result = await gw.generate('hi');

    assert.equal(result.provider, 'dyn-fallback');
    assert.ok(dynPrimary.calls >= 1, 'resolved primary was attempted');
    assert.equal(dynFallback.calls, 1, 'resolved fallback recovered after primary failure');
  });

  // ── N1: Provider-Rotation within a role ─────────────────────────────────
  // These tests verify the full-list iteration fix: when a role has 2+ active
  // providers, the gateway iterates the FULL priority-ordered list instead of
  // truncating to index 0.

  test('B5: flag ON, 1 provider per role — regression: primary succeeds, fallback untouched', async () => {
    const dynPrimary = makeMockProvider('gw-reg-primary', 'success');
    const dynFallback = makeMockProvider('gw-reg-fallback', 'success');
    const resolver = fakeResolver({
      chat_primary: [dynPrimary],
      chat_fallback: [dynFallback],
    });

    const gw = new LLMGateway(
      makeMockProvider('gw-default-p', 'success'),
      makeMockProvider('gw-default-f', 'success'),
      mockGatekeeper,
      5000,
      1,
      resolver,
      () => Promise.resolve(true),
    );

    const result = await gw.generate('hi');

    // With 1 provider per role, iteration must behave identically to the old
    // [0]-only path: primary tried first, fallback never called.
    assert.equal(result.provider, 'gw-reg-primary');
    assert.equal(dynPrimary.calls, 1, 'primary called exactly once');
    assert.equal(dynFallback.calls, 0, 'fallback NOT called on primary success');
  });

  test('B6: flag ON, 2 primary providers — first rate-limited (429), second used (same role rotation)', async () => {
    const rlPrimary = makeMockProvider('gw-p1-rl', 'rate_limit');
    const okPrimary = makeMockProvider('gw-p2-ok', 'success');
    const fbProvider = makeMockProvider('gw-fb-ok', 'success');
    const resolver = fakeResolver({
      // priority order: p1 (highest) first, p2 second
      chat_primary: [rlPrimary, okPrimary],
      chat_fallback: [fbProvider],
    });

    const gw = new LLMGateway(
      makeMockProvider('gw-default-p', 'success'),
      makeMockProvider('gw-default-f', 'success'),
      mockGatekeeper,
      5000,
      1,
      resolver,
      () => Promise.resolve(true),
    );

    const result = await gw.generate('hi');

    // First primary (p1) was rate-limited → cooldown triggered → moved to p2
    // WITHOUT falling through to the fallback role.
    assert.equal(rlPrimary.calls, 1, 'rate-limited primary attempted exactly once');
    assert.equal(okPrimary.calls, 1, 'second primary in SAME role was used');
    assert.equal(fbProvider.calls, 0, 'fallback NOT called — same-role rotation succeeded');
    assert.equal(result.provider, 'gw-p2-ok', 'result came from the second primary');
  });

  test('B7: flag ON, both primary providers in cooldown — falls through to fallback role', async () => {
    const p1 = makeMockProvider('gw-p1-cooldown', 'success');
    const p2 = makeMockProvider('gw-p2-cooldown', 'success');
    const fb = makeMockProvider('gw-fb-cooldown', 'success');
    const resolver = fakeResolver({
      chat_primary: [p1, p2],
      chat_fallback: [fb],
    });

    // Pre-set cooldown on BOTH primary providers so they are all skipped.
    cooldown('gw-p1-cooldown', 60_000);
    cooldown('gw-p2-cooldown', 60_000);

    const gw = new LLMGateway(
      makeMockProvider('gw-default-p', 'success'),
      makeMockProvider('gw-default-f', 'success'),
      mockGatekeeper,
      5000,
      1,
      resolver,
      () => Promise.resolve(true),
    );

    const result = await gw.generate('hi');

    // All primary providers in cooldown → fall through to fallback role exactly
    // like the original "primary failed → try fallback" behavior.
    // IMPORTANT: cooldown is keyed by provider name, NOT by provider object —
    // so pre-cooling both prevents any primary attempt.
    assert.equal(p1.calls, 0, 'p1 skipped (in cooldown)');
    assert.equal(p2.calls, 0, 'p2 skipped (in cooldown)');
    assert.equal(fb.calls, 1, 'fallback role provider used after primary exhausted');
    assert.equal(result.provider, 'gw-fb-cooldown');
  });
});
