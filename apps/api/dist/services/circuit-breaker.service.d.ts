/**
 * LLM Circuit Breaker — mencegah cascading failures saat AI provider down.
 *
 * State: CLOSED → OPEN (2 failures) → HALF_OPEN (after cooldown) → CLOSED
 *
 * Saat terbuka: kirim hardcoded apology + mark conversation untuk human takeover.
 */
export type CircuitState = 'closed' | 'open' | 'half_open';
export interface CircuitBreakerConfig {
    failureThreshold: number;
    cooldownMs: number;
    halfOpenSuccessThreshold: number;
}
export declare class CircuitBreakerService {
    private state;
    private failureCount;
    private successCount;
    private nextAttemptAt;
    private readonly config;
    private readonly name;
    constructor(name: string, config?: Partial<CircuitBreakerConfig>);
    /** Cek apakah circuit masih tertutup (bisa lanjut ke LLM). */
    isAvailable(): boolean;
    recordSuccess(): void;
    recordFailure(): void;
    trip(): void;
    getMetrics(): {
        state: CircuitState;
        failureCount: number;
        successCount: number;
        name: string;
    };
    reset(): void;
    /** Hardcoded apology saat circuit terbuka — tidak perlu panggil LLM. */
    getFallbackMessage(): string;
    /**
     * Wrap an async function with circuit breaker logic.
     * Jika circuit terbuka, langsung throw. Jika tertutup, jalankan fn
     * dan record success/failure.
     */
    wrap<T>(fn: () => Promise<T>): Promise<T>;
}
//# sourceMappingURL=circuit-breaker.service.d.ts.map