/**
 * BAGIAN 1 — Provider Cooldown
 *
 * Tracks rate-limit cooldown per AI provider (in-memory, per-process).
 * - cooldown('gemini', 300000) → sets 5min cooldown
 * - isCooldown('gemini') → boolean
 * - 429 responses trigger cooldown automatically
 * - Warn logged ONCE per cooldown window (no spam)
 */
const DEFAULT_COOLDOWN_MS = 5 * 60000; // 5 menit
const store = new Map();
export function cooldown(provider, durationMs = DEFAULT_COOLDOWN_MS) {
    const until = Date.now() + durationMs;
    store.set(provider, { until, warned: false });
}
export function isCooldown(provider) {
    const entry = store.get(provider);
    if (!entry)
        return false;
    if (Date.now() < entry.until)
        return true;
    store.delete(provider);
    return false;
}
export function getCooldownRemaining(provider) {
    const entry = store.get(provider);
    if (!entry)
        return 0;
    const remaining = entry.until - Date.now();
    return remaining > 0 ? remaining : 0;
}
/**
 * Called when a provider returns 429. Sets cooldown + logs warn once.
 */
export function triggerCooldown(provider, durationMs = DEFAULT_COOLDOWN_MS) {
    const entry = store.get(provider);
    const isNewOrExpired = !entry || Date.now() >= entry.until;
    cooldown(provider, durationMs);
    if (isNewOrExpired) {
        const mins = Math.round(durationMs / 60000);
        console.warn(`[Cooldown] Provider "${provider}" rate-limited (429) — cooldown ${mins} menit`);
    }
}
/**
 * Check cooldown and warn if still active. Returns true if provider should be skipped.
 */
export function shouldSkipProvider(provider) {
    if (isCooldown(provider)) {
        const remaining = getCooldownRemaining(provider);
        const entry = store.get(provider);
        if (entry && !entry.warned) {
            const secs = Math.ceil(remaining / 1000);
            console.warn(`[Cooldown] Provider "${provider}" still in cooldown (${secs}s remaining) — skipping`);
            entry.warned = true;
        }
        return true;
    }
    return false;
}
//# sourceMappingURL=provider-cooldown.js.map