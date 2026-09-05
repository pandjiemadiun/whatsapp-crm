/**
 * Tests for the LLMGateway cooldown crash fix (BUGFIX A.1 / A.2).
 *
 * Verifies:
 * 1. When ALL providers are in cooldown (shouldSkipProvider returns true for
 *    every provider), the gateway throws AllProvidersCooldownError with a
 *    CLEAR message — NOT a generic TypeError from `lastError!.category`.
 * 2. When a provider returns 429 on attempt 0 (triggering cooldown), the
 *    retry re-check detects the cooldown and breaks — the provider is called
 *    only ONCE (not maxAttempts=3x), and the error is a proper AIProviderError.
 * 3. Gateway recovers when cooldown expires.
 *
 * Runner: npx tsx --env-file=../../.env --test --test-force-exit src/adapters/ai/__tests__/llm-gateway.cooldown.test.ts
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
import { cooldown, isCooldown } from '../../../services/provider-cooldown.js';

// ─── Mock providers ─────────────────────────────────────────────────

class MockRateLimitedProvider implements AIProvider {
  public callCount = 0;
  private readonly providerName: string;

  constructor(name: string) {
    this.providerName = name;
  }

  getName() {
    return this.providerName;
  }
  getModel() {
    return 'mock-rate-limited';
  }
  isHealthy?() {
    return Promise.resolve(true);
  }

  async generate(_prompt: string, _options?: AIGenerateOptions): Promise<AIResponse> {
    this.callCount++;
    throw new AIProviderError(
      '429 Too Many Requests',
      ErrorCategory.RATE_LIMIT,
      this.providerName,
      429,
      true, // retryable
      5,    // retryAfter: 5 seconds (short cooldown for test)
    );
  }
}

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
    return 'mock-success';
  }
  isHealthy?() {
    return Promise.resolve(true);
  }

  async generate(_prompt: string, _options?: AIGenerateOptions): Promise<AIResponse> {
    this.callCount++;
    return {
      content: 'mock response',
      provider: this.providerName,
      model: 'mock-success',
      tokens: { input: 10, output: 5 },
      cost: 0.001,
    };
  }
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('LLMGateway — cooldown crash fix (BUGFIX A.1 / A.2)', () => {
  const originalWarn = console.warn;
  const originalLog = console.log;
  const originalError = console.error;

  before(() => {
    // Suppress console output from cooldown warnings + token tracker
    console.warn = () => {};
    console.log = () => {};
    console.error = () => {};
  });

  after(() => {
    console.warn = originalWarn;
    console.log = originalLog;
    console.error = originalError;
  });

  it('case1: all providers in cooldown → AllProvidersCooldownError (NOT TypeError)', async () => {
    const ts = Date.now();
    const primaryName = `test-cooldown-primary-${ts}`;
    const fallbackName = `test-cooldown-fallback-${ts}`;

    // Pre-cooldown both providers (5 min — simulates both in cooldown)
    cooldown(primaryName, 300_000);
    cooldown(fallbackName, 300_000);

    const primary = new MockSuccessProvider(primaryName);
    const fallback = new MockSuccessProvider(fallbackName);

    const gateway = new LLMGateway(
      primary,
      fallback,
      fallback as any,              // gatekeeper (unused in this path)
      5_000,                        // turnDeadlineMs
      3,                            // maxAttempts
      undefined,                    // resolver (unused when dynamicFlagProvider = false)
      () => Promise.resolve(false), // dynamicFlagProvider = OFF (singleton providers)
    );

    await assert.rejects(
      () => gateway.generate('test prompt'),
      (err: any) => {
        // Must be AllProvidersCooldownError — NOT a generic TypeError
        assert.ok(
          err instanceof AllProvidersCooldownError,
          `Expected AllProvidersCooldownError, got ${err?.constructor?.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
        // Error message must be clear and actionable
        assert.ok(
          err.message.includes('cooldown'),
          `Error message should mention "cooldown": "${err.message}"`,
        );
        // Must NOT be the old TypeError crash
        assert.ok(
          !err.message.includes('Cannot read properties of null'),
          'Should NOT be a TypeError: "Cannot read properties of null"',
        );
        // Must be classified as RATE_LIMIT (retryable) — not SERVER_ERROR
        assert.equal(err.category, ErrorCategory.RATE_LIMIT);
        assert.equal(err.retryable, true);
        return true;
      },
    );

    // Verify no provider was called (all skipped by shouldSkipProvider before inner loop)
    assert.equal(primary.callCount, 0, 'Primary provider should NOT have been called');
    assert.equal(fallback.callCount, 0, 'Fallback provider should NOT have been called');

    // Verify gateway stats recorded the error properly
    const stats = gateway.getStats();
    assert.equal(stats.errorLog.length, 1);
    assert.equal(stats.errorLog[0].provider, 'gateway');
    assert.equal(stats.errorLog[0].category, 'ALL_PROVIDERS_COOLDOWN');
  });

  it('case2: 429 on attempt 0 → cooldown → retry re-check skips (provider called ONCE, not 3x)', async () => {
    const ts = Date.now();
    const primaryName = `test-retry-primary-${ts}`;
    const fallbackName = `test-retry-fallback-${ts}`;

    const primary = new MockRateLimitedProvider(primaryName);
    const fallback = new MockRateLimitedProvider(fallbackName);

    const gateway = new LLMGateway(
      primary,
      fallback,
      fallback as any,
      5_000, // turnDeadlineMs
      3,     // maxAttempts
      undefined,
      () => Promise.resolve(false),
    );

    await assert.rejects(
      () => gateway.generate('test prompt'),
      (err: any) => {
        // Should throw a proper AIProviderError with RATE_LIMIT — NOT TypeError
        assert.ok(
          err instanceof AIProviderError,
          `Expected AIProviderError, got ${err?.constructor?.name}`,
        );
        assert.equal(err.category, ErrorCategory.RATE_LIMIT);
        // Must NOT be TypeError crash
        assert.ok(
          !err.message.includes('Cannot read properties of null'),
          'Should NOT crash with TypeError on null dereference',
        );
        return true;
      },
    );

    // KEY ASSERTION (Fix A.2): With the re-check, each provider should be called
    // only ONCE. Attempt 0: 429 → triggerCooldown. Attempt 1: re-check
    // shouldSkipProvider → true → break. Without the fix, each provider would
    // be called maxAttempts=3 times (wasting retries on an already-cooled
    // provider, burning backoff sleep time).
    assert.equal(
      primary.callCount, 1,
      `Primary should be called exactly 1 time (got ${primary.callCount}). Fix A.2 (re-check) should prevent wasted retries.`,
    );
    assert.equal(
      fallback.callCount, 1,
      `Fallback should be called exactly 1 time (got ${fallback.callCount}).`,
    );

    // Both providers should now be in cooldown (triggerCooldown was called)
    assert.equal(isCooldown(primaryName), true, 'Primary should be in cooldown');
    assert.equal(isCooldown(fallbackName), true, 'Fallback should be in cooldown');
  });

  it('case3: cooldown expires → provider becomes available → success', async () => {
    const ts = Date.now();
    const primaryName = `test-recovery-primary-${ts}`;
    const fallbackName = `test-recovery-fallback-${ts}`;

    // Primary: in cooldown (100ms) — will expire quickly
    cooldown(primaryName, 100);
    const primary = new MockSuccessProvider(primaryName);

    // Fallback: not in cooldown — always available
    const fallback = new MockSuccessProvider(fallbackName);

    const gateway = new LLMGateway(
      primary,
      fallback,
      fallback as any,
      5_000,
      3,
      undefined,
      () => Promise.resolve(false),
    );

    // Wait for primary cooldown to expire (100ms + margin)
    await new Promise((r) => setTimeout(r, 200));

    const response = await gateway.generate('test prompt');
    assert.equal(response.content, 'mock response');
    assert.equal(response.provider, primaryName);
    assert.equal(primary.callCount, 1, 'Primary should be called once (cooldown expired)');
    assert.equal(fallback.callCount, 0, 'Fallback should NOT be called');
  });
});
