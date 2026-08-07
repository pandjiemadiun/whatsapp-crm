/**
 * BAGIAN 1 — Provider Cooldown
 *
 * Tracks rate-limit cooldown per AI provider (in-memory, per-process).
 * - cooldown('gemini', 300000) → sets 5min cooldown
 * - isCooldown('gemini') → boolean
 * - 429 responses trigger cooldown automatically
 * - Warn logged ONCE per cooldown window (no spam)
 */
export declare function cooldown(provider: string, durationMs?: number): void;
export declare function isCooldown(provider: string): boolean;
export declare function getCooldownRemaining(provider: string): number;
/**
 * Called when a provider returns 429. Sets cooldown + logs warn once.
 */
export declare function triggerCooldown(provider: string, durationMs?: number): void;
/**
 * Check cooldown and warn if still active. Returns true if provider should be skipped.
 */
export declare function shouldSkipProvider(provider: string): boolean;
//# sourceMappingURL=provider-cooldown.d.ts.map