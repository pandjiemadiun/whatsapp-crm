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

export class CircuitBreakerService {
  private state: CircuitState = 'closed';
  private failureCount: number = 0;
  private successCount: number = 0;
  private nextAttemptAt: number = 0;
  private readonly config: CircuitBreakerConfig;
  private readonly name: string;

  constructor(name: string, config?: Partial<CircuitBreakerConfig>) {
    this.name = name;
    this.config = {
      failureThreshold: 2,
      cooldownMs: 60_000, // 1 menit
      halfOpenSuccessThreshold: 1,
      ...config,
    };
  }

  /** Cek apakah circuit masih tertutup (bisa lanjut ke LLM). */
  isAvailable(): boolean {
    const now = Date.now();

    if (this.state === 'closed') return true;

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

  recordSuccess(): void {
    this.failureCount = 0;
    this.successCount++;

    if (this.state === 'half_open' && this.successCount >= this.config.halfOpenSuccessThreshold) {
      this.state = 'closed';
    }
  }

  recordFailure(): void {
    this.failureCount++;

    if (this.state === 'half_open') {
      this.trip();
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.trip();
    }
  }

  trip(): void {
    this.state = 'open';
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptAt = Date.now() + this.config.cooldownMs;
  }

  getMetrics(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    name: string;
  } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      name: this.name,
    };
  }

  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptAt = 0;
  }

  /** Hardcoded apology saat circuit terbuka — tidak perlu panggil LLM. */
  getFallbackMessage(): string {
    return 'Mohon maaf, sistem sedang sibuk. Pesan Anda akan disampaikan ke agen kami segera.';
  }

  /**
   * Wrap an async function with circuit breaker logic.
   * Jika circuit terbuka, langsung throw. Jika tertutup, jalankan fn
   * dan record success/failure.
   */
  async wrap<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.isAvailable()) {
      throw new Error(`Circuit breaker '${this.name}' is open`);
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }
}
