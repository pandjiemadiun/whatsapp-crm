/**
 * LLMGateway Unit 5 Part 1 — Gatekeeper Option B (manual demonstration).
 *
 * Runner: npx tsx --env-file=../../.env --test --test-force-exit src/tests/ai-gateway-gatekeeper.test.ts
 *
 * Decision — Option B (chosen):
 *   The gatekeeper (extractIntent) is PINNED to the groqAdapter singleton and is
 *   NOT resolved from AIProviderConfig, because extractIntent is GroqAdapter-
 *   specific and NOT on the AIProvider interface. Option A (optional extractIntent
 *   on AIProvider + implementing on every adapter) was NOT chosen because it adds
 *   a provider-specific method to the shared interface — which Part 1 asked to
 *   avoid.
 *
 * Demonstration (hermetic, no real API / no DB):
 *   - Flag ON via dynamicFlagProvider.
 *   - Resolver returns primary/fallback providers that do NOT implement
 *     extractIntent (plain AIProvider — exactly what OpenAICompatibleAdapter /
 *     GeminiShimAdapter are).
 *   - gateway.extractIntent() must route through this.gatekeeper (the pinned mock)
 *     and return its distinct marker, NOT the COMPLEX_CONVERSATION error-fallback.
 *     If the gateway had tried to use a resolver provider as gatekeeper, it would
 *     throw TypeError (no .extractIntent) -> caught -> COMPLEX_CONVERSATION. So
 *     asserting the gatekeeper's marker proves Option B: no crash AND no silent
 *     degradation to COMPLEX_CONVERSATION-for-everything (the Unit 3b regression).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LLMGateway } from '../adapters/ai/llm-gateway.js';
import {
  AIProvider,
  type AIResponse,
  type AIGenerateOptions,
  type ExtractedIntent,
} from '../adapters/ai/types.js';
import type { AIProviderResolverService } from '../services/ai-provider-resolver.service.js';

// ── Mock provider factory (no extractIntent — mirrors the Unit-2 generic adapters) ─

function makeMockProvider(name: string): AIProvider & { calls: number } {
  const provider = {
    calls: 0,
    getName: () => name,
    getModel: () => `${name}-model`,
    isHealthy: () => Promise.resolve(true),
    generate: async (_prompt: string, _options?: AIGenerateOptions): Promise<AIResponse> => {
      provider.calls++;
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

// ── Pinned gatekeeper mock (has extractIntent, like GroqAdapter) ─────────────

const GATEKEEPER_MARKER = 'unit5-gatekeeper-pinned';
const mockGatekeeper = {
  getName: () => 'groq-gk',
  getModel: () => 'groq-gk-model',
  generate: async () => ({
    content: '{}', provider: 'groq-gk', model: 'groq-gk-model',
    tokens: { input: 1, output: 1 }, cost: 0,
  }),
  // Distinct intent + reasoning so we can prove THIS ran (not the error fallback).
  extractIntent: async (): Promise<ExtractedIntent> => ({
    intent: 'FAQ_INQUIRY' as const,
    confidence: 0.9,
    entities: {},
    reasoning: GATEKEEPER_MARKER,
  }),
} as unknown as AIProvider & {
  extractIntent(message: string, contextSummary?: string): Promise<ExtractedIntent>;
};

// A resolver that returns providers WITH extractIntent absent (the generic adapters).
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

describe('LLMGateway gatekeeper (Unit 5 Part 1 — Option B)', () => {
  test('flag ON + resolver primary/fallback lack extractIntent -> extractIntent uses the pinned gatekeeper', async () => {
    // Resolver returns generic providers (NO extractIntent), exactly like the
    // Unit-2 OpenAICompatibleAdapter / GeminiShimAdapter that the resolver builds.
    const dynPrimary = makeMockProvider('dyn-primary');
    const dynFallback = makeMockProvider('dyn-fallback');
    const defaultPrimary = makeMockProvider('default-primary');
    const defaultFallback = makeMockProvider('default-fallback');
    const resolver = fakeResolver({
      chat_primary: [dynPrimary],
      chat_fallback: [dynFallback],
    });

    const gw = new LLMGateway(
      defaultPrimary,
      defaultFallback,
      mockGatekeeper,           // pinned gatekeeper (the groqAdapter stand-in)
      5000,
      1,
      resolver,
      () => Promise.resolve(true), // flag ON
    );

    // If the gateway had resolved the gatekeeper from the resolver, this would
    // throw TypeError (dynPrimary has no .extractIntent) and the catch block
    // would return COMPLEX_CONVERSATION. Asserting the gatekeeper's marker
    // proves Option B: gatekeeper stayed pinned, no crash, no silent degradation.
    const intent = await gw.extractIntent('permintaan saya tentang harga');

    assert.equal(intent.intent, 'FAQ_INQUIRY', 'gatekeeper result, not COMPLEX_CONVERSATION fallback');
    assert.equal(intent.reasoning, GATEKEEPER_MARKER, 'the pinned gatekeeper handled it');
    assert.equal(resolver.roles.length, 0, 'extractIntent must NOT consult the resolver');
    // Resolver-provided providers (which lack extractIntent) must never be called.
    assert.equal(dynPrimary.calls, 0);
    assert.equal(dynFallback.calls, 0);
  });

  test('flag OFF -> extractIntent still uses the pinned gatekeeper (OFF path untouched)', async () => {
    const defaultPrimary = makeMockProvider('default-primary');
    const defaultFallback = makeMockProvider('default-fallback');
    const resolver = fakeResolver({ chat_primary: [makeMockProvider('dyn')], chat_fallback: [] });

    const gw = new LLMGateway(
      defaultPrimary,
      defaultFallback,
      mockGatekeeper,
      5000,
      1,
      resolver,
      () => Promise.resolve(false), // flag OFF
    );

    const intent = await gw.extractIntent('halo');
    assert.equal(intent.reasoning, GATEKEEPER_MARKER, 'OFF path also uses pinned gatekeeper');
    assert.equal(resolver.roles.length, 0, 'resolver bypassed on OFF path');
  });
});
