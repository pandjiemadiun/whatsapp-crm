import { ErrorCode } from '../constants/errorCodes.js';
export interface ApiErrorResponse {
    code: ErrorCode;
    message: string;
    requestId?: string;
    timestamp: string;
    details?: Record<string, unknown>;
    stack?: string;
}
export interface ErrorContext {
    requestId?: string;
    userId?: string;
    userRole?: string;
    method?: string;
    path?: string;
    ip?: string;
    userAgent?: string;
}
//# sourceMappingURL=error.types.d.ts.map