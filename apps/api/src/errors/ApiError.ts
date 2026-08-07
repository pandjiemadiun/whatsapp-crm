import { ErrorCode, ErrorCodes, HttpStatusMap } from '../constants/errorCodes.js';
import { ApiErrorResponse } from '../types/error.types.js';

export class ApiError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;
  public readonly requestId?: string;

  constructor(
    code: ErrorCode = ErrorCodes.ERR_INTERNAL,
    message?: string,
    details?: Record<string, unknown>,
  ) {
    super(message || code);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = HttpStatusMap[code] ?? 500;
    this.details = details;
  }

  toJSON(isDev: boolean): ApiErrorResponse {
    const res: ApiErrorResponse = {
      code: this.code,
      message: this.message,
      timestamp: new Date().toISOString(),
    };
    if (this.requestId) res.requestId = this.requestId;
    if (this.details) res.details = this.details;
    if (isDev && this.stack) res.stack = this.stack;
    return res;
  }
}
