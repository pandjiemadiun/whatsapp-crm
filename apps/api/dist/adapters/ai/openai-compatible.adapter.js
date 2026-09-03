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
import { ErrorCategory, AIProviderError, } from './types.js';
/** HTTP-status -> ErrorCategory (mirrors groq.adapter.ts categorizeHttpError). */
function categorizeHttpError(status) {
    if (status === 429)
        return ErrorCategory.RATE_LIMIT;
    if (status >= 500)
        return ErrorCategory.SERVER_ERROR;
    if (status === 401 || status === 403)
        return ErrorCategory.AUTH_ERROR;
    if (status === 400)
        return ErrorCategory.VALIDATION_ERROR;
    return ErrorCategory.UNKNOWN;
}
function parseRetryAfter(headers) {
    const val = headers.get('Retry-After');
    if (!val)
        return undefined;
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed > 0)
        return parsed;
    return undefined;
}
/** Observability-only: read & sanitize provider error body (mirrors groq.adapter.ts). */
async function extractProviderError(response) {
    const MAX = 1000;
    let raw = '';
    try {
        raw = await response.text();
    }
    catch {
        return '';
    }
    if (!raw)
        return '';
    try {
        const parsed = JSON.parse(raw);
        const err = parsed && typeof parsed === 'object' && parsed.error
            ? parsed.error
            : null;
        if (err && typeof err === 'object') {
            const summary = {
                code: err.code ? String(err.code) : null,
                type: err.type ? String(err.type) : null,
                message: err.message ? String(err.message) : null,
            };
            return JSON.stringify(summary).slice(0, MAX);
        }
        return raw.slice(0, MAX);
    }
    catch {
        return raw.slice(0, MAX);
    }
}
export class OpenAICompatibleAdapter {
    constructor(config) {
        this.baseUrl = config.baseUrl;
        this.apiKey = config.apiKey;
        this.model = config.model;
        this.name = config.name ?? 'openai_compatible';
        this.timeoutMs = config.timeoutMs ?? 10000;
        this.inputPricePer1M = config.inputPricePer1M ?? 0.05;
        this.outputPricePer1M = config.outputPricePer1M ?? 0.15;
    }
    getName() {
        return this.name;
    }
    getModel() {
        return this.model;
    }
    async generate(prompt, options) {
        const temperature = options?.temperature ?? 0.7;
        const maxTokens = options?.maxTokens ?? 512;
        const topP = options?.topP ?? 0.95;
        const requestBody = {
            model: this.model,
            messages: [{ role: 'user', content: prompt }],
            temperature,
            max_tokens: maxTokens,
            top_p: topP,
            ...(options?.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        };
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal,
            });
            if (!response.ok) {
                const category = categorizeHttpError(response.status);
                const retryAfter = parseRetryAfter(response.headers);
                const providerError = await extractProviderError(response);
                throw new AIProviderError(providerError
                    ? `OpenAI-compatible API returned ${response.status}: ${response.statusText}\nprovider_error=${providerError}`
                    : `OpenAI-compatible API returned ${response.status}: ${response.statusText}`, category, this.name, response.status, this.isRetryable(category), retryAfter);
            }
            const data = (await response.json());
            if (!data.choices ||
                !data.choices[0] ||
                !data.choices[0].message ||
                !data.choices[0].message.content) {
                throw new AIProviderError('Invalid response structure from OpenAI-compatible API', ErrorCategory.UNKNOWN, this.name, undefined, false);
            }
            const content = data.choices[0].message.content;
            const inputTokens = data.usage?.prompt_tokens ?? Math.ceil(prompt.length / 4);
            const outputTokens = data.usage?.completion_tokens ?? Math.ceil(content.length / 4);
            const totalCost = (inputTokens / 1000000) * this.inputPricePer1M +
                (outputTokens / 1000000) * this.outputPricePer1M;
            return {
                content,
                provider: this.name,
                model: this.model,
                tokens: { input: inputTokens, output: outputTokens },
                cost: totalCost,
            };
        }
        catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new AIProviderError(`OpenAI-compatible request timeout after ${this.timeoutMs}ms`, ErrorCategory.NETWORK_TIMEOUT, this.name, undefined, true);
            }
            if (error instanceof AIProviderError)
                throw error;
            throw new AIProviderError(`OpenAI-compatible unexpected error: ${error.message}`, ErrorCategory.UNKNOWN, this.name, undefined, false);
        }
        finally {
            clearTimeout(timeoutId);
        }
    }
    /** Basic connectivity probe — GET the configured baseUrl; returns response.ok. */
    async isHealthy() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
            let response;
            try {
                response = await fetch(this.baseUrl, {
                    method: 'GET',
                    headers: { Authorization: `Bearer ${this.apiKey}` },
                    signal: controller.signal,
                });
                return response.ok;
            }
            finally {
                clearTimeout(timeoutId);
            }
        }
        catch {
            return false;
        }
    }
    isRetryable(category) {
        return (category === ErrorCategory.RATE_LIMIT ||
            category === ErrorCategory.SERVER_ERROR);
    }
}
//# sourceMappingURL=openai-compatible.adapter.js.map