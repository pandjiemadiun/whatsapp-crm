/**
 * LLMGateway — sole decision point for AI provider selection, retry,
 * circuit-breaker, timeout, fallback, and token accounting.
 *
 * Hot path: conversation.service → interpreter.ts / reasoning.ts → llmGateway.generate()
 *
 * Design (G2-B.1):
 *   - ONE owner for: provider selection, retry, timeout, circuit-breaker, fallback
 *   - Adapters are pure transport (no internal retry)
 *   - Primary = Gemini (primary speaker), Fallback = Groq, Gatekeeper = Groq
 *   - Circuit breaker: in-memory (threshold 5, 60s reset)
 *   - Provider cooldown: delegated to provider-cooldown.ts (Redis-backed)
 *   - Turn deadline: 12s ceiling (per-attempt adapter timeout is 10s)
 *   - Retry: N=3 with exponential backoff + jitter on retryable errors
 *   - Token accounting: delegated to token-usage-tracker.ts
 *
 * GOWA HMAC is NOT implemented (owner decision D3 HOLD).
 * GOWA device_id is tenant identification only, NOT authentication.
 */
import { AIProviderError, ErrorCategory, } from './types.js';
import { geminiAdapter } from './gemini.adapter.js';
import { groqAdapter } from './groq.adapter.js';
import { shouldSkipProvider, triggerCooldown } from '../../services/provider-cooldown.js';
import { logTokenUsage } from '../../services/token-usage-tracker.js';
const TURN_DEADLINE_MS = 12000;
const MAX_ATTEMPTS = 3;
const GATEWAY_BREAKER_THRESHOLD = 5;
const GATEWAY_BREAKER_RESET_MS = 60000;
export class CircuitOpenError extends AIProviderError {
    constructor(message) {
        super(message, ErrorCategory.SERVER_ERROR, 'circuit-breaker', undefined, true);
        this.name = 'CircuitOpenError';
    }
}
export class LLMGateway {
    constructor(primary = geminiAdapter, fallback = groqAdapter, gatekeeper = groqAdapter, turnDeadlineMs = TURN_DEADLINE_MS, maxAttempts = MAX_ATTEMPTS) {
        /** In-memory gateway-level circuit breaker (one owner for AI boundary) */
        this.breaker = {
            failures: 0,
            threshold: GATEWAY_BREAKER_THRESHOLD,
            resetAfterMs: GATEWAY_BREAKER_RESET_MS,
            openedAt: 0,
        };
        this.stats = {
            primary: { success: 0, failed: 0 },
            fallback: { success: 0, failed: 0 },
            errors: [],
        };
        this.primary = primary;
        this.fallback = fallback;
        this.gatekeeper = gatekeeper;
        this.turnDeadlineMs = turnDeadlineMs;
        this.maxAttempts = maxAttempts;
    }
    // ─── Circuit breaker (gateway-level, one owner) ─────────────────────────
    isCircuitOpen() {
        if (this.breaker.failures >= this.breaker.threshold) {
            return Date.now() - this.breaker.openedAt < this.breaker.resetAfterMs;
        }
        return false;
    }
    recordSuccess() {
        this.breaker.failures = 0;
        this.breaker.openedAt = 0;
    }
    recordFailure() {
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
    reset() {
        this.breaker = {
            failures: 0,
            threshold: GATEWAY_BREAKER_THRESHOLD,
            resetAfterMs: GATEWAY_BREAKER_RESET_MS,
            openedAt: 0,
        };
        this.stats = {
            primary: { success: 0, failed: 0 },
            fallback: { success: 0, failed: 0 },
            errors: [],
        };
    }
    // ─── Retry helpers ──────────────────────────────────────────────────────
    isRetryableError(error) {
        if (error instanceof AIProviderError) {
            return (error.retryable ||
                error.category === ErrorCategory.RATE_LIMIT ||
                error.category === ErrorCategory.SERVER_ERROR ||
                error.category === ErrorCategory.NETWORK_TIMEOUT);
        }
        // Network errors / unknown are retryable at gateway level
        return true;
    }
    async sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    /** Exponential backoff with jitter — max 1s per backoff */
    backoffDelay(attempt) {
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
     *   2. Try primary (Gemini) with N=3 retry attempts
     *   3. If primary fails → try fallback (Groq) with N=3 retry attempts
     *   4. Log token usage on success
     *   5. Record success/failure for circuit breaker stats
     */
    async generate(prompt, options, intent = 'general') {
        // Circuit breaker gate
        if (this.isCircuitOpen()) {
            throw new CircuitOpenError('Gateway circuit breaker OPEN — AI providers exhausted');
        }
        const primaryName = this.primary.getName();
        const fallbackName = this.fallback.getName();
        let lastError = null;
        const providers = [
            { name: primaryName, provider: this.primary, key: 'primary' },
            { name: fallbackName, provider: this.fallback, key: 'fallback' },
        ];
        for (const { name, provider, key } of providers) {
            // Per-provider cooldown via provider-cooldown service
            if (shouldSkipProvider(name)) {
                continue;
            }
            for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
                try {
                    const response = await this.executeWithDeadline(provider, prompt, options);
                    // Success — update all stats
                    this.stats[key].success++;
                    this.recordSuccess();
                    // Token usage tracking
                    logTokenUsage({
                        timestamp: Date.now(),
                        provider: response.provider,
                        model: response.model,
                        intent,
                        conversationId: options?.conversationId || 'unknown',
                        inputTokens: response.tokens.input,
                        outputTokens: response.tokens.output,
                        totalTokens: response.tokens.input + response.tokens.output,
                        costUsd: response.cost,
                    });
                    return response;
                }
                catch (err) {
                    const error = this.normalizeError(err, name);
                    lastError = error;
                    // Report rate-limited keys to cooldown router
                    if (error.category === ErrorCategory.RATE_LIMIT || error.statusCode === 429) {
                        triggerCooldown(error.provider || name, error.retryAfter ? error.retryAfter * 1000 : undefined);
                    }
                    const retryable = this.isRetryableError(error);
                    if (!retryable) {
                        this.stats[key].failed++;
                        this.recordFailure();
                        break; // non-retryable → move to next provider
                    }
                    if (attempt < this.maxAttempts - 1) {
                        await this.sleep(this.backoffDelay(attempt));
                    }
                    else {
                        this.stats[key].failed++;
                        this.recordFailure();
                    }
                }
            }
        }
        // All providers exhausted
        this.stats.errors.push({
            provider: lastError?.provider || 'gateway',
            category: lastError.category,
            timestamp: Date.now(),
        });
        if (lastError)
            throw lastError;
        throw new AIProviderError('All LLM providers exhausted', ErrorCategory.SERVER_ERROR, 'all-providers-exhausted');
    }
    /**
     * Execute provider.generate within a turn deadline.
     * The adapter has its own 10s internal timeout; this 12s ceiling is a safety net
     * for edge-case hangs (e.g. response parsing, network stall past adapter timeout).
     */
    async executeWithDeadline(provider, prompt, options) {
        let timer;
        const deadlinePromise = new Promise((_, reject) => {
            timer = setTimeout(() => {
                reject(new AIProviderError(`Gateway turn deadline exceeded (${this.turnDeadlineMs}ms)`, ErrorCategory.NETWORK_TIMEOUT, 'gateway', undefined, true));
            }, this.turnDeadlineMs);
        });
        try {
            return await Promise.race([provider.generate(prompt, options), deadlinePromise]);
        }
        finally {
            clearTimeout(timer);
        }
    }
    normalizeError(err, providerName) {
        if (err instanceof AIProviderError)
            return err;
        if (err instanceof Error) {
            return new AIProviderError(err.message, ErrorCategory.UNKNOWN, providerName, undefined, true);
        }
        return new AIProviderError('Unknown error from provider', ErrorCategory.UNKNOWN, providerName, undefined, true);
    }
    /**
     * Fast Intent & Entity Gatekeeper via Groq (gatekeeper provider).
     * Returns fallback intent on failure — never throws.
     */
    async extractIntent(message, contextSummary) {
        try {
            return await this.gatekeeper.extractIntent(message, contextSummary);
        }
        catch {
            return {
                intent: 'COMPLEX_CONVERSATION',
                confidence: 0.3,
                entities: {},
                reasoning: 'Gatekeeper error fallback',
            };
        }
    }
    // ─── Health & introspection (admin) ─────────────────────────────────────
    isGatewayCircuitOpen() {
        return this.isCircuitOpen();
    }
    getStats() {
        return {
            primary: this.stats.primary,
            fallback: this.stats.fallback,
            errorLog: this.stats.errors.slice(-10),
            circuitBreaker: this.getCircuitBreakerMetrics(),
        };
    }
    getProviders() {
        return {
            primary: this.primary.getName(),
            fallback: this.fallback.getName(),
            gatekeeper: this.gatekeeper.getName(),
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
//# sourceMappingURL=llm-gateway.js.map