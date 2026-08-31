import { Router } from 'express';
import crypto from 'crypto';
import { adapters } from '../../adapters/container.js';
import { hashPassword, verifyPassword } from '../../utils/password.util.js';
import { adminAuthMiddleware } from '../../middleware/adminAuth.js';
import { requireAdminRole } from '../../middleware/adminAuthGuard.js';
import { prisma } from '../../infrastructure/prisma.js';
import { validateRequest, getValidated } from '../../middleware/validate-request.js';
import { loginSchema, registerAdminSchema, adminResetPasswordSchema } from '../../schemas/index.js';
import { adminAuthLimiter } from '../../middleware/rate-limiters.js';
import { logAction } from '../../business/auditLog.service.js';
// Bootstrap gate: allows ONE unauthenticated registration when no super_admin exists,
// then locks forever (requires existing super_admin to create new admins).
async function bootstrapRegistrationGate(req, res, next) {
    const superAdminCount = await prisma.adminUser.count({
        where: { role: 'super_admin', isActive: true, deletedAt: null },
    });
    if (superAdminCount === 0) {
        return next();
    }
    if (!req.admin) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    if (req.admin.role !== 'super_admin') {
        return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
}
const router = Router();
// ─── POST /api/admin/auth/register ───
router.post('/register', validateRequest(registerAdminSchema, 'body'), adminAuthLimiter, bootstrapRegistrationGate, async (req, res) => {
    try {
        const { email, password } = getValidated(req);
        const existing = await prisma.adminUser.findUnique({ where: { email } });
        if (existing && !existing.deletedAt) {
            return res.status(409).json({ error: 'Email already registered' });
        }
        // Bootstrap mode: if no super_admin exists yet, force role='super_admin'
        const superAdminCount = await prisma.adminUser.count({
            where: { role: 'super_admin', isActive: true, deletedAt: null },
        });
        const forcedRole = superAdminCount === 0 ? 'super_admin' : 'support_admin';
        const passwordHash = await hashPassword(password);
        const admin = await prisma.adminUser.create({
            data: {
                email,
                passwordHash,
                role: forcedRole,
                isActive: true,
            },
        });
        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await prisma.adminAuthToken.create({
            data: {
                adminUserId: admin.id,
                token,
                expiresAt,
            },
        });
        res.status(201).json({
            success: true,
            data: {
                adminId: admin.id,
                email: admin.email,
                role: admin.role,
                token,
            },
        });
    }
    catch (error) {
        adapters.logger.error('Admin registration failed', error);
        res.status(500).json({ error: error?.message || 'Registration failed' });
    }
});
// ─── POST /api/admin/auth/login ───
router.post('/login', validateRequest(loginSchema, 'body'), adminAuthLimiter, async (req, res) => {
    try {
        const { email, password } = getValidated(req);
        const admin = await prisma.adminUser.findFirst({
            where: { email, deletedAt: null },
        });
        if (!admin) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        if (!admin.isActive) {
            return res.status(401).json({ error: 'Account suspended' });
        }
        const { valid, needsRehash } = await verifyPassword(password, admin.passwordHash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        if (needsRehash) {
            const newHash = await hashPassword(password);
            await prisma.adminUser.update({
                where: { id: admin.id },
                data: { passwordHash: newHash },
            });
        }
        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await prisma.adminAuthToken.create({
            data: {
                adminUserId: admin.id,
                token,
                expiresAt,
            },
        });
        await prisma.adminUser.update({
            where: { id: admin.id },
            data: { lastLoginAt: new Date() },
        });
        res.json({
            success: true,
            data: {
                adminId: admin.id,
                email: admin.email,
                role: admin.role,
                token,
            },
        });
    }
    catch (error) {
        adapters.logger.error('Admin login failed', error);
        res.status(500).json({ error: error?.message || 'Login failed' });
    }
});
// ─── POST /api/admin/auth/logout ───
router.post('/logout', adminAuthMiddleware, async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader.slice(7);
        await prisma.adminAuthToken.updateMany({
            where: { token, revokedAt: null },
            data: { revokedAt: new Date() },
        });
        res.json({ success: true, message: 'Logged out' });
    }
    catch (error) {
        adapters.logger.error('Admin logout failed', error);
        res.status(500).json({ error: error?.message || 'Logout failed' });
    }
});
// ─── GET /api/admin/auth/me ───
router.get('/me', adminAuthMiddleware, async (req, res) => {
    try {
        const admin = await prisma.adminUser.findUnique({
            where: { id: req.admin.adminId },
        });
        if (!admin || admin.deletedAt) {
            return res.status(401).json({ error: 'Admin not found' });
        }
        res.json({
            success: true,
            data: {
                adminId: admin.id,
                email: admin.email,
                role: admin.role,
                isActive: admin.isActive,
                lastLoginAt: admin.lastLoginAt,
                createdAt: admin.createdAt,
            },
        });
    }
    catch (error) {
        adapters.logger.error('Admin fetch profile failed', error);
        res.status(500).json({ error: error?.message || 'Failed to fetch profile' });
    }
});
// ─── POST /api/admin/auth/reset-password-operator — Operator-only password reset ───
// This is NOT a self-service flow. Intended for:
// - super_admin to reset another admin's password
// - CLI script fallback when locked out (no valid session)
router.post('/reset-password-operator', validateRequest(adminResetPasswordSchema, 'body'), adminAuthLimiter, adminAuthMiddleware, requireAdminRole(['super_admin']), async (req, res) => {
    try {
        const { adminEmail, newPassword } = getValidated(req);
        const targetAdmin = await prisma.adminUser.findUnique({
            where: { email: adminEmail },
        });
        if (!targetAdmin || targetAdmin.deletedAt) {
            return res.status(404).json({ error: 'Admin user not found' });
        }
        if (!targetAdmin.isActive) {
            return res.status(400).json({ error: 'Admin account is inactive' });
        }
        const hashedPassword = await hashPassword(newPassword);
        await prisma.adminUser.update({
            where: { id: targetAdmin.id },
            data: { passwordHash: hashedPassword },
        });
        // Log the reset action (who reset whose password)
        // Get a storeId for the log entry (use first active store or system marker)
        const systemStore = await prisma.store.findFirst({ where: { deletedAt: null }, select: { id: true } });
        await logAction({
            storeId: systemStore?.id || 'system',
            action: 'password_reset',
            entity: 'admin_user',
            entityId: targetAdmin.id,
            adminId: req.admin.adminId,
            changes: { targetAdminEmail: targetAdmin.email },
        });
        // Invalidate all existing tokens for this admin (force re-login)
        await prisma.adminAuthToken.updateMany({
            where: { adminUserId: targetAdmin.id, revokedAt: null },
            data: { revokedAt: new Date() },
        });
        adapters.logger.info('Admin password reset', {
            byAdminId: req.admin.adminId,
            byAdminEmail: req.admin.email,
            targetAdminId: targetAdmin.id,
            targetAdminEmail: targetAdmin.email,
        });
        res.json({
            success: true,
            message: 'Password reset successfully. User will need to log in again.',
            data: {
                adminId: targetAdmin.id,
                email: targetAdmin.email,
            },
        });
    }
    catch (error) {
        adapters.logger.error('Admin password reset failed', error);
        res.status(500).json({ error: error?.message || 'Password reset failed' });
    }
});
export default router;
//# sourceMappingURL=auth.js.map