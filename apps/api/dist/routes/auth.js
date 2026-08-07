import express from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { adapters } from '../adapters/container.js';
import { fonnteService } from '../services/fonnte.service.js';
import { hashPassword, verifyPassword } from '../utils/password.util.js';
import { prisma } from '../infrastructure/prisma.js';
import { validateRequest, getValidated } from '../middleware/validate-request.js';
import { storeRegisterSchema, storeLoginSchema, updateProfileSchema } from '../schemas/index.js';
import { sanitize } from '../lib/sanitize.js';
import { storeAuthLimiter } from '../middleware/rate-limiters.js';
import { authMiddleware } from '../middleware/auth.js';
const router = express.Router();
// Generate a unique per-store webhook secret (used for Fonnte webhook URL)
function generateWebhookSecret() {
    return crypto.randomBytes(24).toString('hex');
}
// POST /api/auth/register — Register with email + password
router.post('/register', validateRequest(storeRegisterSchema, 'body'), storeAuthLimiter, async (req, res) => {
    try {
        const { email, password } = getValidated(req);
        const existing = await prisma.store.findFirst({ where: { email } });
        if (existing) {
            return res.status(409).json({ error: 'Email already registered' });
        }
        const storeId = `store-${crypto.randomUUID().slice(0, 8)}`;
        const store = await prisma.store.create({
            data: {
                id: storeId,
                name: email.split('@')[0],
                email,
                phoneNumber: null,
                webhookSecret: generateWebhookSecret(),
            },
        });
        // Store password in store_settings
        await prisma.storeSetting.create({
            data: {
                storeId: store.id,
                key: 'auth_password',
                value: await hashPassword(password),
            },
        });
        const token = crypto.randomUUID();
        // Persist token for session validation
        await prisma.storeSetting.upsert({
            where: { storeId_key: { storeId: store.id, key: 'auth_token' } },
            update: { value: token },
            create: { storeId: store.id, key: 'auth_token', value: token },
        });
        // Set token expiry to 7 days from now
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        await prisma.storeSetting.upsert({
            where: { storeId_key: { storeId: store.id, key: 'auth_token_expires_at' } },
            update: { value: expiresAt },
            create: { storeId: store.id, key: 'auth_token_expires_at', value: expiresAt },
        });
        res.status(201).json({
            success: true,
            data: {
                storeId: store.id,
                storeName: store.name,
                email: store.email,
                token,
                hasProfile: false,
            },
        });
    }
    catch (error) {
        // Unique constraint race (duplicate email created concurrently) → treat as already registered
        if (error?.code === 'P2002') {
            return res.status(409).json({ error: 'Email already registered' });
        }
        adapters.logger.error('Registration failed', error);
        res.status(500).json({ error: error?.message || 'Registration failed' });
    }
});
// POST /api/auth/login — Login with email + password, auto-create store if new
router.post('/login', validateRequest(storeLoginSchema, 'body'), storeAuthLimiter, async (req, res) => {
    try {
        const { email, password } = getValidated(req);
        // Find store by email
        let store = await prisma.store.findFirst({ where: { email, deletedAt: null } });
        // Suspend check: store non-aktif tidak boleh login
        if (store && !store.isActive) {
            return res.status(403).json({ error: 'Akun Anda telah dinonaktifkan. Silakan hubungi admin.' });
        }
        if (!store) {
            // Auto-register: create store + set password
            const storeId = `store-${crypto.randomUUID().slice(0, 8)}`;
            store = await prisma.store.create({
                data: {
                    id: storeId,
                    name: email.split('@')[0],
                    email,
                    phoneNumber: null,
                    webhookSecret: generateWebhookSecret(),
                },
            });
            await prisma.storeSetting.create({
                data: {
                    storeId: store.id,
                    key: 'auth_password',
                    value: await hashPassword(password),
                },
            });
        }
        else {
            // Verify password (mendukung hash lama SHA-256 + auto-upgrade ke bcrypt)
            const setting = await prisma.storeSetting.findUnique({
                where: { storeId_key: { storeId: store.id, key: 'auth_password' } },
            });
            if (!setting) {
                return res.status(401).json({ error: 'Invalid email or password' });
            }
            const { valid, needsRehash } = await verifyPassword(password, setting.value);
            if (!valid) {
                return res.status(401).json({ error: 'Invalid email or password' });
            }
            if (needsRehash) {
                const newHash = await hashPassword(password);
                await prisma.storeSetting.update({
                    where: { storeId_key: { storeId: store.id, key: 'auth_password' } },
                    data: { value: newHash },
                });
            }
        }
        const token = crypto.randomUUID();
        // Persist token for session validation
        await prisma.storeSetting.upsert({
            where: { storeId_key: { storeId: store.id, key: 'auth_token' } },
            update: { value: token },
            create: { storeId: store.id, key: 'auth_token', value: token },
        });
        // Set token expiry to 7 days from now
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        await prisma.storeSetting.upsert({
            where: { storeId_key: { storeId: store.id, key: 'auth_token_expires_at' } },
            update: { value: expiresAt },
            create: { storeId: store.id, key: 'auth_token_expires_at', value: expiresAt },
        });
        // Check if onboarding was completed
        const onboardingSetting = await prisma.storeSetting.findUnique({
            where: { storeId_key: { storeId: store.id, key: 'onboarding_complete' } },
        });
        const hasProfile = onboardingSetting?.value === 'true';
        res.json({
            success: true,
            data: {
                storeId: store.id,
                storeName: store.name,
                email: store.email,
                token,
                hasProfile,
            },
        });
    }
    catch (error) {
        adapters.logger.error('Login failed', error);
        res.status(500).json({ error: error?.message || 'Login failed' });
    }
});
// PUT /api/auth/profile — Update store profile (onboarding or gateway settings)
// Auth required. storeId always derived from the bearer token — never from body.
router.put('/profile', authMiddleware, validateRequest(updateProfileSchema, 'body'), async (req, res) => {
    try {
        const storeId = req.user.storeId;
        const { name, timezone, phoneNumber, fonnteToken, fonnteNumber, acceptsTransfer, acceptsQris, acceptsCod, qrisImageUrl, shippingMode, shippingFlatInCity, shippingFlatOutCity } = getValidated(req);
        if (fonnteToken !== undefined && fonnteToken !== null && fonnteToken !== '') {
            const isValid = await fonnteService.validateToken(fonnteToken);
            if (!isValid) {
                return res.status(400).json({ error: 'Fonnte token is invalid' });
            }
        }
        const updateData = {};
        if (name?.trim())
            updateData.name = sanitize(name.trim());
        if (timezone)
            updateData.timezone = timezone;
        if (phoneNumber !== undefined)
            updateData.phoneNumber = phoneNumber || null;
        if (fonnteToken !== undefined)
            updateData.fonnteToken = fonnteToken === '' ? null : fonnteToken;
        if (fonnteNumber !== undefined)
            updateData.fonnteNumber = fonnteNumber === '' ? null : fonnteNumber;
        if (acceptsTransfer !== undefined)
            updateData.acceptsTransfer = acceptsTransfer;
        if (acceptsQris !== undefined)
            updateData.acceptsQris = acceptsQris;
        if (acceptsCod !== undefined)
            updateData.acceptsCod = acceptsCod;
        if (qrisImageUrl !== undefined)
            updateData.qrisImageUrl = qrisImageUrl === '' ? null : qrisImageUrl;
        if (shippingMode !== undefined)
            updateData.shippingMode = shippingMode;
        if (shippingFlatInCity !== undefined)
            updateData.shippingFlatInCity = shippingFlatInCity;
        if (shippingFlatOutCity !== undefined)
            updateData.shippingFlatOutCity = shippingFlatOutCity;
        const store = await prisma.store.update({
            where: { id: storeId },
            data: updateData,
        });
        // Mark onboarding as complete
        await prisma.storeSetting.upsert({
            where: { storeId_key: { storeId, key: 'onboarding_complete' } },
            update: { value: 'true' },
            create: { storeId, key: 'onboarding_complete', value: 'true' },
        });
        res.json({
            success: true,
            data: {
                storeId: store.id,
                name: store.name,
                timezone: store.timezone,
                phoneNumber: store.phoneNumber,
                fonnteToken: store.fonnteToken ? '***' : null,
                fonnteNumber: store.fonnteNumber || null,
                webhookSecret: store.webhookSecret || null,
                acceptsTransfer: store.acceptsTransfer,
                acceptsQris: store.acceptsQris,
                acceptsCod: store.acceptsCod,
                qrisImageUrl: store.qrisImageUrl || null,
                shippingMode: store.shippingMode,
                shippingFlatInCity: store.shippingFlatInCity,
                shippingFlatOutCity: store.shippingFlatOutCity,
            },
        });
    }
    catch (error) {
        const msg = error?.message || '';
        if (msg.includes('Fonnte')) {
            return res.status(400).json({ error: msg });
        }
        adapters.logger.error('Failed to update profile', error);
        res.status(500).json({ error: error?.message || 'Failed to update profile' });
    }
});
// Multer config untuk upload QRIS image (memory storage, 3MB, image only)
// — sama persis dengan store-products.ts
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 3 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Only image files are allowed'));
        }
        cb(null, true);
    },
});
// POST /api/auth/profile/qris-image — upload QRIS image, update qrisImageUrl di store
router.post('/profile/qris-image', authMiddleware, upload.single('image'), async (req, res) => {
    try {
        const storeId = req.user.storeId;
        if (!req.file) {
            return res.status(400).json({ error: 'No image uploaded' });
        }
        const { url } = await adapters.catalogStorage.uploadImage(req.file.buffer, `garuda/qris/${storeId}`);
        // Update qrisImageUrl di store profile
        await prisma.store.update({
            where: { id: storeId },
            data: { qrisImageUrl: url },
        });
        adapters.logger.info('QRIS image uploaded', { storeId });
        res.status(201).json({
            success: true,
            message: 'QRIS image uploaded successfully',
            data: { qrisImageUrl: url },
        });
    }
    catch (error) {
        adapters.logger.error('QRIS image upload failed', error);
        res.status(400).json({ error: error?.message || 'Failed to upload QRIS image' });
    }
});
export default router;
//# sourceMappingURL=auth.js.map