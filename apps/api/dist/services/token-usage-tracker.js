/**
 * BAGIAN 1 — Token Usage Tracking
 *
 * In-memory tracking per-request (per-hour window) + persistent DB log.
 * - logTokenUsage: record successful LLM call (in-memory + DB)
 * - getUsageLastHour: aggregate stats (in-memory, for backward compat)
 * - queryUsage: flexible time-range aggregation (DB-backed)
 */
import { prisma } from '../infrastructure/prisma.js';
const WINDOW_MS = 60 * 60000; // 1 hour
const MAX_LOGS = 10000;
const logs = [];
export function logTokenUsage(entry) {
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
    const recentMinute = logs.filter(l => now - l.timestamp < 60000);
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
    // Persist to DB — fire-and-forget, never break the response path.
    // This is observability, not business logic: a DB hiccup here must not
    // cause user-facing failures or add latency to the LLM response.
    void persistTokenUsage(entry);
}
async function persistTokenUsage(entry) {
    try {
        await prisma.tokenUsageLog.create({
            data: {
                provider: entry.provider,
                role: entry.role ?? null,
                model: entry.model || null,
                inputTokens: entry.inputTokens,
                outputTokens: entry.outputTokens,
                costUsd: entry.costUsd,
                createdAt: new Date(entry.timestamp),
            },
        });
    }
    catch (err) {
        console.warn('[TokenTracker] Failed to persist token usage to DB', {
            provider: entry.provider,
            error: err.message,
        });
    }
}
export function getUsageLastHour() {
    const now = Date.now();
    const entries = logs.filter(l => now - l.timestamp <= WINDOW_MS);
    const summary = {
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
    const lastMinute = entries.filter(e => now - e.timestamp < 60000);
    summary.requestsPerMinute = lastMinute.length;
    // Time series (per minute, last hour)
    const minutes = new Map();
    for (let i = 0; i < 60; i++) {
        const minuteTs = now - (59 - i) * 60000;
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
export function validateTimeRange(query) {
    if (isNaN(query.from.getTime()) || isNaN(query.to.getTime())) {
        return 'from and to must be valid dates';
    }
    if (query.from >= query.to) {
        return 'from must be before to';
    }
    const maxRangeDays = 365;
    if (query.to.getTime() - query.from.getTime() > maxRangeDays * 24 * 60 * 60 * 1000) {
        return `range must not exceed ${maxRangeDays} days`;
    }
    return null;
}
/**
 * Flexible time-range aggregation from DB. Returns the same per-provider shape
 * as getUsageLastHour() for consistency, but for any range (day/week/month/historical).
 */
export async function queryUsage(range) {
    const rows = await prisma.tokenUsageLog.findMany({
        where: {
            createdAt: {
                gte: range.from,
                lte: range.to,
            },
        },
        select: {
            provider: true,
            inputTokens: true,
            outputTokens: true,
            costUsd: true,
        },
    });
    const result = {};
    for (const row of rows) {
        if (!result[row.provider]) {
            result[row.provider] = { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
        }
        const agg = result[row.provider];
        agg.requests++;
        agg.inputTokens += row.inputTokens;
        agg.outputTokens += row.outputTokens;
        agg.costUsd += row.costUsd ?? 0;
    }
    return result;
}
//# sourceMappingURL=token-usage-tracker.js.map