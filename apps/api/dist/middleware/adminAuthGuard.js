/**
 * requireAdminRole — middleware that checks req.admin.role is among allowed roles.
 * Must be used AFTER adminAuthMiddleware.
 */
export function requireAdminRole(allowedRoles) {
    return (req, res, next) => {
        if (!req.admin) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        if (!allowedRoles.includes(req.admin.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
}
//# sourceMappingURL=adminAuthGuard.js.map