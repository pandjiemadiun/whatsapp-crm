import { ApiError } from './ApiError.js';
import { ErrorCodes, ErrorCode } from '../constants/errorCodes.js';

export class AuthenticationError extends ApiError {
  constructor(message: string, code: ErrorCode = ErrorCodes.ERR_AUTH_CREDENTIALS) {
    super(code, message);
    this.name = 'AuthenticationError';
  }
}
