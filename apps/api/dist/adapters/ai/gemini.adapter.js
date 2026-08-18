import { ErrorCategory, AIProviderError, } from './types.js';
import { getAiDefaults } from './ai-config.js';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';
const REQUEST_TIMEOUT_MS = 30000; // 30 detik
const DEFAULT_MAX_TOKENS = 2048; // ← NAIK dari 500 ke 2048 (account untuk thoughts)
/**
 * GeminiAdapter - Primary AI Provider
 * Uses Google's Gemini 2.5 Flash model via REST API (fetch)
 *
 * IMPORTANT: Gemini 2.5 Flash has "Thoughts" feature yang consume tokens.
 * thoughtsTokenCount bisa 100-300+ tokens, jadi maxOutputTokens harus cukup besar.
 *
 * Pricing (as of 2025):
 * - Input:  $0.075 per 1M tokens
 * - Output: $0.30  per 1M tokens
 * - Thoughts juga dihitung dalam output token usage
 *
 * Response structure:
 * {
 *   candidates: [{
 *     content: { parts: [{ text: "..." }] },
 *     finishReason: "STOP"
 *   }],
 *   usageMetadata: {
 *     promptTokenCount: number,
 *     candidatesTokenCount: number,      ← Text output tokens
 *     thoughtsTokenCount: number,        ← Thinking tokens (Gemini 2.5 only)
 *     totalTokenCount: number,
 *     promptTokensDetails: [...],
 *     serviceTier: "standard"
 *   }
 * }
 */
export class GeminiAdapter {
    constructor(apiKey = process.env.GEMINI_API_KEY || '') {
        this._model = 'gemini-2.0-flash';
        this.apiKey = apiKey;
    }
    configure(apiKey) {
        this.apiKey = apiKey;
    }
    configureModel(model) {
        this._model = model;
    }
    getName() {
        return 'gemini';
    }
    getModel() {
        return this._model;
    }
    /**
     * Generate content using Gemini 2.5 Flash
     * - Uses fetch (REST API) untuk consistency dengan GroqAdapter
     * - Tidak bergantung pada SDK
     * - Cost tracking include thoughts tokens
     */
    async generate(prompt, options) {
        try {
            const defaults = await getAiDefaults();
            this._model = defaults.primaryModel;
            const maxOutputTokens = options?.maxTokens ?? defaults.maxTokensGemini;
            const temperature = options?.temperature ?? defaults.temperature;
            const topP = options?.topP ?? defaults.topP;
            console.log('[Gemini] Sending request...', {
                promptLength: prompt.length,
                model: this._model,
                temperature,
                maxTokens: maxOutputTokens,
            });
            // Setup AbortController untuk timeout handling
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
            const requestBody = {
                contents: [
                    {
                        parts: [
                            {
                                text: prompt,
                            },
                        ],
                    },
                ],
                generationConfig: {
                    temperature,
                    maxOutputTokens: maxOutputTokens,
                    topP,
                },
            };
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this._model}:generateContent?key=${this.apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            // ========================================
            // Handle non-2xx responses
            // ========================================
            if (!response.ok) {
                const errorCategory = this.categorizeHttpError(response.status);
                const errorBody = await response.text();
                console.warn('[Gemini] HTTP Error', {
                    status: response.status,
                    category: errorCategory,
                    isRetryable: this.isRetryable(errorCategory),
                    body: errorBody.substring(0, 200),
                });
                const retryAfter = this.parseRetryAfter(response.headers);
                const err = new AIProviderError(`Gemini API returned ${response.status}: ${response.statusText}`, errorCategory, 'gemini', response.status, this.isRetryable(errorCategory), retryAfter);
                throw err;
            }
            // ========================================
            // Parse JSON response
            // ========================================
            const data = await response.json();
            // ========================================
            // Validate response structure
            // ========================================
            if (!data.candidates ||
                !data.candidates[0] ||
                !data.candidates[0].content ||
                !data.candidates[0].content.parts ||
                !data.candidates[0].content.parts[0] ||
                !data.candidates[0].content.parts[0].text) {
                console.error('[Gemini] Invalid response structure', {
                    hasContent: !!data.candidates?.[0]?.content,
                    hasParts: !!data.candidates?.[0]?.content?.parts,
                    hasText: !!data.candidates?.[0]?.content?.parts?.[0]?.text,
                });
                throw new AIProviderError('Invalid response structure from Gemini API', ErrorCategory.UNKNOWN, 'gemini', undefined, false);
            }
            // ========================================
            // Extract content
            // ========================================
            const content = data.candidates[0].content.parts[0].text;
            // ========================================
            // Extract token usage dengan Thoughts
            // ========================================
            const usageMetadata = data.usageMetadata || {};
            const promptTokenCount = usageMetadata.promptTokenCount ?? Math.ceil(prompt.length / 4);
            const candidatesTokenCount = usageMetadata.candidatesTokenCount ?? Math.ceil(content.length / 4);
            const thoughtsTokenCount = usageMetadata.thoughtsTokenCount ?? 0;
            // Total output tokens = text output + thoughts (both billed as output)
            const totalOutputTokens = candidatesTokenCount + thoughtsTokenCount;
            // ========================================
            // Calculate cost dengan Thoughts
            // ========================================
            const inputCost = (promptTokenCount / 1000000) * 0.075;
            const outputCost = (totalOutputTokens / 1000000) * 0.30;
            const totalCost = inputCost + outputCost;
            console.log('[Gemini] Success', {
                promptTokenCount,
                candidatesTokenCount,
                thoughtsTokenCount,
                totalOutputTokens,
                finishReason: data.candidates[0].finishReason,
                inputCost: inputCost.toFixed(8),
                outputCost: outputCost.toFixed(8),
                totalCost: totalCost.toFixed(8),
            });
            // ========================================
            // Return AIResponse
            // ========================================
            return {
                content,
                provider: 'gemini',
                model: this._model,
                tokens: {
                    input: promptTokenCount,
                    output: totalOutputTokens, // ← Include thoughts dalam output count
                },
                cost: totalCost,
            };
        }
        catch (error) {
            // ========================================
            // Handle AbortError (timeout)
            // ========================================
            if (error instanceof Error && error.name === 'AbortError') {
                console.warn('[Gemini] Request timeout', { timeoutMs: REQUEST_TIMEOUT_MS });
                throw new AIProviderError(`Gemini request timeout after ${REQUEST_TIMEOUT_MS}ms`, ErrorCategory.NETWORK_TIMEOUT, 'gemini', undefined, true // timeout adalah retryable
                );
            }
            // ========================================
            // Re-throw jika sudah AIProviderError
            // ========================================
            if (error instanceof AIProviderError) {
                throw error;
            }
            // ========================================
            // Unexpected error
            // ========================================
            console.error('[Gemini] Unexpected error', {
                message: error.message,
                stack: error.stack,
            });
            throw new AIProviderError(`Gemini unexpected error: ${error.message}`, ErrorCategory.UNKNOWN, 'gemini', undefined, false);
        }
    }
    /**
     * Health check — validates API key via the models list endpoint.
     * More stable than a generateContent ping: newer models may return empty
     * parts for trivial prompts, which would falsely mark the provider down.
     */
    async isHealthy() {
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
            return response.ok;
        }
        catch {
            return false;
        }
    }
    /**
     * Parse Retry-After header (seconds or HTTP-date)
     */
    parseRetryAfter(headers) {
        const val = headers.get('Retry-After');
        if (!val)
            return undefined;
        const parsed = parseInt(val, 10);
        if (!isNaN(parsed) && parsed > 0)
            return parsed;
        return undefined;
    }
    /**
     * Kategorisasi HTTP status code ke ErrorCategory
     */
    categorizeHttpError(statusCode) {
        if (statusCode === 429)
            return ErrorCategory.RATE_LIMIT;
        if (statusCode >= 500)
            return ErrorCategory.SERVER_ERROR;
        if (statusCode === 401 || statusCode === 403)
            return ErrorCategory.AUTH_ERROR;
        if (statusCode === 400)
            return ErrorCategory.VALIDATION_ERROR;
        return ErrorCategory.UNKNOWN;
    }
    /**
     * Determine if error kategori harus trigger fallback/retry
     */
    isRetryable(category) {
        return (category === ErrorCategory.RATE_LIMIT ||
            category === ErrorCategory.SERVER_ERROR ||
            category === ErrorCategory.NETWORK_TIMEOUT);
    }
}
export const geminiAdapter = new GeminiAdapter();
//# sourceMappingURL=gemini.adapter.js.map