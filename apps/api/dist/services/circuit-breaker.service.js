/**
 * LLM Circuit Breaker — mencegah cascading failures saat AI provider down.
 *
 * State: CLOSED → OPEN (2 failures) → HALF_OPEN (after cooldown) → CLOSED
 *
 * Saat terbuka: kirim hardcoded apology + mark conversation untuk human takeover.
 */
export class CircuitBreakerService {
    constructor(name, config) {
        this.state = 'closed';
        this.failureCount = 0;
        this.successCount = 0;
        this.nextAttemptAt = 0;
        this.name = name;
        this.config = {
            failureThreshold: 2,
            cooldownMs: 60000, // 1 menit
            halfOpenSuccessThreshold: 1,
            ...config,
        };
    }
    /** Cek apakah circuit masih tertutup (bisa lanjut ke LLM). */
    isAvailable() {
        const now = Date.now();
        if (this.state === 'closed')
            return true;
        if (this.state === 'open') {
            if (now >= this.nextAttemptAt) {
                this.state = 'half_open';
                this.successCount = 0;
                return true; // coba satu kali
            }
            return false;
        }
        // half_open — sudah tersedia untuk dicoba
        return true;
    }
    recordSuccess() {
        this.failureCount = 0;
        this.successCount++;
        if (this.state === 'half_open' && this.successCount >= this.config.halfOpenSuccessThreshold) {
            this.state = 'closed';
        }
    }
    recordFailure() {
        this.failureCount++;
        if (this.state === 'half_open') {
            this.trip();
        }
        else if (this.failureCount >= this.config.failureThreshold) {
            this.trip();
        }
    }
    trip() {
        this.state = 'open';
        this.failureCount = 0;
        this.successCount = 0;
        this.nextAttemptAt = Date.now() + this.config.cooldownMs;
    }
    getMetrics() {
        return {
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            name: this.name,
        };
    }
    reset() {
        this.state = 'closed';
        this.failureCount = 0;
        this.successCount = 0;
        this.nextAttemptAt = 0;
    }
    /** Hardcoded apology saat circuit terbuka — tidak perlu panggil LLM. */
    getFallbackMessage() {
        return 'Mohon maaf, sistem sedang sibuk. Pesan Anda akan disampaikan ke agen kami segera.';
    }
    /**
     * Wrap an async function with circuit breaker logic.
     * Jika circuit terbuka, langsung throw. Jika tertutup, jalankan fn
     * dan record success/failure.
     */
    async wrap(fn) {
        if (!this.isAvailable()) {
            throw new Error(`Circuit breaker '${this.name}' is open`);
        }
        try {
            const result = await fn();
            this.recordSuccess();
            return result;
        }
        catch (err) {
            this.recordFailure();
            throw err;
        }
    }
}
//# sourceMappingURL=circuit-breaker.service.js.map