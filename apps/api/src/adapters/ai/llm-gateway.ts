/**
 * LLMGateway — sole decision point for AI provider selection, retry,
 * circuit-breaker, timeout, fallback, and token accounting.
 *
 * Hot path: conversation.service → interpreter.ts / llmGateway.generate()
 *
 * Design (G2-B.1):
 *   - ONE owner for: provider selection, retry, timeout, circuit-breaker, fallback
 *   - Adapters are pure transport (no internal retry)
 *   - Primary = Gemini (primary speaker), Fallback = Groq, Gatekeeper = Groq
 *   - Circuit breaker: in-memory (threshold 5 per MESSAGE, 60s reset)
 *     recordFailure() is called ONCE per generate() call at exhaustion,
 *     NOT per provider attempt — so threshold=5 means "5 consecutive failed
 *     messages" regardless of how many providers/retries that spans.
 *   - Provider cooldown: delegated to provider-cooldown.ts (Redis-backed)
 *   - Turn deadline: 12s ceiling (per-attempt adapter timeout is 10s)
 *   - Retry: N=3 with exponential backoff + jitter on retryable errors
 *   - Token accounting: delegated to token-usage-tracker.ts
 *
 * GOWA HMAC is NOT implemented (owner decision D3 HOLD).
 * GOWA device_id is tenant identification only, NOT authentication.
 */
import {
  AIProvider,
  AIGenerateOptions,
  AIResponse,
  AIProviderError,
  ErrorCategory,
} from './types.js';
import { geminiAdapter } from './gemini.adapter.js';
import { groqAdapter } from './groq.adapter.js';
import { shouldSkipProvider, triggerCooldown } from '../../services/provider-cooldown.js';
import { logTokenUsage } from '../../services/token-usage-tracker.js';
import type { TokenLogEntry } from '../../services/token-usage-tracker.js';
import { configService } from '../../business/config.service.js';
import { aiProviderResolver } from '../../services/ai-provider-resolver.service.js';
import type { AIProviderResolverService } from '../../services/ai-provider-resolver.service.js';

const TURN_DEADLINE_MS = 12_000;
const MAX_ATTEMPTS = 3;
const GATEWAY_BREAKER_THRESHOLD = 5;
const GATEWAY_BREAKER_RESET_MS = 60_000;

export class CircuitOpenError extends AIProviderError {
  constructor(message: string) {
    super(message, ErrorCategory.SERVER_ERROR, 'circuit-breaker', undefined, true);
    this.name = 'CircuitOpenError';
  }
}

/**
 * Thrown when EVERY provider in every role was skipped (e.g. all in cooldown)
 * — lastError stays null because no provider was ever attempted.
 *
 * Before this error type (BUGFIX A.1): line 336 did `lastError!.category`
 * which threw a generic `TypeError: Cannot read properties of null`
 * that was misclassified by the interpreter as non-retryable infrastructure
 * failure, masking the real cause (transient 429 cooldown cascade).
 */
export class AllProvidersCooldownError extends AIProviderError {
  constructor(message: string) {
    super(message, ErrorCategory.RATE_LIMIT, 'gateway', undefined, true);
    this.name = 'AllProvidersCooldownError';
  }
}

export class LLMGateway {
  private primary: AIProvider;
  private fallback: AIProvider;
  private fallback2: AIProvider | undefined;
  private turnDeadlineMs: number;
  private maxAttempts: number;
  // Unit 3b: feature-flag-gated dynamic provider resolution (default OFF)
  private resolver: AIProviderResolverService;
  private dynamicFlagProvider: (() => Promise<boolean>) | undefined;
  private dynamicFlagCache: { value: boolean; ts: number } | null = null;

  /** In-memory gateway-level circuit breaker (one owner for AI boundary) */
  private breaker = {
    failures: 0,
    threshold: GATEWAY_BREAKER_THRESHOLD,
    resetAfterMs: GATEWAY_BREAKER_RESET_MS,
    openedAt: 0,
  };

  private stats = {
    primary: { success: 0, failed: 0 },
    fallback: { success: 0, failed: 0 },
    fallback_2: { success: 0, failed: 0 },
    errors: [] as { provider: string; category: string; timestamp: number }[],
  };

  constructor(
    primary: AIProvider = geminiAdapter,
    fallback: AIProvider = groqAdapter,
    turnDeadlineMs: number = TURN_DEADLINE_MS,
    maxAttempts: number = MAX_ATTEMPTS,
    resolver: AIProviderResolverService = aiProviderResolver,
    dynamicFlagProvider: (() => Promise<boolean>) | undefined = undefined,
    fallback2: AIProvider | undefined = undefined,
  ) {
    this.primary = primary;
    this.fallback = fallback;
    this.fallback2 = fallback2;
    this.turnDeadlineMs = turnDeadlineMs;
    this.maxAttempts = maxAttempts;
    this.resolver = resolver;
    this.dynamicFlagProvider = dynamicFlagProvider;
  }

  // ─── Unit 3b: feature-flag-gated dynamic provider resolution ────────────
  // Gate (default OFF): configService.getConfig('llm.useDynamicProviders') === 'true'.
  // TTL-cached so the OFF hot path pays no DB read per request. Tests may inject
  // `dynamicFlagProvider` to force ON/OFF without touching configService/system_settings.
  private readonly DYNAMIC_FLAG_TTL_MS = 30_000;

  /** Resolve the dynamic-provider flag. Absence of the key => OFF (never throws). */
  private async isDynamicProvidersEnabled(): Promise<boolean> {
    const now = Date.now();
    if (this.dynamicFlagCache && now - this.dynamicFlagCache.ts < this.DYNAMIC_FLAG_TTL_MS) {
      return this.dynamicFlagCache.value;
    }
    let enabled: boolean;
    if (this.dynamicFlagProvider) {
      enabled = await this.dynamicFlagProvider();
    } else {
      enabled = (await configService.getConfig('llm.useDynamicProviders')) === 'true';
    }
    this.dynamicFlagCache = { value: enabled, ts: now };
    return enabled;
  }

  /**
   * Resolve the primary/fallback provider lists for this request.
    * OFF (default): returns singleton lists -> OFF path runs UNCHANGED.
    * ON: reads active AIProviderConfig rows via the resolver (3a), highest-priority
    * first. Empty DB list for a role -> warn + fall back to the default singleton
    * list (customer chat is NOT disrupted; the cutover is safe by default).
    */
  private async resolveEffectiveProviders(): Promise<{ primaryList: AIProvider[]; fallbackList: AIProvider[]; fallback2List: AIProvider[] }> {
    if (!(await this.isDynamicProvidersEnabled())) {
      return { primaryList: [this.primary], fallbackList: [this.fallback], fallback2List: this.fallback2 ? [this.fallback2] : [] };
    }

    const primaryList = await this.resolver.getProvidersForRole('chat_primary');
    const fallbackList = await this.resolver.getProvidersForRole('chat_fallback');
    const fallback2List = await this.resolver.getProvidersForRole('chat_fallback_2');

    return {
      primaryList: primaryList.length > 0 ? primaryList : [this.primary],
      fallbackList: fallbackList.length > 0 ? fallbackList : [this.fallback],
      fallback2List: fallback2List.length > 0 ? fallback2List : (this.fallback2 ? [this.fallback2] : []),
    };
  }

  // ─── Circuit breaker (gateway-level, one owner) ─────────────────────────

  private isCircuitOpen(): boolean {
    if (this.breaker.failures >= this.breaker.threshold) {
      return Date.now() - this.breaker.openedAt < this.breaker.resetAfterMs;
    }
    return false;
  }

  private recordSuccess(): void {
    this.breaker.failures = 0;
    this.breaker.openedAt = 0;
  }

  private recordFailure(): void {
    this.breaker.failures++;
    if (this.breaker.failures >= this.breaker.threshold && this.breaker.openedAt === 0) {
      this.breaker.openedAt = Date.now();
    }
  }

  /** Synchronous snapshot of circuit state — used by message-processor for handoff */
  getCircuitBreakerMetrics() {
    return {
      name: 'llm-gateway',
      state: this.isCircuitOpen() ? 'open' : this.breaker.failures > 0 ? 'half-open' : 'closed',
      failures: this.breaker.failures,
      threshold: this.breaker.threshold,
      openedAt: this.breaker.openedAt,
    };
  }

  reset(): void {
    this.breaker = {
      failures: 0,
      threshold: GATEWAY_BREAKER_THRESHOLD,
      resetAfterMs: GATEWAY_BREAKER_RESET_MS,
      openedAt: 0,
    };
    this.stats = {
      primary: { success: 0, failed: 0 },
      fallback: { success: 0, failed: 0 },
      fallback_2: { success: 0, failed: 0 },
      errors: [],
    };
  }

  // ─── Retry helpers ──────────────────────────────────────────────────────

  private isRetryableError(error: unknown): boolean {
    if (error instanceof AIProviderError) {
      return (
        error.retryable ||
        error.category === ErrorCategory.RATE_LIMIT ||
        error.category === ErrorCategory.SERVER_ERROR ||
        error.category === ErrorCategory.NETWORK_TIMEOUT
      );
    }
    // Network errors / unknown are retryable at gateway level
    return true;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Exponential backoff with jitter — max 1s per backoff */
  private backoffDelay(attempt: number): number {
    const base = 100 * Math.pow(2, attempt);
    const capped = Math.min(base, 1000);
    return capped + Math.random() * 100;
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  /**
   * Generate content via primary provider with retry + fallback cascade.
   *
   * Flow:
   *   1. Check gateway circuit breaker → CircuitOpenError if open
   *   2. Try primary providers with N=3 retry attempts each
   *   3. If primary fails → try fallback providers with N=3 retry attempts each
   *   4. Log token usage on success
   *   5. Record ONE circuit-breaker failure for the entire call if all providers
   *      are exhausted (per-message counting: threshold=N means N consecutive
   *      failed messages, not N failed provider attempts)
   *   6. Record circuit-breaker success on first successful provider
   */
  async generate(
    prompt: string,
    options?: AIGenerateOptions,
    intent: string = 'general',
  ): Promise<AIResponse> {
    // ── Unit 3b: feature-flag-gated dynamic provider resolution (default OFF) ──
    // OFF (default): resolveEffectiveProviders() returns the original singletons,
    // and the circuit-breaker/retry/fallback loop below runs UNCHANGED.
    // ON: primary/fallback come from AIProviderConfig rows via the resolver (3a).
    const { primaryList, fallbackList, fallback2List } = await this.resolveEffectiveProviders();

    // Circuit breaker gate
    if (this.isCircuitOpen()) {
      throw new CircuitOpenError(
        'Gateway circuit breaker OPEN — AI providers exhausted',
      );
    }

    let lastError: AIProviderError | null = null;

    const roleLists: Array<{
      providers: AIProvider[];
      roleKey: 'primary' | 'fallback' | 'fallback_2';
    }> = [
      { providers: primaryList, roleKey: 'primary' },
      { providers: fallbackList, roleKey: 'fallback' },
      { providers: fallback2List, roleKey: 'fallback_2' },
    ];

    for (const { providers, roleKey } of roleLists) {
      const role = roleKey === 'primary' ? 'chat_primary' : roleKey === 'fallback' ? 'chat_fallback' : 'chat_fallback_2';
      for (const provider of providers) {
        const name = provider.getName();
        if (shouldSkipProvider(name, role)) {
          continue;
        }

        for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
          // Re-check cooldown on each retry — a provider that just returned
          // 429 is now in cooldown (triggerCooldown was called above), so
          // retrying it immediately is pointless. Break to the next provider.
          // This also catches the case where a provider exits cooldown DURING
          // the backoff sleep — it will be retried on a later message cycle.
          if (attempt > 0 && shouldSkipProvider(name, role)) {
            break;
          }

          try {
            const response = await this.executeWithDeadline(provider, prompt, options);

            // Success — update all stats
            this.stats[roleKey].success++;
            this.recordSuccess();

            // Token usage tracking
            logTokenUsage({
              timestamp: Date.now(),
              provider: response.provider,
              role: roleKey === 'primary' ? 'chat_primary' : roleKey === 'fallback' ? 'chat_fallback' : 'chat_fallback_2',
              model: response.model,
              intent,
              conversationId: options?.conversationId || 'unknown',
              inputTokens: response.tokens.input,
              outputTokens: response.tokens.output,
              totalTokens: response.tokens.input + response.tokens.output,
              costUsd: response.cost,
            } as TokenLogEntry);

            return response;
          } catch (err) {
            const error = this.normalizeError(err, name);
            lastError = error;

            // Report rate-limited providers to cooldown router
            if (error.category === ErrorCategory.RATE_LIMIT || error.statusCode === 429) {
              triggerCooldown(
                error.provider || name,
                role,
                error.retryAfter ? error.retryAfter * 1000 : undefined,
              );

              // On 429/RATE_LIMIT: trigger cooldown and move to the NEXT provider
              // in the SAME role's list immediately (it just told us to slow down).
              // Only when there are 2+ providers in this role (dynamic ON path) —
              // with a single provider (OFF path / singleton) the original
              // retry-with-backoff behavior is preserved so the OFF path stays
              // completely unaffected.
              // NOTE: recordFailure() is NOT called here — it is called ONCE
              // per generate() call at the final exhaustion point (per-message
              // circuit breaker counting), NOT per provider attempt.
              if (providers.length > 1) {
                this.stats[roleKey].failed++;
                break; // rate-limited → next provider in same role
              }
            }

            const retryable = this.isRetryableError(error);
            if (!retryable) {
              this.stats[roleKey].failed++;
              // NOTE: recordFailure() deferred to final exhaustion point (per-message CB).
              break; // non-retryable → move to next provider in same role
            }

            if (attempt < this.maxAttempts - 1) {
              await this.sleep(this.backoffDelay(attempt));
            } else {
              this.stats[roleKey].failed++;
              // NOTE: recordFailure() deferred to final exhaustion point (per-message CB).
            }
          }
        }
      }
    }

    // All providers exhausted — record ONE circuit-breaker failure for this
    // entire generate() call (per-message counting, not per-provider-attempt).
    // This ensures threshold=N means "N consecutive failed messages" rather
    // than "N failed provider attempts" — essential for multi-provider rotation
    // where one failed message can attempt 6+ providers × 3 retries = 18 LLM calls.
    this.recordFailure();

    // All providers exhausted
    if (lastError === null) {
      // Every provider was skipped (e.g., all in cooldown) — none was ever
      // attempted, so lastError was never set. Throw a CLEAR, actionable error
      // instead of crashing with `lastError!.category` (TypeError on null).
      this.stats.errors.push({
        provider: 'gateway',
        category: 'ALL_PROVIDERS_COOLDOWN',
        timestamp: Date.now(),
      });
      throw new AllProvidersCooldownError(
        'All LLM providers are in cooldown — none were available to attempt. ' +
        'This is a transient rate-limit condition (HTTP 429 cascade), not a system error.',
      );
    }

    this.stats.errors.push({
      provider: lastError.provider,
      category: lastError.category,
      timestamp: Date.now(),
    });

    throw lastError;
  }

  /**
   * Execute provider.generate within a turn deadline.
   * The adapter has its own 10s internal timeout; this 12s ceiling is a safety net
   * for edge-case hangs (e.g. response parsing, network stall past adapter timeout).
   */
  private async executeWithDeadline(
    provider: AIProvider,
    prompt: string,
    options?: AIGenerateOptions,
  ): Promise<AIResponse> {
    let timer: NodeJS.Timeout;
    const deadlinePromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new AIProviderError(
            `Gateway turn deadline exceeded (${this.turnDeadlineMs}ms)`,
            ErrorCategory.NETWORK_TIMEOUT,
            'gateway',
            undefined,
            true,
          ),
        );
      }, this.turnDeadlineMs);
    });

    try {
      return await Promise.race([provider.generate(prompt, options), deadlinePromise]);
    } finally {
      clearTimeout(timer!);
    }
  }

  private normalizeError(err: unknown, providerName: string): AIProviderError {
    if (err instanceof AIProviderError) return err;
    if (err instanceof Error) {
      return new AIProviderError(
        err.message,
        ErrorCategory.UNKNOWN,
        providerName,
        undefined,
        true,
      );
    }
    return new AIProviderError(
      'Unknown error from provider',
      ErrorCategory.UNKNOWN,
      providerName,
      undefined,
      true,
    );
  }

  // ─── Health & introspection (admin) ─────────────────────────────────────

  isGatewayCircuitOpen(): boolean {
    return this.isCircuitOpen();
  }

  getStats() {
    return {
      primary: this.stats.primary,
      fallback: this.stats.fallback,
      fallback_2: this.fallback2 ? this.stats.fallback_2 : undefined,
      errorLog: this.stats.errors.slice(-10),
      circuitBreaker: this.getCircuitBreakerMetrics(),
    };
  }

  getProviders() {
    return {
      primary: this.primary.getName(),
      fallback: this.fallback.getName(),
      fallback_2: this.fallback2 ? this.fallback2.getName() : undefined,
    };
  }

  async checkHealth() {
    const [primaryHealthy, fallbackHealthy] = await Promise.allSettled([
      this.primary.isHealthy?.() ?? Promise.resolve(true),
      this.fallback.isHealthy?.() ?? Promise.resolve(true),
    ]);
    return {
      primary: primaryHealthy.status === 'fulfilled' ? primaryHealthy.value : false,
      fallback: fallbackHealthy.status === 'fulfilled' ? fallbackHealthy.value : false,
    };
  }
}

export const llmGateway = new LLMGateway();
