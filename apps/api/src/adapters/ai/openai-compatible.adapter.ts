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
import {
  AIProvider,
  AIGenerateOptions,
  AIResponse,
  ErrorCategory,
  AIProviderError,
} from './types.js';

export interface OpenAICompatibleConfig {
  baseUrl: string;          // e.g. https://api.groq.com/openai/v1/chat/completions
  apiKey: string;
  model: string;            // provider model id, e.g. "llama-3.3-70b-versatile"
  name?: string;            // getName() (default 'openai_compatible')
  timeoutMs?: number;       // request timeout (default 10000)
  inputPricePer1M?: number; // $/1M input tokens  (default 0.05)
  outputPricePer1M?: number; // $/1M output tokens (default 0.15)
}

/** HTTP-status -> ErrorCategory (mirrors groq.adapter.ts categorizeHttpError). */
function categorizeHttpError(status: number): ErrorCategory {
  if (status === 429) return ErrorCategory.RATE_LIMIT;
  if (status >= 500) return ErrorCategory.SERVER_ERROR;
  if (status === 401 || status === 403) return ErrorCategory.AUTH_ERROR;
  if (status === 400) return ErrorCategory.VALIDATION_ERROR;
  return ErrorCategory.UNKNOWN;
}

function parseRetryAfter(headers: Headers): number | undefined {
  const val = headers.get('Retry-After');
  if (!val) return undefined;
  const parsed = parseInt(val, 10);
  if (!isNaN(parsed) && parsed > 0) return parsed;
  return undefined;
}

/** Observability-only: read & sanitize provider error body (mirrors groq.adapter.ts). */
async function extractProviderError(response: Response): Promise<string> {
  const MAX = 1000;
  let raw = '';
  try {
    raw = await response.text();
  } catch {
    return '';
  }
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    const err =
      parsed && typeof parsed === 'object' && (parsed as any).error
        ? (parsed as any).error
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
  } catch {
    return raw.slice(0, MAX);
  }
}

export class OpenAICompatibleAdapter implements AIProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly name: string;
  private readonly timeoutMs: number;
  private readonly inputPricePer1M: number;
  private readonly outputPricePer1M: number;

  constructor(config: OpenAICompatibleConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.name = config.name ?? 'openai_compatible';
    this.timeoutMs = config.timeoutMs ?? 10000;
    this.inputPricePer1M = config.inputPricePer1M ?? 0.05;
    this.outputPricePer1M = config.outputPricePer1M ?? 0.15;
  }

  getName(): string {
    return this.name;
  }

  getModel(): string {
    return this.model;
  }

  async generate(prompt: string, options?: AIGenerateOptions): Promise<AIResponse> {
    const temperature = options?.temperature ?? 0.7;
    const maxTokens = options?.maxTokens ?? 512;
    const topP = options?.topP ?? 0.95;

    const requestBody: Record<string, unknown> = {
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
        throw new AIProviderError(
          providerError
            ? `OpenAI-compatible API returned ${response.status}: ${response.statusText}\nprovider_error=${providerError}`
            : `OpenAI-compatible API returned ${response.status}: ${response.statusText}`,
          category,
          this.name,
          response.status,
          this.isRetryable(category),
          retryAfter,
        );
      }

      const data = (await response.json()) as any;

      if (
        !data.choices ||
        !data.choices[0] ||
        !data.choices[0].message ||
        !data.choices[0].message.content
      ) {
        throw new AIProviderError(
          'Invalid response structure from OpenAI-compatible API',
          ErrorCategory.UNKNOWN,
          this.name,
          undefined,
          false,
        );
      }

      const content: string = data.choices[0].message.content;
      const inputTokens =
        data.usage?.prompt_tokens ?? Math.ceil(prompt.length / 4);
      const outputTokens =
        data.usage?.completion_tokens ?? Math.ceil(content.length / 4);
      const totalCost =
        (inputTokens / 1_000_000) * this.inputPricePer1M +
        (outputTokens / 1_000_000) * this.outputPricePer1M;

      return {
        content,
        provider: this.name,
        model: this.model,
        tokens: { input: inputTokens, output: outputTokens },
        cost: totalCost,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AIProviderError(
          `OpenAI-compatible request timeout after ${this.timeoutMs}ms`,
          ErrorCategory.NETWORK_TIMEOUT,
          this.name,
          undefined,
          true,
        );
      }
      if (error instanceof AIProviderError) throw error;
      throw new AIProviderError(
        `OpenAI-compatible unexpected error: ${(error as Error).message}`,
        ErrorCategory.UNKNOWN,
        this.name,
        undefined,
        false,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** Basic connectivity probe — GET the configured baseUrl; returns response.ok. */
  async isHealthy(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await fetch(this.baseUrl, {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.apiKey}` },
          signal: controller.signal,
        });
        return response.ok;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      return false;
    }
  }

  private isRetryable(category: ErrorCategory): boolean {
    return (
      category === ErrorCategory.RATE_LIMIT ||
      category === ErrorCategory.SERVER_ERROR
    );
  }
}
