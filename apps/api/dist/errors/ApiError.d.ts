import { ErrorCode } from '../constants/errorCodes.js';
import { ApiErrorResponse } from '../types/error.types.js';
export declare class ApiError extends Error {
    readonly code: ErrorCode;
    readonly statusCode: number;
    readonly details?: Record<string, unknown>;
    readonly requestId?: string;
    constructor(code?: ErrorCode, message?: string, details?: Record<string, unknown>);
    toJSON(isDev: boolean): ApiErrorResponse;
}
//# sourceMappingURL=ApiError.d.ts.map