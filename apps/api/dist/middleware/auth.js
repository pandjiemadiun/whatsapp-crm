import { adapters } from '../adapters/container.js';
import { prisma } from '../infrastructure/prisma.js';
export async function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }
    const token = authHeader.slice(7);
    try {
        // Find store by token in store_settings
        const setting = await prisma.storeSetting.findFirst({
            where: { key: 'auth_token', value: token },
            include: { store: true },
        });
        if (!setting || !setting.store || setting.store.deletedAt) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        // Check token expiry
        const expirySetting = await prisma.storeSetting.findUnique({
            where: { storeId_key: { storeId: setting.storeId, key: 'auth_token_expires_at' } },
        });
        if (!expirySetting || new Date(expirySetting.value) < new Date()) {
            return res.status(401).json({ error: 'Token expired, please login again' });
        }
        req.user = {
            storeId: setting.store.id,
            email: setting.store.email || '',
        };
        next();
    }
    catch (error) {
        adapters.logger.error('Auth middleware error', error);
        return res.status(500).json({ error: 'Authentication error' });
    }
}
//# sourceMappingURL=auth.js.map