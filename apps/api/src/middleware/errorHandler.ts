import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../errors/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import logger from '../utils/logger.js';

const isDev = process.env.NODE_ENV !== 'production';

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  const requestId = req.requestId || 'unknown';

  if (err instanceof ApiError) {
    logger.warn(`API error: ${err.code} — ${err.message}`, {
      code: err.code,
      statusCode: err.statusCode,
      requestId,
      path: req.path,
      method: req.method,
    });

    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      requestId,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Prisma known errors
  if (err.name === 'PrismaClientKnownRequestError') {
    const prismaErr = err as any;
    let message = 'Database error';
    if (prismaErr.code === 'P2002') message = 'Resource already exists';
    if (prismaErr.code === 'P2025') message = 'Resource not found';

    logger.error(`Database error: ${prismaErr.code}`, {
      requestId,
      path: req.path,
      dbCode: prismaErr.code,
      meta: prismaErr.meta,
    });

    res.status(409).json({
      error: message,
      code: ErrorCodes.ERR_DB_DUPLICATE,
      requestId,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Multer (file upload) errors — validation/limit, should be 400
  if (err.name === 'MulterError') {
    const multerErr = err as any;
    let message = 'Upload error';
    if (multerErr.code === 'LIMIT_FILE_SIZE') message = 'File terlalu besar (maksimal 3MB)';
    else if (multerErr.code === 'LIMIT_UNEXPECTED_FILE') message = 'Field upload tidak valid';
    logger.warn(`Multer error: ${multerErr.code}`, { requestId, path: req.path });
    res.status(400).json({ error: message, requestId, timestamp: new Date().toISOString() });
    return;
  }

  // Custom fileFilter errors (e.g. "Only image files are allowed") — Error biasa
  if (err.message && /image|file|upload/i.test(err.message) && err.stack?.includes('multer')) {
    logger.warn(`Upload validation error: ${err.message}`, { requestId, path: req.path });
    res.status(400).json({ error: err.message, requestId, timestamp: new Date().toISOString() });
    return;
  }

  // Unknown/unhandled errors
  logger.error(`Unhandled error: ${err.message}`, {
    requestId,
    path: req.path,
    method: req.method,
    stack: isDev ? err.stack : undefined,
  });

  res.status(500).json({
    error: 'Internal server error',
    code: ErrorCodes.ERR_INTERNAL_UNEXPECTED,
    requestId,
    timestamp: new Date().toISOString(),
  });
}
