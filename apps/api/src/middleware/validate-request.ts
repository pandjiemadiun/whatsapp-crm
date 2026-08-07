import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import logger from '../utils/logger.js';

export function validateRequest(schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const data = source === 'body' ? req.body : source === 'query' ? req.query : req.params;
    const result = schema.safeParse(data);

    if (!result.success) {
      logger.warn(`Validation error on ${req.path}`, {
        source,
        errors: result.error.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });

      res.status(400).json({
        error: 'Validation failed',
        details: result.error.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    (req as any).validated = result.data;
    next();
  };
}

// Helper to cast validated data in route handlers
export function getValidated<T>(req: Request): T {
  return (req as any).validated as T;
}
