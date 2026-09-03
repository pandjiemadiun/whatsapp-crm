/**
 * OpenAICompatibleAdapter — Generic OpenAI-compatible LLM provider.
 *
 * ONE adapter covers every OpenAI-compatible endpoint (Groq, OpenAI,
 * DeepSeek, xAI, etc.) simply by configuring `baseUrl`/`apiKey`/`model`.
 *
 * Request/response shape mirrors groq.adapter.ts (messages/choices format):
 *   request  : { model, messages:[{role,content}], temperature, max_tokens,
 *                top_p, [response_format] }
 *   response : { choices:[{message:{content}}], usage:{prompt_tokens,
 *                completion_tokens} }
 *
 * Error handling mirrors groq.adapter.ts/gemini.adapter.ts: every error path
 * is normalized into an AIProviderError (AbortError -> NETWORK_TIMEOUT,
 * rethrow if already AIProviderError, else UNKNOWN).
 *
 * NOT wired into LLMGateway / interpreter / reasoning (Unit 3 cutover).
 * The existing groq.adapter.ts (production) is left untouched.
 */
import { AIProvider, AIGenerateOptions, AIResponse } from './types.js';
export interface OpenAICompatibleConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    name?: string;
    timeoutMs?: number;
    inputPricePer1M?: number;
    outputPricePer1M?: number;
}
export declare class OpenAICompatibleAdapter implements AIProvider {
    private readonly baseUrl;
    private readonly apiKey;
    private readonly model;
    private readonly name;
    private readonly timeoutMs;
    private readonly inputPricePer1M;
    private readonly outputPricePer1M;
    constructor(config: OpenAICompatibleConfig);
    getName(): string;
    getModel(): string;
    generate(prompt: string, options?: AIGenerateOptions): Promise<AIResponse>;
    /** Basic connectivity probe — GET the configured baseUrl; returns response.ok. */
    isHealthy(): Promise<boolean>;
    private isRetryable;
}
//# sourceMappingURL=openai-compatible.adapter.d.ts.map