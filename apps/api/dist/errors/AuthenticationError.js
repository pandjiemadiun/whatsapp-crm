import { ApiError } from './ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
export class AuthenticationError extends ApiError {
    constructor(message, code = ErrorCodes.ERR_AUTH_CREDENTIALS) {
        super(code, message);
        this.name = 'AuthenticationError';
    }
}
//# sourceMappingURL=AuthenticationError.js.map