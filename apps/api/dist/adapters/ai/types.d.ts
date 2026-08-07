/**
 * AI Provider Interface - Strategy Pattern
 * Defines contract for all AI provider implementations
 */
export interface AIGenerateOptions {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    jsonMode?: boolean;
    intent?: string;
    conversationId?: string;
    retryAfter?: number;
}
export type IntentType = 'PRODUCT_INQUIRY' | 'ADD_TO_CART' | 'DONE_ORDERING' | 'MODIFY_CART' | 'PAYMENT_INQUIRY' | 'SHIPPING_INQUIRY' | 'FAQ_INQUIRY' | 'COMPLEX_CONVERSATION';
export interface ExtractedIntent {
    intent: IntentType;
    confidence: number;
    entities: {
        productNames?: string[];
        quantities?: number[];
        action?: 'add' | 'remove' | 'swap' | 'inquire' | 'finalize';
        cancelledProduct?: string;
        addedProduct?: string;
        shippingAddress?: string;
        customerNotes?: string;
    };
    reasoning?: string;
}
export interface AIResponse {
    content: string;
    provider: string;
    model: string;
    tokens: {
        input: number;
        output: number;
    };
    cost: number;
}
export interface AIProvider {
    generate(prompt: string, options?: AIGenerateOptions): Promise<AIResponse>;
    getName(): string;
    getModel(): string;
    isHealthy?(): Promise<boolean>;
}
/**
 * Error classification untuk Smart Fallback logic
 */
export declare enum ErrorCategory {
    RATE_LIMIT = "RATE_LIMIT",// HTTP 429
    SERVER_ERROR = "SERVER_ERROR",// HTTP 5xx
    NETWORK_TIMEOUT = "NETWORK_TIMEOUT",// Fetch timeout
    AUTH_ERROR = "AUTH_ERROR",// HTTP 401, 403
    VALIDATION_ERROR = "VALIDATION_ERROR",// HTTP 400
    UNKNOWN = "UNKNOWN"
}
/**
 * Extended Error dengan metadata untuk fallback decision
 */
export declare class AIProviderError extends Error {
    message: string;
    category: ErrorCategory;
    provider: string;
    statusCode?: number | undefined;
    retryable: boolean;
    retryAfter?: number | undefined;
    constructor(message: string, category: ErrorCategory, provider: string, statusCode?: number | undefined, retryable?: boolean, retryAfter?: number | undefined);
}
//# sourceMappingURL=types.d.ts.map