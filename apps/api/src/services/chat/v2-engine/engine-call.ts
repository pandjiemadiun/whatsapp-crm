/**
 * V2 Engine — LLM Call Layer
 *
 * Standalone: callV2Engine() assembles the prompt (system prompt + context),
 * delegates to the existing LLMGateway (with its N-provider rotation,
 * cooldown, circuit-breaker, and retry logic), then parses the response
 * through V2EngineOutputSchema.
 *
 * No wiring to interpreter.ts / reasoning.ts / fallback.service.ts /
 * message-processor.service.ts.
 *
 * Implements:
 *   - prompt assembly (prompt-builder.ts + buildLLMContext UNIT2)
 *   - provider delegation (llm-gateway.ts, NOT a custom HTTP call)
 *   - jsonMode: true passthrough
 *   - Zod schema parse with graceful error return (not silent throw)
 *   - structured error results (not exceptions) so callers can branch
 */
import { LLMGateway, CircuitOpenError, llmGateway } from '../../../adapters/ai/llm-gateway.js';
import { AIProviderError, type AIResponse, type AIGenerateOptions } from '../../../adapters/ai/types.js';
import { V2EngineOutputSchema, type V2EngineOutput } from './schema.js';
import { buildV2Prompt } from './prompt-builder.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Which provider role to prefer for this call. */
export type V2ProviderRole = 'chat_primary' | 'chat_fallback';

/** Success: LLM responded and the output parsed against the schema. */
export interface V2EngineSuccess {
  success: true;
  /** The validated, typed V2 engine output. */
  data: V2EngineOutput;
  /** Provider name that produced this response (e.g. 'gemini', 'groq'). */
  provider: string;
  /** Model identifier (e.g. 'gemini-2.0-flash'). */
  model: string;
}

/** Parse-level failure: JSON malformed or schema validation failed. */
export interface V2EngineParseError {
  success: false;
  error: {
    type: 'parse_error';
    /** Human-readable explanation of what went wrong. */
    message: string;
    /** Raw LLM output for debugging (truncated to 500 chars if very long). */
    rawOutput: string;
  };
}

/** Provider-level failure: all providers in the role exhausted. */
export interface V2EngineProviderError {
  success: false;
  error: {
    type: 'provider_exhausted';
    /** Human-readable explanation. */
    message: string;
    /** Names of providers that were attempted before giving up. */
    failedProviders: string[];
  };
}

export type V2EngineResult = V2EngineSuccess | V2EngineParseError | V2EngineProviderError;

// ─────────────────────────────────────────────────────────────────────────────
// Default LLM call options for the V2 engine
// ─────────────────────────────────────────────────────────────────────────────

const V2_ENGINE_DEFAULTS: Required<Pick<AIGenerateOptions, 'temperature' | 'maxTokens' | 'topP'>> = {
  temperature: 0.7,
  maxTokens: 1024,   // GPT-OSS floor (groq.adapter.ts GPT_OSS_MAX_TOKENS_FLOOR)
  topP: 0.95,
};

// ─────────────────────────────────────────────────────────────────────────────
// JSON extraction helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attempt to extract the first JSON object from a raw string.
 *
 * jsonMode: true (response_format: json_object) should make OpenAI-compatible
 * providers return clean JSON, but non-jsonMode providers (e.g. Gemini which
 * ignores the jsonMode flag) may wrap output in markdown code fences. This
 * helper strips markdown wrapping so we get the actual JSON payload.
 *
 * Returns the parsed object, or throws if no valid JSON object can be found.
 */
function extractJson(raw: string): unknown {
  // Fast path — the content is already clean JSON
  try {
    return JSON.parse(raw);
  } catch {
    // fall through to extraction
  }

  // Try matching a JSON object inside markdown fences or raw braces
  // 1. ```json { ... } ```
  const fenceMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1]);
  }

  // 2. First { ... } block (greedy to matching close)
  const braceMatch = raw.match(/(\{[\s\S]*\})/);
  if (braceMatch) {
    return JSON.parse(braceMatch[1]);
  }

  // No JSON object found — re-throw the original parse error
  throw new SyntaxError(`No JSON object found in LLM output`);
}

/**
 * Recursively convert `null` values to `undefined`.
 *
 * LLMs (especially via json_mode / response_format) frequently emit explicit
 * `null` for absent optional JSON fields — e.g. `{"clarification_question": null}`.
 * Zod's `.optional()` only accepts `undefined`, NOT `null`. Without this
 * normalization every real LLM call that omits an optional field (by emitting
 * null) would be rejected as a parse error.
 *
 * This is a presentation-layer concern (UNIT3, the call layer), not a schema
 * concern — the schema (UNIT1) stays strict: `.optional()` means "may be
 * omitted", and null ≠ omitted in JSON.
 */
function normalizeNulls(obj: unknown): unknown {
  if (obj === null) return undefined;
  if (Array.isArray(obj)) return obj.map(normalizeNulls);
  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const normalized = normalizeNulls(v);
      if (normalized !== undefined) {
        result[k] = normalized;
      }
    }
    return result;
  }
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// callV2Engine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run a single V2 LLM call: system prompt + context → gateway.generate()
 * (with jsonMode: true and provider rotation/cooldown/retry) → Zod parse.
 *
 * Returns a discriminated-union result so callers never need try/catch:
 *
 *   - { success: true, data, provider, model }   — valid LLM response
 *   - { success: false, error: { type: 'parse_error', ... } }   — JSON/schema failure
 *   - { success: false, error: { type: 'provider_exhausted', ... } } — all providers failed
 *
 * @param context    The pre-assembled context string from buildLLMContext()
 *                   (UNIT2). Already contains STATE + HISTORY + PESAN SEKARANG.
 * @param providerRole   Which role to prefer. Passed as the `intent` label for
 *                   token-usage tracking and as metadata; the LLMGateway
 *                   internally tries all primary providers before falling
 *                   to fallback (Design §4).
 * @param _gateway   Injected gateway (defaults to the singleton llmGateway).
 *                   Tests inject a custom gateway or one configured with
 *                   mock providers + dynamic resolution.
 */
export async function callV2Engine(
  context: string,
  providerRole: V2ProviderRole,
  _gateway: LLMGateway = llmGateway,
): Promise<V2EngineResult> {
  const prompt = buildV2Prompt(context);
  const intent = `v2-engine:${providerRole}`;

  // ── 1. Delegate to the existing gateway (rotation + cooldown + retry) ──
  let response: AIResponse;
  try {
    response = await _gateway.generate(
      prompt,
      {
        ...V2_ENGINE_DEFAULTS,
        jsonMode: true,
        intent,
        conversationId: intent,
      } as AIGenerateOptions,
      intent,
    );
  } catch (err) {
    // Gateway threw — all providers in both roles exhausted (or circuit open).
    const failedProviders = _gateway.getStats().errorLog.map((e) => e.provider);

    if (err instanceof CircuitOpenError) {
      return {
        success: false,
        error: {
          type: 'provider_exhausted',
          message: `Circuit breaker OPEN — providers unavailable for role ${providerRole}: ${err.message}`,
          failedProviders,
        },
      };
    }

    const providerErr = err as AIProviderError;
    return {
      success: false,
      error: {
        type: 'provider_exhausted',
        message: `All LLM providers exhausted for role ${providerRole}: ${providerErr.message}`,
        failedProviders,
      },
    };
  }

  // ── 2. Extract JSON from LLM response ──
  let parsed: unknown;
  try {
    parsed = extractJson(response.content);
  } catch {
    return {
      success: false,
      error: {
        type: 'parse_error',
        message: `LLM output is not valid JSON (after extraction attempt). Raw output (truncated): ${response.content.slice(0, 500)}`,
        rawOutput: response.content,
      },
    };
  }

  // ── 2b. Normalize null → undefined (LLMs emit null for absent optional fields) ──
  parsed = normalizeNulls(parsed);

  // ── 3. Validate against the V2 schema ──
  const result = V2EngineOutputSchema.safeParse(parsed);
  if (!result.success) {
    return {
      success: false,
      error: {
        type: 'parse_error',
        message: `Schema validation failed: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        rawOutput: response.content,
      },
    };
  }

  // ── 4. Success ──
  return {
    success: true,
    data: result.data,
    provider: response.provider,
    model: response.model,
  };
}
