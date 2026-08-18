import { AIProvider, AIGenerateOptions, AIResponse, ExtractedIntent } from './types.js';
/**
 * GroqAdapter - Fast Intent & Entity Extractor (Gatekeeper) & AI Provider
 * Uses Groq's openai/gpt-oss-120b model (OpenAI-compatible API)
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
    /**
     * GPT-OSS compatibility guard — true only for the openai/gpt-oss-* family.
     * Local to GroqAdapter so no provider-specific logic leaks into the
     * Conversation Engine / business layer.
     */
    private isGptOssModel;
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
    /**
     * Observability-only: read & sanitize the provider error body for a non-2xx
     * response. Captures error.code/type/message only — never the prompt,
     * customer content, API key, or request headers. Returns '' if unavailable.
     */
    private extractProviderError;
}
export declare const groqAdapter: GroqAdapter;
//# sourceMappingURL=groq.adapter.d.ts.map