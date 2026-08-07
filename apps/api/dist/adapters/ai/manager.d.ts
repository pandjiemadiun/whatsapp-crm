import { AIProvider, AIGenerateOptions, AIResponse, ErrorCategory, ExtractedIntent } from './types.js';
import { GroqAdapter } from './groq.adapter.js';
export declare class AIProviderManager {
    private primaryProvider;
    private fallbackProvider;
    private gatekeeperProvider;
    private breaker;
    private stats;
    constructor(primary?: AIProvider, // GEMINI SEKARANG PRIMARY SPEAKER (Natural Conversation)
    fallback?: AIProvider, // GROQ SEKARANG FALLBACK SPEAKER
    gatekeeper?: GroqAdapter);
    /**
     * Fast Intent & Entity Gatekeeper via Groq
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