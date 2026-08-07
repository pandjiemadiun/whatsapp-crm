import { ErrorCodes, HttpStatusMap } from '../constants/errorCodes.js';
export class ApiError extends Error {
    constructor(code = ErrorCodes.ERR_INTERNAL, message, details) {
        super(message || code);
        this.name = 'ApiError';
        this.code = code;
        this.statusCode = HttpStatusMap[code] ?? 500;
        this.details = details;
    }
    toJSON(isDev) {
        const res = {
            code: this.code,
            message: this.message,
            timestamp: new Date().toISOString(),
        };
        if (this.requestId)
            res.requestId = this.requestId;
        if (this.details)
            res.details = this.details;
        if (isDev && this.stack)
            res.stack = this.stack;
        return res;
    }
}
//# sourceMappingURL=ApiError.js.map