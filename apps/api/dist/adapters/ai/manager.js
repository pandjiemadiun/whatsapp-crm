import { AIProviderError, ErrorCategory, } from './types.js';
import { geminiAdapter } from './gemini.adapter.js';
import { shouldSkipProvider, triggerCooldown } from '../../services/provider-cooldown.js';
import { logTokenUsage } from '../../services/token-usage-tracker.js';
import { groqAdapter } from './groq.adapter.js';
export class AIProviderManager {
    constructor(primary = geminiAdapter, // GEMINI SEKARANG PRIMARY SPEAKER (Natural Conversation)
    fallback = groqAdapter, // GROQ SEKARANG FALLBACK SPEAKER
    gatekeeper = groqAdapter // GROQ SEKARANG FAST GATEKEEPER (Intent Extraction)
    ) {
        this.breaker = {
            failures: 0,
            threshold: 5,
            resetAfterMs: 60000,
            openedAt: 0,
        };
        this.stats = {
            primary: { success: 0, failed: 0, retried: 0 },
            fallback: { success: 0, failed: 0 },
            errors: [],
        };
        this.primaryProvider = primary;
        this.fallbackProvider = fallback;
        this.gatekeeperProvider = gatekeeper;
    }
    /**
     * Fast Intent & Entity Gatekeeper via Groq
     */
    async extractIntent(message, contextSummary) {
        try {
            return await this.gatekeeperProvider.extractIntent(message, contextSummary);
        }
        catch (err) {
            console.warn('[AIManager] Groq Gatekeeper failed, returning fallback intent:', err.message);
            return {
                intent: 'COMPLEX_CONVERSATION',
                confidence: 0.3,
                entities: {},
                reasoning: 'Gatekeeper error fallback',
            };
        }
    }
    async generate(prompt, options, intent = 'general') {
        const primaryName = this.primaryProvider.getName();
        const fallbackName = this.fallbackProvider.getName();
        // BAGIAN 2 - Circuit breaker
        if (this.breaker.failures >= this.breaker.threshold &&
            Date.now() - this.breaker.openedAt < this.breaker.resetAfterMs) {
            console.warn('[AIManager] Circuit breaker OPEN - all LLM providers skipped');
            throw new AIProviderError('Circuit breaker open: all LLM providers exhausted', ErrorCategory.SERVER_ERROR, 'circuit-breaker');
        }
        let primaryErr = null;
        // BAGIAN 1 - Check primary cooldown
        if (!shouldSkipProvider(primaryName)) {
            try {
                const response = await this.primaryProvider.generate(prompt, options);
                this.stats.primary.success++;
                this.breaker.failures = 0;
                this.breaker.openedAt = 0;
                console.log('[AIManager] Primary provider succeeded', {
                    provider: response.provider,
                    model: response.model,
                    cost: response.cost.toFixed(6),
                });
                // BAGIAN 1 — Token usage tracking
                logTokenUsage({
                    timestamp: Date.now(),
                    provider: response.provider,
                    model: response.model,
                    intent,
                    conversationId: options?.conversationId || 'unknown',
                    inputTokens: response.tokens.input,
                    outputTokens: response.tokens.output,
                    totalTokens: response.tokens.input + response.tokens.output,
                    costUsd: response.cost,
                });
                return response;
            }
            catch (primaryError) {
                const error = primaryError;
                primaryErr = error;
                this.stats.primary.failed++;
                if (error.category === ErrorCategory.RATE_LIMIT || error.statusCode === 429) {
                    triggerCooldown(error.provider || primaryName, error.retryAfter ? error.retryAfter * 1000 : undefined);
                    this.breaker.openedAt = 0;
                }
                else if (error.category === ErrorCategory.SERVER_ERROR ||
                    error.category === ErrorCategory.NETWORK_TIMEOUT) {
                    this.breaker.failures++;
                    if (this.breaker.failures === this.breaker.threshold) {
                        this.breaker.openedAt = Date.now();
                    }
                }
                this.stats.errors.push({ provider: error.provider, category: error.category, timestamp: new Date() });
                console.warn('[AIManager] Primary provider failed', {
                    provider: error.provider,
                    category: error.category,
                    retryable: error.retryable,
                });
            }
        }
        else {
            console.info('[AIManager] Primary provider in cooldown - skipping to fallback');
        }
        // BAGIAN 1 - Check fallback cooldown
        if (!shouldSkipProvider(fallbackName)) {
            try {
                const response = await this.fallbackProvider.generate(prompt, options);
                this.stats.fallback.success++;
                this.breaker.failures = 0;
                this.breaker.openedAt = 0;
                console.log('[AIManager] Fallback provider succeeded', {
                    provider: response.provider,
                    model: response.model,
                    cost: response.cost.toFixed(6),
                });
                // BAGIAN 1 — Token usage tracking
                logTokenUsage({
                    timestamp: Date.now(),
                    provider: response.provider,
                    model: response.model,
                    intent,
                    conversationId: options?.conversationId || 'unknown',
                    inputTokens: response.tokens.input,
                    outputTokens: response.tokens.output,
                    totalTokens: response.tokens.input + response.tokens.output,
                    costUsd: response.cost,
                });
                return response;
            }
            catch (fallbackError) {
                const error = fallbackError;
                if (error.category === ErrorCategory.RATE_LIMIT || error.statusCode === 429) {
                    triggerCooldown(error.provider || fallbackName, error.retryAfter ? error.retryAfter * 1000 : undefined);
                }
                else if (error.category === ErrorCategory.SERVER_ERROR ||
                    error.category === ErrorCategory.NETWORK_TIMEOUT) {
                    this.breaker.failures++;
                    if (this.breaker.failures >= this.breaker.threshold) {
                        this.breaker.openedAt = Date.now();
                    }
                }
                this.stats.fallback.failed++;
                this.stats.errors.push({ provider: error.provider, category: error.category, timestamp: new Date() });
                console.error('[AIManager] Both providers failed, exhausted');
            }
        }
        else {
            console.info('[AIManager] Fallback provider in cooldown - skipping');
        }
        if (primaryErr)
            throw primaryErr;
        throw new AIProviderError('All LLM providers exhausted (cooldown + errors)', ErrorCategory.SERVER_ERROR, 'all-providers-exhausted');
    }
    getStats() {
        return {
            primary: this.stats.primary,
            fallback: this.stats.fallback,
            errorLog: this.stats.errors.slice(-10),
        };
    }
    getProviders() {
        return {
            primary: this.primaryProvider.getName(),
            fallback: this.fallbackProvider.getName(),
            gatekeeper: this.gatekeeperProvider.getName(),
        };
    }
}
export const aiProviderManager = new AIProviderManager();
//# sourceMappingURL=manager.js.map