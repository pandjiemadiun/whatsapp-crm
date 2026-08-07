/**
 * AI Provider Interface - Strategy Pattern
 * Defines contract for all AI provider implementations
 */
/**
 * Error classification untuk Smart Fallback logic
 */
export var ErrorCategory;
(function (ErrorCategory) {
    ErrorCategory["RATE_LIMIT"] = "RATE_LIMIT";
    ErrorCategory["SERVER_ERROR"] = "SERVER_ERROR";
    ErrorCategory["NETWORK_TIMEOUT"] = "NETWORK_TIMEOUT";
    ErrorCategory["AUTH_ERROR"] = "AUTH_ERROR";
    ErrorCategory["VALIDATION_ERROR"] = "VALIDATION_ERROR";
    ErrorCategory["UNKNOWN"] = "UNKNOWN";
})(ErrorCategory || (ErrorCategory = {}));
/**
 * Extended Error dengan metadata untuk fallback decision
 */
export class AIProviderError extends Error {
    constructor(message, category, provider, statusCode, retryable = false, retryAfter) {
        super(message);
        this.message = message;
        this.category = category;
        this.provider = provider;
        this.statusCode = statusCode;
        this.retryable = retryable;
        this.retryAfter = retryAfter;
        this.name = 'AIProviderError';
    }
}
//# sourceMappingURL=types.js.map