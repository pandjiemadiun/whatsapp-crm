import {
  AIProvider,
  AIGenerateOptions,
  AIResponse,
  AIProviderError,
  ErrorCategory,
  ExtractedIntent,
} from './types.js';
import { geminiAdapter } from './gemini.adapter.js';
import { shouldSkipProvider, triggerCooldown } from '../../services/provider-cooldown.js';
import { logTokenUsage } from '../../services/token-usage-tracker.js';
import type { TokenLogEntry } from '../../services/token-usage-tracker.js';
import { GroqAdapter, groqAdapter } from './groq.adapter.js';
import { configService } from '../../business/config.service.js';
import { aiProviderResolver } from '../../services/ai-provider-resolver.service.js';
import type { AIProviderResolverService } from '../../services/ai-provider-resolver.service.js';

export class AIProviderManager {
  private primaryProvider: AIProvider;
  private fallbackProvider: AIProvider;
  private gatekeeperProvider: GroqAdapter;

  // ── Unit 5: feature-flag-gated dynamic provider resolution (default OFF) ─
  // Same pattern as LLMGateway (Unit 3b). ON => primary/fallback come from
  // AIProviderConfig rows (chat_primary/chat_fallback) via the resolver;
  // OFF (default) => original singletons, generate() runs UNCHANGED.
  // The gatekeeper (extractIntent) is NOT resolved — it stays GroqAdapter
  // (see Option B report in the Unit 5 audit).
  private readonly resolver: AIProviderResolverService;
  private readonly dynamicFlagProvider: (() => Promise<boolean>) | undefined;
  private dynamicFlagCache: { value: boolean; ts: number } | null = null;
  private readonly DYNAMIC_FLAG_TTL_MS = 30_000;

  private breaker = {
    failures: 0,
    threshold: 5,
    resetAfterMs: 60_000,
    openedAt: 0,
  };

  private stats = {
    primary: { success: 0, failed: 0, retried: 0 },
    fallback: { success: 0, failed: 0 },
    errors: [] as { provider: string; category: ErrorCategory; timestamp: Date }[],
  };

  constructor(
    primary: AIProvider = geminiAdapter,   // GEMINI SEKARANG PRIMARY SPEAKER (Natural Conversation)
    fallback: AIProvider = groqAdapter,   // GROQ SEKARANG FALLBACK SPEAKER
    gatekeeper: GroqAdapter = groqAdapter, // GROQ SEKARANG FAST GATEKEEPER (Intent Extraction)
    resolver: AIProviderResolverService = aiProviderResolver,
    dynamicFlagProvider: (() => Promise<boolean>) | undefined = undefined,
  ) {
    this.primaryProvider = primary;
    this.fallbackProvider = fallback;
    this.gatekeeperProvider = gatekeeper;
    this.resolver = resolver;
    this.dynamicFlagProvider = dynamicFlagProvider;
  }

  /** Resolve the dynamic-provider flag. Absence of the key => OFF (never throws). */
  private async isDynamicProvidersEnabled(): Promise<boolean> {
    const now = Date.now();
    if (this.dynamicFlagCache && now - this.dynamicFlagCache.ts < this.DYNAMIC_FLAG_TTL_MS) {
      return this.dynamicFlagCache.value;
    }
    let enabled: boolean;
    if (this.dynamicFlagProvider) {
      enabled = await this.dynamicFlagProvider();
    } else {
      enabled = (await configService.getConfig('llm.useDynamicProviders')) === 'true';
    }
    this.dynamicFlagCache = { value: enabled, ts: now };
    return enabled;
  }

  /**
   * Resolve primary/fallback for this request.
   * OFF (default): returns the original singletons -> OFF path runs UNCHANGED.
   * ON: reads active AIProviderConfig rows via the resolver, highest-priority first.
   * Empty DB list for a role -> warn + fall back to the default singleton
   * (customer chat is NOT disrupted; the cutover is safe by default).
   *
   * NOTE: the gatekeeper is intentionally NOT resolved here (Option B — see
   * Unit 5 report). extractIntent is GroqAdapter-specific, not on AIProvider.
   */
  private async resolveEffectiveProviders(): Promise<{ primaryList: AIProvider[]; fallbackList: AIProvider[] }> {
    if (!(await this.isDynamicProvidersEnabled())) {
      return { primaryList: [this.primaryProvider], fallbackList: [this.fallbackProvider] };
    }

    const primaryList = await this.resolver.getProvidersForRole('chat_primary');
    const fallbackList = await this.resolver.getProvidersForRole('chat_fallback');

    return {
      primaryList: primaryList.length > 0 ? primaryList : [this.primaryProvider],
      fallbackList: fallbackList.length > 0 ? fallbackList : [this.fallbackProvider],
    };
  }

  /**
   * Fast Intent & Entity Gatekeeper via Groq (gatekeeper provider).
   * Returns fallback intent on failure — never throws.
   *
   * Unit 5 decision — Option B: the gatekeeper is pinned to the GroqAdapter
   * singleton (this.gatekeeperProvider) regardless of llm.useDynamicProviders.
   * extractIntent is GroqAdapter-specific (groq.adapter.ts:329) and is NOT on
   * the AIProvider interface, nor implemented by the Unit-2 generic adapters
   * (OpenAICompatibleAdapter / GeminiShimAdapter). Resolving it from
   * AIProviderConfig (chat_gatekeeper role) would require either adding
   * extractIntent to the shared interface (Option A) or implementing Groq-style
   * intent extraction on every adapter. Option B was chosen explicitly to
   * avoid a silent COMPLEX_CONVERSATION-for-everything regression (the Unit 3b
   * bug) and to keep the shared interface clean. `chat_gatekeeper` rows are
   * therefore cosmetic for now and are reported as an intentional limitation.
   */
  async extractIntent(
    message: string,
    contextSummary?: string
  ): Promise<ExtractedIntent> {
    try {
      return await this.gatekeeperProvider.extractIntent(message, contextSummary);
    } catch (err) {
      console.warn('[AIManager] Groq Gatekeeper failed, returning fallback intent:', (err as Error).message);
      return {
        intent: 'COMPLEX_CONVERSATION',
        confidence: 0.3,
        entities: {},
        reasoning: 'Gatekeeper error fallback',
      };
    }
  }

  async generate(
    prompt: string,
    options?: AIGenerateOptions,
    intent: string = 'general'
  ): Promise<AIResponse> {
    const { primaryList, fallbackList } = await this.resolveEffectiveProviders();

    // BAGIAN 2 - Circuit breaker
    if (this.breaker.failures >= this.breaker.threshold &&
        Date.now() - this.breaker.openedAt < this.breaker.resetAfterMs) {
      console.warn('[AIManager] Circuit breaker OPEN - all LLM providers skipped');
      throw new AIProviderError(
        'Circuit breaker open: all LLM providers exhausted',
        ErrorCategory.SERVER_ERROR,
        'circuit-breaker'
      );
    }

    // Remember the first primary error so that when BOTH roles are exhausted we
    // re-throw the primary error — preserving the original "throw primaryErr"
    // top-level error behavior (see ai-gateway.test.ts "both fail throws" pattern).
    // Manager.ts has no per-provider retry loop (unlike LLMGateway); each provider
    // is tried exactly once. On 429/RATE_LIMIT the provider is cooldedown-registered
    // and we move to the NEXT provider in the SAME role (not immediately to the
    // other role) — falling through to the other role only once the current
    // role's entire provider list is exhausted.
    let primaryErr: AIProviderError | null = null;

    const roleLists: Array<{
      providers: AIProvider[];
      roleKey: 'primary' | 'fallback';
    }> = [
      { providers: primaryList, roleKey: 'primary' },
      { providers: fallbackList, roleKey: 'fallback' },
    ];

    for (const { providers, roleKey } of roleLists) {
      const roleLabel = roleKey === 'primary' ? 'Primary' : 'Fallback';
      for (const provider of providers) {
        const name = provider.getName();
        if (shouldSkipProvider(name)) {
          console.info(`[AIManager] ${roleLabel} provider in cooldown - skipping`);
          continue;
        }

        try {
          const response = await provider.generate(prompt, options);
          this.stats[roleKey].success++;
          this.breaker.failures = 0;
          this.breaker.openedAt = 0;
          console.log(`[AIManager] ${roleLabel} provider succeeded`, {
            provider: response.provider,
            model: response.model,
            cost: response.cost.toFixed(6),
          });
          // Token usage tracking
          logTokenUsage({
            timestamp: Date.now(),
            provider: response.provider,
            model: response.model,
            intent,
            conversationId: options?.conversationId || 'unknown',
            inputTokens: response.tokens.input,
            outputTokens: response.tokens.output,
            totalTokens: response.tokens.input + response.tokens.output,
            costUsd: response.cost,
          });

          return response;
        } catch (err) {
          const error = err as AIProviderError;
          if (roleKey === 'primary') {
            primaryErr = primaryErr ?? error; // keep the FIRST primary error
          }
          this.stats[roleKey].failed++;
          if (error.category === ErrorCategory.RATE_LIMIT || error.statusCode === 429) {
            triggerCooldown(error.provider || name, error.retryAfter ? error.retryAfter * 1000 : undefined);
            this.breaker.openedAt = 0;
          } else if (error.category === ErrorCategory.SERVER_ERROR ||
                     error.category === ErrorCategory.NETWORK_TIMEOUT) {
            this.breaker.failures++;
            if (this.breaker.failures >= this.breaker.threshold) {
              this.breaker.openedAt = Date.now();
            }
          }
          this.stats.errors.push({ provider: error.provider, category: error.category, timestamp: new Date() });
          console.warn(`[AIManager] ${roleLabel} provider failed`, {
            provider: error.provider,
            category: error.category,
            retryable: error.retryable,
          });
          // No retry loop here (manager.ts tries each provider once). Fall through
          // to the NEXT provider in the SAME role. Only when all providers in this
          // role are exhausted does the outer loop move to the other role.
        }
      }
    }

    if (primaryErr) throw primaryErr;
    throw new AIProviderError(
      'All LLM providers exhausted (cooldown + errors)',
      ErrorCategory.SERVER_ERROR,
      'all-providers-exhausted'
    );
  }

  getStats() {
    return {
      primary: this.stats.primary,
      fallback: this.stats.fallback,
      errorLog: this.stats.errors.slice(-10),
    };
  }

  getProviders() {
    return {
      primary: this.primaryProvider.getName(),
      fallback: this.fallbackProvider.getName(),
      gatekeeper: this.gatekeeperProvider.getName(),
    };
  }
}

export const aiProviderManager = new AIProviderManager();
