import { Request, Response, NextFunction } from 'express';
type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<any>;
/**
 * asyncHandler — Wraps async route handlers so errors are forwarded to next().
 * No more try/catch boilerplate in route handlers.
 */
export declare function asyncHandler(fn: AsyncHandler): (req: Request, res: Response, next: NextFunction) => void;
export {};
//# sourceMappingURL=asyncHandler.d.ts.map