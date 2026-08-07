import { ApiError } from './ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
export class ValidationError extends ApiError {
    constructor(message, details) {
        super(ErrorCodes.ERR_VALIDATION, message, details);
        this.name = 'ValidationError';
    }
}
//# sourceMappingURL=ValidationError.js.map