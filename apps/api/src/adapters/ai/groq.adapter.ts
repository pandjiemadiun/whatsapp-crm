import {
  AIProvider,
  AIGenerateOptions,
  AIResponse,
  ErrorCategory,
  AIProviderError,
  ExtractedIntent,
} from './types.js';
import { getAiDefaults, invalidateAiDefaultsCache } from './ai-config.js';
import { aiKeyRouter } from '../../services/ai-key-router.service.js';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 10000; // 10 detik

/**
 * gpt-oss compatibility floor: openai/gpt-oss-120b needs more output headroom
 * than the chat path's 250-token cap to emit a complete InterpreterResultV2
 * payload in `response_format:json_object` mode. At 250 the model emits a
 * truncated/non-JSON generation and Groq rejects the request with
 * `json_validate_failed` (HTTP 400, empty failed_generation). 1024 comfortably
 * covers the longest verified V2 output (~650 tokens).
 * Applied ONLY for gpt-oss in json_object mode; Llama and non-JSON calls are
 * unchanged. This is request-normalization only — it does NOT change the model,
 * endpoint, temperature, top_p, response_format, retry, or AIResponse contract.
 */
const GPT_OSS_MAX_TOKENS_FLOOR = 1024;

/**
 * GroqAdapter - Fast Intent & Entity Extractor (Gatekeeper) & AI Provider
 * Uses Groq's openai/gpt-oss-120b model (OpenAI-compatible API)
 *
 * Pricing (as of 2025):
 * - Input:  $0.05 per 1M tokens
 * - Output: $0.15 per 1M tokens
 */
export class GroqAdapter implements AIProvider {
  private apiKey: string;
  private _model: string = 'openai/gpt-oss-120b';

  constructor(apiKey: string = process.env.GROQ_API_KEY || process.env.GROQ_API_KEYS?.split(',')[0] || '') {
    this.apiKey = apiKey;
    // Jika env punya GROQ_API_KEYS, load via router untuk rotation
    const envKeys = process.env.GROQ_API_KEYS;
    if (envKeys) {
      this.apiKey = '';
      aiKeyRouter.loadKeys(envKeys).catch((e) => {
        console.warn('[GroqAdapter] Failed to load keys from env:', (e as Error).message);
      });
    }
  }

  configure(apiKey: string): void {
    this.apiKey = apiKey;
  }
  /**
   * configureKeys — accept comma-separated GROQ_API_KEYS dan load via router.
   * Router caches di Redis + in-memory.
   */
  configureKeys(keys: string): void {
    this.apiKey = ''; // clear static key — force router usage
    aiKeyRouter.loadKeys(keys).catch((e) => {
      console.warn('[GroqAdapter] Failed to load keys:', (e as Error).message);
    });
  }
  configureModel(model: string): void {
    this._model = model;
  }

  async getApiKey(): Promise<string | null> {
    // Selalu minta ke router untuk key rotation
    const routerKey = await aiKeyRouter.getAvailableKey();
    if (routerKey) return routerKey;
    // Fallback ke static key jika router belum load / tidak punya keys
    return this.apiKey || null;
  }

  getName(): string {
    return 'groq';
  }

  getModel(): string {
    return this._model;
  }

  /**
   * GPT-OSS compatibility guard — true only for the openai/gpt-oss-* family.
   * Local to GroqAdapter so no provider-specific logic leaks into the
   * Conversation Engine / business layer.
   */
  private isGptOssModel(model: string): boolean {
    return /^openai\/gpt-oss/.test(model);
  }

  async generate(
    prompt: string,
    options?: AIGenerateOptions
  ): Promise<AIResponse> {
    const maxRetries = 5; // max key rotation attempts
    let lastError: AIProviderError | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const currentKey = await this.getApiKey();
      if (!currentKey) {
        // Semua key di cooldown → throw rate limit (manager akan fallback ke Gemini)
        throw new AIProviderError(
          'All Groq API keys are in cooldown',
          ErrorCategory.RATE_LIMIT,
          'groq',
          429,
          true,
        );
      }

      try {
        const defaults = await getAiDefaults();
        this._model = defaults.fallbackModel;
        const temperature = options?.temperature ?? defaults.temperature;
        const maxTokens = options?.maxTokens ?? defaults.maxTokensGroq;
        const topP = options?.topP ?? defaults.topP;
        const jsonMode = options?.jsonMode ?? false;
        // gpt-oss compatibility: floor output tokens for json_object mode so the
        // model can emit a complete InterpreterResultV2 payload (otherwise Groq
        // rejects with json_validate_failed). Llama + non-JSON calls unchanged.
        const effectiveMaxTokens = this.isGptOssModel(this._model) && jsonMode
          ? Math.max(maxTokens, GPT_OSS_MAX_TOKENS_FLOOR)
          : maxTokens;

      console.log('[Groq] Sending request...', {
        promptLength: prompt.length,
        model: this._model,
        temperature,
        maxTokens: effectiveMaxTokens,
        jsonMode: options?.jsonMode ?? false,
      });

      // Setup AbortController untuk timeout handling
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const requestBody: Record<string, unknown> = {
        model: this._model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature,
        max_tokens: effectiveMaxTokens,
        top_p: topP,
        ...(options?.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      };

      const response = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle non-2xx responses
      if (!response.ok) {
        const errorCategory = this.categorizeHttpError(response.status);
        const retryAfter = this.parseRetryAfter(response.headers);
        // Observability-only: read the provider error body ONCE for any non-2xx
        // response and sanitize it. Captures error.code/type/message only —
        // never the prompt, customer content, API key, or request headers.
        // Does NOT change classification (categorizeHttpError) or retryability.
        const providerError = await this.extractProviderError(response);

        if (response.status === 429) {
          // BAGIAN 3a: Rate-limited → cooldown key, coba key berikutnya
          console.warn('[Groq] Rate limited (429)', {
            keyHash: currentKey.slice(0, 8),
            retryAfter,
            attempt: attempt + 1,
            providerError,
          });
          await aiKeyRouter.reportRateLimit(currentKey, retryAfter);

          // Log dan lanjutkan ke key berikutnya
          console.log(`[Groq] Key 1 rate-limited, putting on cooldown. Trying Key 2...`);
          lastError = new AIProviderError(
            providerError
              ? `Groq 429 on key ${currentKey.slice(0, 8)}...\nprovider_error=${providerError}`
              : `Groq 429 on key ${currentKey.slice(0, 8)}...`,
            ErrorCategory.RATE_LIMIT,
            'groq',
            response.status,
            true,
            retryAfter,
          );
          continue; // try next key in loop
        }

        throw new AIProviderError(
          providerError
            ? `Groq API returned ${response.status}: ${response.statusText}\nprovider_error=${providerError}`
            : `Groq API returned ${response.status}: ${response.statusText}`,
          errorCategory,
          'groq',
          response.status,
          false,
          retryAfter,
        );
      }

      // Parse response (OpenAI-compatible format)
      const data = await response.json() as any;

      // Validate response structure
      if (
        !data.choices ||
        !data.choices[0] ||
        !data.choices[0].message ||
        !data.choices[0].message.content
      ) {
        throw new AIProviderError(
          'Invalid response structure from Groq API',
          ErrorCategory.UNKNOWN,
          'groq',
          undefined,
          false
        );
      }

      const content = data.choices[0].message.content;

      // Get actual token usage from response (jika tersedia)
      const inputTokens = data.usage?.prompt_tokens ?? Math.ceil(prompt.length / 4);
      const outputTokens = data.usage?.completion_tokens ?? Math.ceil(content.length / 4);

      // Calculate cost
      const inputCost = (inputTokens / 1_000_000) * 0.05;
      const outputCost = (outputTokens / 1_000_000) * 0.15;
      const totalCost = inputCost + outputCost;

      console.log('[Groq] Success', {
        inputTokens,
        outputTokens,
        cost: totalCost.toFixed(6),
      });

      return {
        content,
        provider: 'groq',
        model: this._model,
        tokens: { input: inputTokens, output: outputTokens },
        cost: totalCost,
      };
    } catch (error) {
      // Handle AbortError (timeout)
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn('[Groq] Request timeout', { timeoutMs: REQUEST_TIMEOUT_MS });

        throw new AIProviderError(
          `Groq request timeout after ${REQUEST_TIMEOUT_MS}ms`,
          ErrorCategory.NETWORK_TIMEOUT,
          'groq',
          undefined,
          false // timeout is not retryable within this adapter — manager handles fallback
        );
      }

      // Re-throw jika sudah AIProviderError (non-429 errors)
      if (error instanceof AIProviderError) {
        throw error;
      }

      // Unexpected error
      console.error('[Groq] Unexpected error', {
        message: (error as Error).message,
      });

      throw new AIProviderError(
        `Groq unexpected error: ${(error as Error).message}`,
        ErrorCategory.UNKNOWN,
        'groq',
        undefined,
        false,
        undefined,
      );
    }
  }

  // All keys exhausted (loop finished without return)
  if (lastError) throw lastError;
  throw new AIProviderError(
    'All Groq API keys exhausted or unavailable',
    ErrorCategory.RATE_LIMIT,
    'groq',
    429,
    false,
  );
}

  private parseRetryAfter(headers: Headers): number | undefined {
    const val = headers.get('Retry-After');
    if (!val) return undefined;
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
    return undefined;
  }

  /**
   * Health check — validates API key via the models list endpoint.
   * Avoids consuming rate-limited inference quota on a 30s health interval.
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Fast Intent & Entity Extraction (Groq Gatekeeper)
   */
  async extractIntent(
    message: string,
    contextSummary?: string
  ): Promise<ExtractedIntent> {
    const prompt = `You are a high-speed intent extraction gatekeeper for a WhatsApp e-commerce CRM bot in Indonesia.
Analyze the user message and existing context summary, then output ONLY a valid JSON object.

Intents:
- PRODUCT_INQUIRY: Asking about product details, availability, price, stock, catalog.
- ADD_TO_CART: Wanting to buy or add item(s) to order (e.g., "mau beli kangkung", "ambil 2", "pesan ini").
- DONE_ORDERING: Done adding items to cart, ready for total/address/checkout (e.g., "udah itu aja", "gak ada lagi", "checkout", "selesai").
- MODIFY_CART: Changing mind mid-transaction, swapping, replacing, removing items (e.g., "gak jadi kangkung, ganti bayam", "batalin wortel", "kurangin 1").
- PAYMENT_INQUIRY: Asking about bank accounts, QRIS, payment methods, COD.
- SHIPPING_INQUIRY: Asking about postage fees, shipping options, delivery time, pickup.
- FAQ_INQUIRY: Asking store operational hours, location, warranty, return policy.
- COMPLEX_CONVERSATION: Negotiating, complaining, off-topic, or multi-topic questions requiring human-like conversational response.

Context Summary: ${contextSummary || 'None'}
User Message: "${message}"

JSON Response Format:
{
  "intent": "PRODUCT_INQUIRY",
  "confidence": 0.9,
  "entities": {
    "productNames": ["product_name"],
    "quantities": [1],
    "action": "inquire",
    "cancelledProduct": null,
    "addedProduct": null,
    "shippingAddress": null,
    "customerNotes": null
  },
  "reasoning": "brief explanation"
}`;

    try {
      const defaults = await getAiDefaults();
      const response = await this.generate(prompt, {
        temperature: defaults.buySignalTemperature,
        maxTokens: 300,
        jsonMode: true,
      });

      const parsed = JSON.parse(response.content) as ExtractedIntent;
      if (!parsed.intent) {
        throw new Error('Invalid JSON structure from Groq intent extraction');
      }
      return parsed;
    } catch (err) {
      console.warn('[Groq] Intent extraction failed, returning default fallback intent:', (err as Error).message);
      return {
        intent: 'COMPLEX_CONVERSATION',
        confidence: 0.3,
        entities: {},
        reasoning: 'Fallback due to extraction error',
      };
    }
  }

  /**
   * Kategorisasi HTTP status code ke ErrorCategory
   */
  private categorizeHttpError(statusCode: number): ErrorCategory {
    if (statusCode === 429) return ErrorCategory.RATE_LIMIT;
    if (statusCode >= 500) return ErrorCategory.SERVER_ERROR;
    if (statusCode === 401 || statusCode === 403) return ErrorCategory.AUTH_ERROR;
    if (statusCode === 400) return ErrorCategory.VALIDATION_ERROR;
    return ErrorCategory.UNKNOWN;
  }

  /**
   * Observability-only: read & sanitize the provider error body for a non-2xx
   * response. Captures error.code/type/message only — never the prompt,
   * customer content, API key, or request headers. Returns '' if unavailable.
   */
  private async extractProviderError(response: Response): Promise<string> {
    const MAX_PROVIDER_ERROR_CHARS = 1000;
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
        return JSON.stringify(summary).slice(0, MAX_PROVIDER_ERROR_CHARS);
      }
      return raw.slice(0, MAX_PROVIDER_ERROR_CHARS);
    } catch {
      return raw.slice(0, MAX_PROVIDER_ERROR_CHARS);
    }
  }
}

export const groqAdapter = new GroqAdapter();
