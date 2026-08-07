import { ApiError } from './ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
export class DatabaseError extends ApiError {
    constructor(message, details) {
        super(ErrorCodes.ERR_DB, message, details);
        this.name = 'DatabaseError';
    }
}
//# sourceMappingURL=DatabaseError.js.map