/**
 * BAGIAN 1 — Provider Cooldown
 *
 * Tracks rate-limit cooldown per (AI provider, role) pair (in-memory, per-process).
 * - cooldown('gemini', 'chat_primary', 300000) → sets 5min cooldown for gemini in chat_primary
 * - isCooldown('gemini', 'chat_primary') → boolean
 * - 429 responses trigger cooldown automatically
 * - Warn logged ONCE per cooldown window (no spam)
 */

const DEFAULT_COOLDOWN_MS = 5 * 60_000; // 5 menit

interface CooldownEntry {
  until: number;
  warned: boolean;
}

const store: Map<string, CooldownEntry> = new Map();

export function cooldown(provider: string, role: string, durationMs: number = DEFAULT_COOLDOWN_MS): void {
  const key = `${provider}:${role}`;
  const until = Date.now() + durationMs;
  store.set(key, { until, warned: false });
}

export function isCooldown(provider: string, role: string): boolean {
  const key = `${provider}:${role}`;
  const entry = store.get(key);
  if (!entry) return false;
  if (Date.now() < entry.until) return true;
  store.delete(key);
  return false;
}

export function getCooldownRemaining(provider: string, role: string): number {
  const key = `${provider}:${role}`;
  const entry = store.get(key);
  if (!entry) return 0;
  const remaining = entry.until - Date.now();
  return remaining > 0 ? remaining : 0;
}

/**
 * Called when a provider returns 429. Sets cooldown + logs warn once.
 */
export function triggerCooldown(provider: string, role: string, durationMs: number = DEFAULT_COOLDOWN_MS): void {
  const key = `${provider}:${role}`;
  const entry = store.get(key);
  const isNewOrExpired = !entry || Date.now() >= entry.until;

  cooldown(provider, role, durationMs);

  if (isNewOrExpired) {
    const mins = Math.round(durationMs / 60_000);
    console.warn(`[Cooldown] Provider "${provider}" (${role}) rate-limited (429) — cooldown ${mins} menit`);
  }
}

/**
 * Check cooldown and warn if still active. Returns true if provider should be skipped.
 */
export function shouldSkipProvider(provider: string, role: string): boolean {
  if (isCooldown(provider, role)) {
    const remaining = getCooldownRemaining(provider, role);
    const key = `${provider}:${role}`;
    const entry = store.get(key);
    if (entry && !entry.warned) {
      const secs = Math.ceil(remaining / 1000);
      console.warn(`[Cooldown] Provider "${provider}" (${role}) still in cooldown (${secs}s remaining) — skipping`);
      entry.warned = true;
    }
    return true;
  }
  return false;
}
