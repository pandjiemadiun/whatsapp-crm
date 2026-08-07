import { ApiError } from './ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';

export class ValidationError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(ErrorCodes.ERR_VALIDATION, message, details);
    this.name = 'ValidationError';
  }
}
