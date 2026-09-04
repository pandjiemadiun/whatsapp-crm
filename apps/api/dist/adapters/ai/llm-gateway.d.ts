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
import { AIProvider, AIGenerateOptions, AIResponse, AIProviderError, ExtractedIntent } from './types.js';
import type { AIProviderResolverService } from '../../services/ai-provider-resolver.service.js';
export declare class CircuitOpenError extends AIProviderError {
    constructor(message: string);
}
export declare class LLMGateway {
    private primary;
    private fallback;
    private gatekeeper;
    private turnDeadlineMs;
    private maxAttempts;
    private resolver;
    private dynamicFlagProvider;
    private dynamicFlagCache;
    /** In-memory gateway-level circuit breaker (one owner for AI boundary) */
    private breaker;
    private stats;
    constructor(primary?: AIProvider, fallback?: AIProvider, gatekeeper?: AIProvider & {
        extractIntent(message: string, contextSummary?: string): Promise<ExtractedIntent>;
    }, turnDeadlineMs?: number, maxAttempts?: number, resolver?: AIProviderResolverService, dynamicFlagProvider?: (() => Promise<boolean>) | undefined);
    private readonly DYNAMIC_FLAG_TTL_MS;
    /** Resolve the dynamic-provider flag. Absence of the key => OFF (never throws). */
    private isDynamicProvidersEnabled;
    /**
     * Resolve the primary/fallback provider lists for this request.
     * OFF (default): returns singleton lists -> OFF path runs UNCHANGED.
     * ON: reads active AIProviderConfig rows via the resolver (3a), highest-priority
     * first. Empty DB list for a role -> warn + fall back to the default singleton
     * list (customer chat is NOT disrupted; the cutover is safe by default).
     *
     * NOTE: the gatekeeper is intentionally NOT resolved here. extractIntent is a
     * GroqAdapter-specific method (groq.adapter.ts:329) — not on AIProvider and
     * not implemented by the Unit-2 generic adapters — so swapping the gatekeeper
     * would silently degrade intent extraction (every message -> COMPLEX_CONVERSATION).
     * Unit 5 chose Option B: gatekeeper stays pinned to the groqAdapter singleton
     * and `chat_gatekeeper` AIProviderConfig rows are cosmetic for now.
     */
    private resolveEffectiveProviders;
    private isCircuitOpen;
    private recordSuccess;
    private recordFailure;
    /** Synchronous snapshot of circuit state — used by message-processor for handoff */
    getCircuitBreakerMetrics(): {
        name: string;
        state: string;
        failures: number;
        threshold: number;
        openedAt: number;
    };
    reset(): void;
    private isRetryableError;
    private sleep;
    /** Exponential backoff with jitter — max 1s per backoff */
    private backoffDelay;
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
    generate(prompt: string, options?: AIGenerateOptions, intent?: string): Promise<AIResponse>;
    /**
     * Execute provider.generate within a turn deadline.
     * The adapter has its own 10s internal timeout; this 12s ceiling is a safety net
     * for edge-case hangs (e.g. response parsing, network stall past adapter timeout).
     */
    private executeWithDeadline;
    private normalizeError;
    /**
     * Fast Intent & Entity Gatekeeper via Groq (gatekeeper provider).
     * Returns fallback intent on failure — never throws.
     *
     * Unit 5 decision — Option B: this is the resolved `this.gatekeeper`
     * singleton and is NOT swapped by resolveEffectiveProviders(). extractIntent
     * is GroqAdapter-specific (groq.adapter.ts:329) and not on the AIProvider
     * interface, so resolving it from a `chat_gatekeeper` AIProviderConfig row
     * would either require adding extractIntent to the shared interface
     * (Option A) or implementing Groq-style intent extraction on every adapter.
     * Option B was chosen to avoid a silent COMPLEX_CONVERSATION-for-everything
     * regression (the Unit 3b bug) and to keep the shared interface clean.
     * `chat_gatekeeper` rows are therefore cosmetic for now.
     */
    extractIntent(message: string, contextSummary?: string): Promise<ExtractedIntent>;
    isGatewayCircuitOpen(): boolean;
    getStats(): {
        primary: {
            success: number;
            failed: number;
        };
        fallback: {
            success: number;
            failed: number;
        };
        errorLog: {
            provider: string;
            category: string;
            timestamp: number;
        }[];
        circuitBreaker: {
            name: string;
            state: string;
            failures: number;
            threshold: number;
            openedAt: number;
        };
    };
    getProviders(): {
        primary: string;
        fallback: string;
        gatekeeper: string;
    };
    checkHealth(): Promise<{
        primary: boolean;
        fallback: boolean;
    }>;
}
export declare const llmGateway: LLMGateway;
//# sourceMappingURL=llm-gateway.d.ts.map