/**
 * AI Provider Interface - Strategy Pattern
 * Defines contract for all AI provider implementations
 */

export interface AIGenerateOptions {
  temperature?: number;      // 0.0 - 1.0
  maxTokens?: number;        // Output token limit
  topP?: number;             // Nucleus sampling
  jsonMode?: boolean;        // Request JSON object response format
  intent?: string;           // LLM call purpose for tracking
  conversationId?: string;   // For token usage correlation
  retryAfter?: number;       // Parsed from 429 Retry-After header
}

export type IntentType =
  | 'PRODUCT_INQUIRY'
  | 'ADD_TO_CART'
  | 'DONE_ORDERING'
  | 'MODIFY_CART'
  | 'PAYMENT_INQUIRY'
  | 'SHIPPING_INQUIRY'
  | 'FAQ_INQUIRY'
  | 'COMPLEX_CONVERSATION';

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
  cost: number;              // USD
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
export enum ErrorCategory {
  RATE_LIMIT = 'RATE_LIMIT',                    // HTTP 429
  SERVER_ERROR = 'SERVER_ERROR',                // HTTP 5xx
  NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',          // Fetch timeout
  AUTH_ERROR = 'AUTH_ERROR',                    // HTTP 401, 403
  VALIDATION_ERROR = 'VALIDATION_ERROR',        // HTTP 400
  UNKNOWN = 'UNKNOWN',
}

/**
 * Extended Error dengan metadata untuk fallback decision
 */
export class AIProviderError extends Error {
  constructor(
    public message: string,
    public category: ErrorCategory,
    public provider: string,
    public statusCode?: number,
    public retryable: boolean = false,
    public retryAfter?: number,
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

