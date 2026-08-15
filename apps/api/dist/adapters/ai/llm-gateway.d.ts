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
export declare class CircuitOpenError extends AIProviderError {
    constructor(message: string);
}
export declare class LLMGateway {
    private primary;
    private fallback;
    private gatekeeper;
    private turnDeadlineMs;
    private maxAttempts;
    /** In-memory gateway-level circuit breaker (one owner for AI boundary) */
    private breaker;
    private stats;
    constructor(primary?: AIProvider, fallback?: AIProvider, gatekeeper?: AIProvider & {
        extractIntent(message: string, contextSummary?: string): Promise<ExtractedIntent>;
    }, turnDeadlineMs?: number, maxAttempts?: number);
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