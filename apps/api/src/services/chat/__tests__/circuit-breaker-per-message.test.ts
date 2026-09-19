/**
 * FIX-GATEWAY-CIRCUIT-BREAKER-PER-MESSAGE — Verification Script
 *
 * Proof 1: 1 message with ALL providers timeout → recordFailure() called exactly 1x
 * Proof 2: 5 messages in a row all failing → circuit opens on message 5, NOT message 1
 * Proof 3: Successful provider → recordSuccess() called, circuit stays closed
 * Proof 4: 1 provider timeout + 1 success → recordFailure=0, recordSuccess=1
 * Proof 5: Non-retryable error across all providers → recordFailure=1 per message
 *
 * Uses Jest with mocked gateway providers to count recordFailure() calls.
 * sleep() is mocked to be instant (no real backoff delays).
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { LLMGateway, CircuitOpenError } from '../../../adapters/ai/llm-gateway.js';
import { AIProviderError, ErrorCategory } from '../../../adapters/ai/types.js';

// ─── Mock providers ───────────────────────────────────────────────────────────

function makeTimeoutProvider(name: string): any {
  return {
    getName: () => name,
    generate: jest.fn().mockRejectedValue(
      new AIProviderError('Timeout', ErrorCategory.NETWORK_TIMEOUT, name, undefined, true) as never
    ),
  };
}

function makeSuccessProvider(name: string): any {
  const provider = {
    getName: () => name,
    generate: jest.fn(),
  };
  provider.generate.mockResolvedValue({
    content: '{"ok": true}',
    provider: name,
    model: 'test',
    tokens: { input: 10, output: 5 },
    cost: 0,
  } as never);
  return provider;
}

function makeInvalidProvider(name: string): any {
  return {
    getName: () => name,
    generate: jest.fn().mockRejectedValue(
      new AIProviderError('Invalid response', ErrorCategory.SERVER_ERROR, name, undefined, false) as never
    ),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FIX-GATEWAY-CIRCUIT-BREAKER-PER-MESSAGE', () => {
  let gateway: LLMGateway;

  beforeEach(() => {
    // Mock sleep to be instant — real backoff delays would make tests slow
    (gateway as any) = undefined; // reset
    gateway = new LLMGateway(
      makeTimeoutProvider('Internal LLM') as any,
      makeTimeoutProvider('B.ai') as any,
      12_000,
      3,
      undefined,
      undefined,
      makeTimeoutProvider('Mistral') as any,
    );
    // Spy on sleep to make it instant
    jest.spyOn(gateway as any, 'sleep').mockResolvedValue(undefined);
  });

  it('PROOF 1: 1 message with ALL providers timeout → recordFailure() called EXACTLY 1x (not 6x)', async () => {
    const recordFailureSpy = jest.spyOn(gateway as any, 'recordFailure');

    try {
      await gateway.generate('test prompt', { intent: 'test' });
      fail('Should have thrown');
    } catch (e) {
      // Expected — all providers timeout
    }

    // OLD behavior: 6 recordFailure() calls (1 per provider)
    // NEW behavior: 1 recordFailure() call (at final exhaustion point)
    expect(recordFailureSpy).toHaveBeenCalledTimes(1);
  });

  it('PROOF 2: 5 messages in a row all failing → circuit opens on message 5, NOT message 1', async () => {
    const recordFailureSpy = jest.spyOn(gateway as any, 'recordFailure');

    // Messages 1-4: all fail, circuit should NOT open (failures=1..4, threshold=5)
    for (let i = 1; i <= 4; i++) {
      const before = (gateway as any).breaker.failures;
      try {
        await gateway.generate('msg ' + i, { intent: 'test' });
        fail('Should have thrown for message ' + i);
      } catch (e) {
        // Expected
      }
      const after = (gateway as any).breaker.failures;
      // Each message adds EXACTLY 1 failure (not 6)
      expect(after).toBe(before + 1);
      // Circuit should NOT be open until 5 failures
      expect(gateway.isGatewayCircuitOpen()).toBe(false);
    }

    // After 4 messages: 4 recordFailure() calls, circuit still closed
    expect(recordFailureSpy).toHaveBeenCalledTimes(4);
    expect((gateway as any).breaker.failures).toBe(4);
    expect(gateway.isGatewayCircuitOpen()).toBe(false);

    // Message 5: fails, circuit should now open (failures=5 = threshold)
    try {
      await gateway.generate('msg 5', { intent: 'test' });
      fail('Should have thrown for message 5');
    } catch (e) {
      // Expected
    }

    expect(recordFailureSpy).toHaveBeenCalledTimes(5);
    expect((gateway as any).breaker.failures).toBe(5);
    expect(gateway.isGatewayCircuitOpen()).toBe(true);

    // Message 6: circuit is OPEN — should throw CircuitOpenError immediately
    // recordFailure NOT called because circuit is open (check at line 268)
    await expect(gateway.generate('msg 6 (circuit open)', { intent: 'test' }))
      .rejects.toThrow(CircuitOpenError);

    // No additional recordFailure() call — circuit was already open
    expect(recordFailureSpy).toHaveBeenCalledTimes(5);
  });

  it('PROOF 3: Successful provider → recordSuccess() called, circuit stays closed', async () => {
    const successGateway = new LLMGateway(
      makeSuccessProvider('gemini') as any,
      makeTimeoutProvider('groq') as any,
    );
    jest.spyOn(successGateway as any, 'sleep').mockResolvedValue(undefined);

    const recordFailureSpy = jest.spyOn(successGateway as any, 'recordFailure');
    const recordSuccessSpy = jest.spyOn(successGateway as any, 'recordSuccess');

    await successGateway.generate('success test', { intent: 'test' });

    expect(recordFailureSpy).toHaveBeenCalledTimes(0);
    expect(recordSuccessSpy).toHaveBeenCalledTimes(1);
    expect(successGateway.isGatewayCircuitOpen()).toBe(false);
  });

  it('PROOF 4: Primary timeout + fallback success → recordFailure=0, recordSuccess=1', async () => {
    const mixedGateway = new LLMGateway(
      makeTimeoutProvider('gemini') as any,
      makeSuccessProvider('groq') as any,
    );
    jest.spyOn(mixedGateway as any, 'sleep').mockResolvedValue(undefined);

    const recordFailureSpy = jest.spyOn(mixedGateway as any, 'recordFailure');
    const recordSuccessSpy = jest.spyOn(mixedGateway as any, 'recordSuccess');

    await mixedGateway.generate('mixed test', { intent: 'test' });

    // No full exhaustion — primary fails (per-attempt), fallback succeeds
    // recordFailure should NOT be called (deferred to exhaustion, which doesn't happen)
    expect(recordFailureSpy).toHaveBeenCalledTimes(0);
    expect(recordSuccessSpy).toHaveBeenCalledTimes(1);
    expect(mixedGateway.isGatewayCircuitOpen()).toBe(false);
  });

  it('PROOF 5: Non-retryable error (invalid response) across all providers → recordFailure=1 per message', async () => {
    const invalidGateway = new LLMGateway(
      makeInvalidProvider('provider1') as any,
      makeInvalidProvider('provider2') as any,
      12_000,
      3,
      undefined,
      undefined,
    );
    jest.spyOn(invalidGateway as any, 'sleep').mockResolvedValue(undefined);

    const recordFailureSpy = jest.spyOn(invalidGateway as any, 'recordFailure');

    try {
      await invalidGateway.generate('invalid test', { intent: 'test' });
      fail('Should have thrown');
    } catch (e) {
      // Expected
    }

    // Non-retryable errors used to cause 3 recordFailure() (one per provider)
    // Now: 1 recordFailure() at final exhaustion point
    expect(recordFailureSpy).toHaveBeenCalledTimes(1);
  });
});
