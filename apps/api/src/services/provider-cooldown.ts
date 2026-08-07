/**
 * BAGIAN 1 — Provider Cooldown
 *
 * Tracks rate-limit cooldown per AI provider (in-memory, per-process).
 * - cooldown('gemini', 300000) → sets 5min cooldown
 * - isCooldown('gemini') → boolean
 * - 429 responses trigger cooldown automatically
 * - Warn logged ONCE per cooldown window (no spam)
 */

const DEFAULT_COOLDOWN_MS = 5 * 60_000; // 5 menit

interface CooldownEntry {
  until: number;
  warned: boolean;
}

const store: Map<string, CooldownEntry> = new Map();

export function cooldown(provider: string, durationMs: number = DEFAULT_COOLDOWN_MS): void {
  const until = Date.now() + durationMs;
  store.set(provider, { until, warned: false });
}

export function isCooldown(provider: string): boolean {
  const entry = store.get(provider);
  if (!entry) return false;
  if (Date.now() < entry.until) return true;
  store.delete(provider);
  return false;
}

export function getCooldownRemaining(provider: string): number {
  const entry = store.get(provider);
  if (!entry) return 0;
  const remaining = entry.until - Date.now();
  return remaining > 0 ? remaining : 0;
}

/**
 * Called when a provider returns 429. Sets cooldown + logs warn once.
 */
export function triggerCooldown(provider: string, durationMs: number = DEFAULT_COOLDOWN_MS): void {
  const entry = store.get(provider);
  const isNewOrExpired = !entry || Date.now() >= entry.until;

  cooldown(provider, durationMs);

  if (isNewOrExpired) {
    const mins = Math.round(durationMs / 60_000);
    console.warn(`[Cooldown] Provider "${provider}" rate-limited (429) — cooldown ${mins} menit`);
  }
}

/**
 * Check cooldown and warn if still active. Returns true if provider should be skipped.
 */
export function shouldSkipProvider(provider: string): boolean {
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
