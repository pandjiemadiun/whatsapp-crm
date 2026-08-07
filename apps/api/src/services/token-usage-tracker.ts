/**
 * BAGIAN 1 — Token Usage Tracking
 *
 * In-memory tracking per-request (per-hour window).
 * - logRequest: record successful LLM call
 * - getUsageLastHour: aggregate stats
 */

export interface TokenLogEntry {
  timestamp: number;
  provider: string;
  model: string;
  intent: string;
  conversationId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface UsageSummary {
  totalRequests: number;
  totalTokens: number;
  totalCostUsd: number;
  perProvider: Record<string, {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
  perIntent: Record<string, {
    requests: number;
    tokens: number;
    costUsd: number;
  }>;
  requestsPerMinute: number;
  timeSeries: Array<{
    minute: string;
    requests: number;
    tokens: number;
  }>;
}

const WINDOW_MS = 60 * 60_000; // 1 hour
const MAX_LOGS = 10_000;

const logs: TokenLogEntry[] = [];

export function logTokenUsage(entry: TokenLogEntry): void {
  const now = Date.now();
  logs.push(entry);

  // Trim old entries
  while (logs.length > 0 && now - logs[0].timestamp > WINDOW_MS) {
    logs.shift();
  }

  // Cap total logs
  if (logs.length > MAX_LOGS) {
    logs.splice(0, logs.length - MAX_LOGS);
  }

  // Warn if approaching rate limit
  const recentMinute = logs.filter(l => now - l.timestamp < 60_000);
  const geminiRecent = recentMinute.filter(l => l.provider === 'gemini').length;
  const groqRecent = recentMinute.filter(l => l.provider === 'groq').length;

  const GEMINI_LIMIT = 12;
  const GROQ_LIMIT = 25;

  if (geminiRecent >= GEMINI_LIMIT * 0.8) {
    console.warn(`[TokenTracker] Gemini approaching rate limit: ${geminiRecent}/${GEMINI_LIMIT} req/min`);
  }
  if (groqRecent >= GROQ_LIMIT * 0.8) {
    console.warn(`[TokenTracker] Groq approaching rate limit: ${groqRecent}/${GROQ_LIMIT} req/min`);
  }
}

export function getUsageLastHour(): UsageSummary {
  const now = Date.now();
  const entries = logs.filter(l => now - l.timestamp <= WINDOW_MS);

  const summary: UsageSummary = {
    totalRequests: entries.length,
    totalTokens: entries.reduce((sum, e) => sum + e.totalTokens, 0),
    totalCostUsd: entries.reduce((sum, e) => sum + e.costUsd, 0),
    perProvider: {},
    perIntent: {},
    requestsPerMinute: 0,
    timeSeries: [],
  };

  // Per provider
  const providerSet = new Set(entries.map(e => e.provider));
  for (const provider of providerSet) {
    const providerEntries = entries.filter(e => e.provider === provider);
    summary.perProvider[provider] = {
      requests: providerEntries.length,
      inputTokens: providerEntries.reduce((sum, e) => sum + e.inputTokens, 0),
      outputTokens: providerEntries.reduce((sum, e) => sum + e.outputTokens, 0),
      costUsd: providerEntries.reduce((sum, e) => sum + e.costUsd, 0),
    };
  }

  // Per intent
  const intentSet = new Set(entries.map(e => e.intent));
  for (const intent of intentSet) {
    const intentEntries = entries.filter(e => e.intent === intent);
    summary.perIntent[intent] = {
      requests: intentEntries.length,
      tokens: intentEntries.reduce((sum, e) => sum + e.totalTokens, 0),
      costUsd: intentEntries.reduce((sum, e) => sum + e.costUsd, 0),
    };
  }

  // Requests per minute (last 60s)
  const lastMinute = entries.filter(e => now - e.timestamp < 60_000);
  summary.requestsPerMinute = lastMinute.length;

  // Time series (per minute, last hour)
  const minutes = new Map<string, { requests: number; tokens: number }>();
  for (let i = 0; i < 60; i++) {
    const minuteTs = now - (59 - i) * 60_000;
    const label = new Date(minuteTs).toISOString().slice(0, 16); // "YYYY-MM-DDTHH:mm"
    minutes.set(label, { requests: 0, tokens: 0 });
  }
  for (const e of entries) {
    const label = new Date(e.timestamp).toISOString().slice(0, 16);
    const existing = minutes.get(label);
    if (existing) {
      existing.requests++;
      existing.tokens += e.totalTokens;
    }
  }
  summary.timeSeries = Array.from(minutes.entries()).map(([minute, data]) => ({
    minute,
    requests: data.requests,
    tokens: data.tokens,
  }));

  return summary;
}
