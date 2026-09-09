/**
 * INT-L9: Cooldown cascade simulation test.
 *
 * Simulates Mistral (chat_primary) AND SambaNova (chat_fallback) both in
 * cooldown — verifies gateway falls through to Internal LLM (chat_fallback_2)
 * as the THIRD tier, NOT AllProvidersCooldownError.
 *
 * Test 1: primary + fallback in cooldown → success via fallback_2
 * Test 2: ALL THREE in cooldown → AllProvidersCooldownError (sanity check)
 *
 * Runner: npx tsx --env-file=../../.env --test --test-force-exit src/adapters/ai/__tests__/llm-gateway.cooldown-cascade.test.ts
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { LLMGateway, AllProvidersCooldownError } from '../llm-gateway.js';
import {
  AIProvider,
  AIProviderError,
  ErrorCategory,
  AIResponse,
  AIGenerateOptions,
} from '../types.js';
import { cooldown } from '../../../services/provider-cooldown.js';

// ─── Mock providers ─────────────────────────────────────────────────

class MockSuccessProvider implements AIProvider {
  public callCount = 0;
  private readonly providerName: string;

  constructor(name: string) {
    this.providerName = name;
  }

  getName() {
    return this.providerName;
  }
  getModel() {
    return 'gemini-3-flash';
  }
  isHealthy?() {
    return Promise.resolve(true);
  }

  async generate(_prompt: string, _options?: AIGenerateOptions): Promise<AIResponse> {
    this.callCount++;
    return {
      content: 'mock response from Internal LLM',
      provider: this.providerName,
      model: 'gemini-3-flash',
      tokens: { input: 10, output: 10 },
      cost: 0.001,
    };
  }
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('LLMGateway — cooldown cascade (3-tier fallthrough)', () => {
  const originalWarn = console.warn;
  const originalLog = console.log;
  const originalError = console.error;

  before(() => {
    console.warn = () => {};
    console.log = () => {};
    console.error = () => {};
  });

  after(() => {
    console.warn = originalWarn;
    console.log = originalLog;
    console.error = originalError;
  });

  it('case1: primary+fallback cooldown → succeeds via fallback_2 (Internal LLM)', async () => {
    const ts = Date.now();
    const mistralName = `mistral-cooldown-${ts}`;
    const sambaNovaName = `sambanova-cooldown-${ts}`;
    const internalLLMName = `internal-llm-${ts}`;

    // Force Mistral (primary) and SambaNova (fallback) into cooldown
    cooldown(mistralName, 'chat_primary', 300_000);     // 5 min
    cooldown(sambaNovaName, 'chat_fallback', 300_000);   // 5 min

    // Mock providers — primary and fallback MUST NOT be called
    const primary = new MockSuccessProvider(mistralName);
    const fallback = new MockSuccessProvider(sambaNovaName);

    // Internal LLM (fallback_2) — should be the ONLY one called
    const fallback2 = new MockSuccessProvider(internalLLMName);

    // dynamicFlagProvider = false → uses singleton providers (mocks)
    const gateway = new LLMGateway(
      primary,
      fallback,
      fallback as any,          // gatekeeper (unused in this path)
      5_000,                    // turnDeadlineMs
      1,                        // maxAttempts
      undefined,                // resolver (unused when dynamicFlagProvider = false)
      () => Promise.resolve(false), // dynamicFlagProvider = OFF → singleton mode
      fallback2,                // fallback2 (Internal LLM) — 8th param
    );

    const result = await gateway.generate('ban dalam motor berapa harganya?');

    // The response MUST come from Internal LLM (fallback_2)
    assert.equal(result.provider, internalLLMName,
      `Expected response from Internal LLM (${internalLLMName}), got ${result.provider}`);

    // Primary and fallback MUST NOT have been called (they were in cooldown)
    assert.equal(primary.callCount, 0, 'Primary (Mistral) should NOT have been called');
    assert.equal(fallback.callCount, 0, 'Fallback (SambaNova) should NOT have been called');

    // Internal LLM MUST have been called exactly once
    assert.equal(fallback2.callCount, 1, 'Internal LLM should have been called exactly once');

    // Verify stats show the correct tier usage
    const stats = gateway.getStats();
    assert.equal(stats.primary.failed, 0, 'Primary should have 0 failures (skipped, not failed)');
    assert.equal(stats.fallback.failed, 0, 'Fallback should have 0 failures (skipped, not failed)');
    assert.equal(stats.fallback_2?.success, 1, 'Fallback_2 should have 1 success');

    // Verify getProviders includes fallback_2
    const providers = gateway.getProviders();
    assert.equal(providers.fallback_2, internalLLMName,
      'getProviders() should return fallback_2 as Internal LLM');
  });

  it('case2: ALL THREE in cooldown → AllProvidersCooldownError', async () => {
    const ts = Date.now();
    const mistralName = `mistral-all-${ts}`;
    const sambaNovaName = `sambanova-all-${ts}`;
    const internalLLMName = `internal-all-${ts}`;

    // Force ALL THREE into cooldown
    cooldown(mistralName, 'chat_primary', 300_000);
    cooldown(sambaNovaName, 'chat_fallback', 300_000);
    cooldown(internalLLMName, 'chat_fallback_2', 300_000);

    const primary = new MockSuccessProvider(mistralName);
    const fallback = new MockSuccessProvider(sambaNovaName);
    const fallback2 = new MockSuccessProvider(internalLLMName);

    const gateway = new LLMGateway(
      primary,
      fallback,
      fallback as any,
      5_000,
      1,
      undefined,
      () => Promise.resolve(false),
      fallback2,
    );

    await assert.rejects(
      async () => {
        await gateway.generate('test');
      },
      (err: any) => {
        assert.ok(err instanceof AllProvidersCooldownError,
          `Expected AllProvidersCooldownError, got ${err?.constructor?.name}`);
        return true;
      },
    );

    // NO provider should have been called
    assert.equal(primary.callCount, 0);
    assert.equal(fallback.callCount, 0);
    assert.equal(fallback2.callCount, 0);
  });

  it('case3: only fallback_2 cooldown → primary+fallback normal operation', async () => {
    const ts = Date.now();
    const mistralName = `mistral-normal-${ts}`;
    const sambaNovaName = `sambanova-normal-${ts}`;
    const internalLLMName = `internal-normal-${ts}`;

    // Only Internal LLM is in cooldown — primary and fallback should work normally
    cooldown(internalLLMName, 'chat_fallback_2', 300_000);

    const primary = new MockSuccessProvider(mistralName);
    const fallback = new MockSuccessProvider(sambaNovaName);
    const fallback2 = new MockSuccessProvider(internalLLMName);

    const gateway = new LLMGateway(
      primary,
      fallback,
      fallback as any,
      5_000,
      1,
      undefined,
      () => Promise.resolve(false),
      fallback2,
    );

    const result = await gateway.generate('hello');
    assert.equal(result.provider, mistralName,
      'Primary should succeed when not in cooldown');
    assert.equal(primary.callCount, 1);
    assert.equal(fallback.callCount, 0);
    assert.equal(fallback2.callCount, 0);
  });
});
