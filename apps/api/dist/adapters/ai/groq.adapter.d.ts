import { AIProvider, AIGenerateOptions, AIResponse, ExtractedIntent } from './types.js';
/**
 * GroqAdapter - Fast Intent & Entity Extractor (Gatekeeper) & AI Provider
 * Uses Groq's LLaMA 3.3 70B Versatile model (OpenAI-compatible API)
 *
 * Pricing (as of 2025):
 * - Input:  $0.05 per 1M tokens
 * - Output: $0.15 per 1M tokens
 */
export declare class GroqAdapter implements AIProvider {
    private apiKey;
    private _model;
    constructor(apiKey?: string);
    configure(apiKey: string): void;
    /**
     * configureKeys — accept comma-separated GROQ_API_KEYS dan load via router.
     * Router caches di Redis + in-memory.
     */
    configureKeys(keys: string): void;
    configureModel(model: string): void;
    getApiKey(): Promise<string | null>;
    getName(): string;
    getModel(): string;
    generate(prompt: string, options?: AIGenerateOptions): Promise<AIResponse>;
    private parseRetryAfter;
    /**
     * Health check — validates API key via the models list endpoint.
     * Avoids consuming rate-limited inference quota on a 30s health interval.
     */
    isHealthy(): Promise<boolean>;
    /**
     * Fast Intent & Entity Extraction (Groq Gatekeeper)
     */
    extractIntent(message: string, contextSummary?: string): Promise<ExtractedIntent>;
    /**
     * Kategorisasi HTTP status code ke ErrorCategory
     */
    private categorizeHttpError;
}
export declare const groqAdapter: GroqAdapter;
//# sourceMappingURL=groq.adapter.d.ts.map