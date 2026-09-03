/**
 * GeminiShimAdapter — Parameterized Gemini (native REST) provider.
 *
 * Produces an AIResponse IDENTICAL to gemini.adapter.ts (same request body
 * shape, same candidates[0].content.parts[0].text parsing, same
 * usageMetadata token accounting incl. thoughts, same $0.075/$0.30 costing)
 * — but fully parameterized via config (baseUrl/model/apiKey) instead of the
 * hardcoded endpoint + env-sourced single key in gemini.adapter.ts.
 *
 * Why a standalone parameterized shim instead of wrapping/extending GeminiAdapter:
 * the existing GeminiAdapter.generate() hardcodes the endpoint and calls
 * getAiDefaults() (DB-backed) while OVERRIDING this._model from defaults — the
 * exact coupling we are abstracting away for Unit 3. A standalone shim mirrors
 * the response contract without the env/DB coupling.
 *
 * NOT wired into LLMGateway/interpreter/reasoning (Unit 3 cutover).
 */
import { AIProvider, AIGenerateOptions, AIResponse } from './types.js';
export interface GeminiShimConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    name?: string;
    timeoutMs?: number;
    inputPricePer1M?: number;
    outputPricePer1M?: number;
}
export declare class GeminiShimAdapter implements AIProvider {
    private readonly baseUrl;
    private readonly apiKey;
    private readonly model;
    private readonly name;
    private readonly timeoutMs;
    private readonly inputPricePer1M;
    private readonly outputPricePer1M;
    constructor(config: GeminiShimConfig);
    getName(): string;
    getModel(): string;
    generate(prompt: string, options?: AIGenerateOptions): Promise<AIResponse>;
    /** Health check — validates API key via the models list endpoint (mirrors gemini.adapter.ts isHealthy). */
    isHealthy(): Promise<boolean>;
    private isRetryable;
}
//# sourceMappingURL=gemini-shim.adapter.d.ts.map