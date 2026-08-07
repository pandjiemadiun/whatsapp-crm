import { Response, NextFunction } from 'express';
import { AuthenticatedAdminRequest } from './adminAuth.js';

/**
 * requireAdminRole — middleware that checks req.admin.role is among allowed roles.
 * Must be used AFTER adminAuthMiddleware.
 */
export function requireAdminRole(allowedRoles: string[]) {
  return (req: AuthenticatedAdminRequest, res: Response, next: NextFunction) => {
    if (!req.admin) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!allowedRoles.includes(req.admin.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}
