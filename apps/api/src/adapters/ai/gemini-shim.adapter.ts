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
import {
  AIProvider,
  AIGenerateOptions,
  AIResponse,
  ErrorCategory,
  AIProviderError,
} from './types.js';

export interface GeminiShimConfig {
  baseUrl: string;          // e.g. https://generativelanguage.googleapis.com/v1beta
  apiKey: string;
  model: string;            // e.g. gemini-2.0-flash
  name?: string;            // getName() (default 'gemini')
  timeoutMs?: number;       // request timeout (default 30000, mirrors gemini.adapter.ts)
  inputPricePer1M?: number; // $/1M input tokens  (default 0.075)
  outputPricePer1M?: number; // $/1M output tokens (default 0.30)
}

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

export class GeminiShimAdapter implements AIProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly name: string;
  private readonly timeoutMs: number;
  private readonly inputPricePer1M: number;
  private readonly outputPricePer1M: number;

  constructor(config: GeminiShimConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.name = config.name ?? 'gemini';
    this.timeoutMs = config.timeoutMs ?? 30000;
    this.inputPricePer1M = config.inputPricePer1M ?? 0.075;
    this.outputPricePer1M = config.outputPricePer1M ?? 0.3;
  }

  getName(): string {
    return this.name;
  }

  getModel(): string {
    return this.model;
  }

  async generate(prompt: string, options?: AIGenerateOptions): Promise<AIResponse> {
    // Defaults mirror gemini.adapter.ts FALLBACKS (ai-config.ts) so output stays
    // consistent with the production GeminiAdapter until Unit 3 wires config.
    const temperature = options?.temperature ?? 0.7;
    const maxOutputTokens = options?.maxTokens ?? 2048;
    const topP = options?.topP ?? 0.95;

    const requestBody = {
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature,
        maxOutputTokens: maxOutputTokens,
        topP,
      },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(
        `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const category = categorizeHttpError(response.status);
        const retryAfter = parseRetryAfter(response.headers);
        const providerError = await extractProviderError(response);
        throw new AIProviderError(
          providerError
            ? `Gemini API returned ${response.status}: ${response.statusText}\nprovider_error=${providerError}`
            : `Gemini API returned ${response.status}: ${response.statusText}`,
          category,
          this.name,
          response.status,
          this.isRetryable(category),
          retryAfter,
        );
      }

      const data = (await response.json()) as any;

      if (
        !data.candidates ||
        !data.candidates[0] ||
        !data.candidates[0].content ||
        !data.candidates[0].content.parts ||
        !data.candidates[0].content.parts[0] ||
        !data.candidates[0].content.parts[0].text
      ) {
        throw new AIProviderError(
          'Invalid response structure from Gemini API',
          ErrorCategory.UNKNOWN,
          this.name,
          undefined,
          false,
        );
      }

      const content: string = data.candidates[0].content.parts[0].text;

      const usageMetadata = data.usageMetadata || {};
      const promptTokenCount =
        usageMetadata.promptTokenCount ?? Math.ceil(prompt.length / 4);
      const candidatesTokenCount =
        usageMetadata.candidatesTokenCount ?? Math.ceil(content.length / 4);
      const thoughtsTokenCount = usageMetadata.thoughtsTokenCount ?? 0;

      // Output tokens = text output + thoughts (both billed as output, mirroring gemini.adapter.ts)
      const totalOutputTokens = candidatesTokenCount + thoughtsTokenCount;

      const inputCost = (promptTokenCount / 1_000_000) * this.inputPricePer1M;
      const outputCost = (totalOutputTokens / 1_000_000) * this.outputPricePer1M;
      const totalCost = inputCost + outputCost;

      return {
        content,
        provider: this.name,
        model: this.model,
        tokens: {
          input: promptTokenCount,
          output: totalOutputTokens, // include thoughts in output count (mirrors gemini.adapter.ts)
        },
        cost: totalCost,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AIProviderError(
          `Gemini request timeout after ${this.timeoutMs}ms`,
          ErrorCategory.NETWORK_TIMEOUT,
          this.name,
          undefined,
          true,
        );
      }
      if (error instanceof AIProviderError) throw error;
      throw new AIProviderError(
        `Gemini unexpected error: ${(error as Error).message}`,
        ErrorCategory.UNKNOWN,
        this.name,
        undefined,
        false,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** Health check — validates API key via the models list endpoint (mirrors gemini.adapter.ts isHealthy). */
  async isHealthy(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(
          `${this.baseUrl}/models?key=${this.apiKey}`,
          { signal: AbortSignal.timeout ? AbortSignal.timeout(this.timeoutMs) : controller.signal },
        );
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
      category === ErrorCategory.SERVER_ERROR ||
      category === ErrorCategory.NETWORK_TIMEOUT
    );
  }
}
