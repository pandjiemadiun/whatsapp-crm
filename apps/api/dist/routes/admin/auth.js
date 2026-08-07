import { Router } from 'express';
import crypto from 'crypto';
import { adapters } from '../../adapters/container.js';
import { hashPassword, verifyPassword } from '../../utils/password.util.js';
import { adminAuthMiddleware } from '../../middleware/adminAuth.js';
import { prisma } from '../../infrastructure/prisma.js';
import { validateRequest, getValidated } from '../../middleware/validate-request.js';
import { loginSchema, registerAdminSchema } from '../../schemas/index.js';
import { adminAuthLimiter } from '../../middleware/rate-limiters.js';
const router = Router();
// ─── POST /api/admin/auth/register ───
router.post('/register', validateRequest(registerAdminSchema, 'body'), adminAuthLimiter, async (req, res) => {
    try {
        const { email, password } = getValidated(req);
        const existing = await prisma.adminUser.findUnique({ where: { email } });
        if (existing && !existing.deletedAt) {
            return res.status(409).json({ error: 'Email already registered' });
        }
        const passwordHash = await hashPassword(password);
        const admin = await prisma.adminUser.create({
            data: {
                email,
                passwordHash,
                role: 'support_admin',
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
export default router;
//# sourceMappingURL=auth.js.map