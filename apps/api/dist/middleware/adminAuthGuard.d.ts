import { Response, NextFunction } from 'express';
import { AuthenticatedAdminRequest } from './adminAuth.js';
/**
 * requireAdminRole — middleware that checks req.admin.role is among allowed roles.
 * Must be used AFTER adminAuthMiddleware.
 */
export declare function requireAdminRole(allowedRoles: string[]): (req: AuthenticatedAdminRequest, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
//# sourceMappingURL=adminAuthGuard.d.ts.map