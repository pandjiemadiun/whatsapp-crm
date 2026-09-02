import { AIProvider, AIGenerateOptions, AIResponse, ErrorCategory, ExtractedIntent } from './types.js';
import { GroqAdapter } from './groq.adapter.js';
import type { AIProviderResolverService } from '../../services/ai-provider-resolver.service.js';
export declare class AIProviderManager {
    private primaryProvider;
    private fallbackProvider;
    private gatekeeperProvider;
    private readonly resolver;
    private readonly dynamicFlagProvider;
    private dynamicFlagCache;
    private readonly DYNAMIC_FLAG_TTL_MS;
    private breaker;
    private stats;
    constructor(primary?: AIProvider, // GEMINI SEKARANG PRIMARY SPEAKER (Natural Conversation)
    fallback?: AIProvider, // GROQ SEKARANG FALLBACK SPEAKER
    gatekeeper?: GroqAdapter, // GROQ SEKARANG FAST GATEKEEPER (Intent Extraction)
    resolver?: AIProviderResolverService, dynamicFlagProvider?: (() => Promise<boolean>) | undefined);
    /** Resolve the dynamic-provider flag. Absence of the key => OFF (never throws). */
    private isDynamicProvidersEnabled;
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
    private resolveEffectiveProviders;
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
    extractIntent(message: string, contextSummary?: string): Promise<ExtractedIntent>;
    generate(prompt: string, options?: AIGenerateOptions, intent?: string): Promise<AIResponse>;
    getStats(): {
        primary: {
            success: number;
            failed: number;
            retried: number;
        };
        fallback: {
            success: number;
            failed: number;
        };
        errorLog: {
            provider: string;
            category: ErrorCategory;
            timestamp: Date;
        }[];
    };
    getProviders(): {
        primary: string;
        fallback: string;
        gatekeeper: string;
    };
}
export declare const aiProviderManager: AIProviderManager;
//# sourceMappingURL=manager.d.ts.map