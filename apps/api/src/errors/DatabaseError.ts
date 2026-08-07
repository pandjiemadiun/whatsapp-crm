import { ApiError } from './ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';

export class DatabaseError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(ErrorCodes.ERR_DB, message, details);
    this.name = 'DatabaseError';
  }
}
