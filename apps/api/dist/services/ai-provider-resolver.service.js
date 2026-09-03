/**
 * AIProviderResolverService — Unit 3a
 *
 * Pure data-read layer: reads active AIProviderConfig rows for a given role
 * (ordered by priority, highest first) and instantiates the matching Unit-2
 * adapters (OpenAICompatibleAdapter / GeminiShimAdapter) from baseUrl/apiKey/model.
 *
 * - apiKey arrives PLAINTEXT here: the Prisma $use field-encryption middleware
 *   (SENSITIVE_FIELDS: AIProviderConfig.apiKey, apps/api/src/infrastructure/prisma.ts)
 *   decrypts on read automatically.
 * - NOT wired into LLMGateway yet (Unit 3b). This module has no production caller
 *   in 3a — it is a standalone, injectable data layer.
 * - Short TTL cache (mirrors getAiDefaults, ai-config.ts:41, 30s) so the
 *   per-request cutover path in Unit 3b does not hit the DB on every call.
 *
 * Design notes:
 *   - priority ordering: HIGHER `priority` number = tried first (matches the seed
 *     script convention, scripts/seed-ai-providers-from-env.mts, where the first
 *     env key gets `priority = groqKeys.length`).
 *   - Unknown `format` → throws a clear error (fail loud, never silently skip a
 *     misconfigured provider — a silent skip would make a broken row invisible).
 *   - Empty result → returns [] (caller decides fallback; see Unit 3b).
 */
import { prisma } from '../infrastructure/prisma.js';
import { OpenAICompatibleAdapter } from '../adapters/ai/openai-compatible.adapter.js';
import { GeminiShimAdapter } from '../adapters/ai/gemini-shim.adapter.js';
const CACHE_TTL_MS = 30000; // mirrors getAiDefaults (ai-config.ts:41)
export class AIProviderResolverService {
    constructor(
    /**
     * Injected findMany (defaults to the real Prisma client).
     * Tests inject a fake to avoid the database.
     */
    findMany = (args) => prisma.aIProviderConfig.findMany(args)) {
        this.findMany = findMany;
        this.cache = new Map();
    }
    /** Active providers for a role, ordered by priority (highest first). Empty array if none active. */
    async getProvidersForRole(role) {
        const now = Date.now();
        const cached = this.cache.get(role);
        if (cached && now - cached.ts < CACHE_TTL_MS)
            return cached.providers;
        const rows = await this.findMany({
            where: { role, isActive: true },
            orderBy: { priority: 'desc' },
        });
        // Fail loud on a misconfigured row (unknown format) — do NOT silently skip.
        const providers = rows.map((row) => this.buildProvider(row));
        this.cache.set(role, { providers, ts: now });
        return providers;
    }
    buildProvider(row) {
        switch (row.format) {
            case 'openai_compatible':
                return new OpenAICompatibleAdapter({
                    baseUrl: row.baseUrl,
                    apiKey: row.apiKey,
                    model: row.model,
                    name: row.name,
                });
            case 'gemini_native':
                return new GeminiShimAdapter({
                    baseUrl: row.baseUrl,
                    apiKey: row.apiKey,
                    model: row.model,
                    name: row.name,
                });
            default:
                throw new Error(`[AIProviderResolver] unknown format '${row.format}' for provider '${row.name}' ` +
                    `(role=${row.role}); expected 'openai_compatible' | 'gemini_native'`);
        }
    }
    /** Clear the local cache (e.g. after a provider-config hot-reload). */
    invalidateCache() {
        this.cache.clear();
    }
}
export const aiProviderResolver = new AIProviderResolverService();
//# sourceMappingURL=ai-provider-resolver.service.js.map