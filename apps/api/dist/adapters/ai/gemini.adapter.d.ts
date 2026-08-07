import { AIProvider, AIGenerateOptions, AIResponse } from './types.js';
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
export declare class GeminiAdapter implements AIProvider {
    private apiKey;
    private _model;
    constructor(apiKey?: string);
    configure(apiKey: string): void;
    configureModel(model: string): void;
    getName(): string;
    getModel(): string;
    /**
     * Generate content using Gemini 2.5 Flash
     * - Uses fetch (REST API) untuk consistency dengan GroqAdapter
     * - Tidak bergantung pada SDK
     * - Cost tracking include thoughts tokens
     */
    generate(prompt: string, options?: AIGenerateOptions): Promise<AIResponse>;
    /**
     * Health check — validates API key via the models list endpoint.
     * More stable than a generateContent ping: newer models may return empty
     * parts for trivial prompts, which would falsely mark the provider down.
     */
    isHealthy(): Promise<boolean>;
    /**
     * Parse Retry-After header (seconds or HTTP-date)
     */
    private parseRetryAfter;
    /**
     * Kategorisasi HTTP status code ke ErrorCategory
     */
    private categorizeHttpError;
    /**
     * Determine if error kategori harus trigger fallback/retry
     */
    private isRetryable;
}
export declare const geminiAdapter: GeminiAdapter;
//# sourceMappingURL=gemini.adapter.d.ts.map