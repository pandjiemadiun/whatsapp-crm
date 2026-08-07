import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth.js';
import { adapters } from '../adapters/container.js';
import { hashPassword, verifyPassword } from '../utils/password.util.js';
import { prisma } from '../infrastructure/prisma.js';
import { promptBuilderService } from '../services/prompt-builder.service.js';
const router = Router();
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
router.use(authMiddleware);
router.get('/', async (req, res) => {
    try {
        const store = await prisma.store.findUnique({ where: { id: req.user.storeId } });
        if (!store)
            return res.status(404).json({ error: 'Store not found' });
        // Refresh R2 presigned URLs agar tidak expire
        if (store.qrisImageUrl && typeof adapters.catalogStorage.refreshImageUrl === 'function') {
            store.qrisImageUrl = await adapters.catalogStorage.refreshImageUrl(store.qrisImageUrl);
        }
        if (store.profilePhotoUrl && typeof adapters.profileStorage.refreshImageUrl === 'function') {
            store.profilePhotoUrl = await adapters.profileStorage.refreshImageUrl(store.profilePhotoUrl);
        }
        res.json({
            success: true,
            data: {
                name: store.name,
                email: store.email,
                phoneNumber: store.phoneNumber,
                description: store.description,
                businessCategory: store.businessCategory,
                address: store.address,
                profilePhotoUrl: store.profilePhotoUrl,
                timezone: store.timezone,
                operatingHours: store.operatingHours,
                acceptsTransfer: store.acceptsTransfer,
                acceptsQris: store.acceptsQris,
                acceptsCod: store.acceptsCod,
                qrisImageUrl: store.qrisImageUrl,
                shippingMode: store.shippingMode,
                shippingFlatInCity: store.shippingFlatInCity,
                shippingFlatOutCity: store.shippingFlatOutCity,
            },
        });
    }
    catch (error) {
        adapters.logger.error('Failed to fetch profile', error);
        res.status(500).json({ error: error?.message || 'Failed to fetch profile' });
    }
});
router.put('/', async (req, res) => {
    try {
        const storeId = req.user.storeId;
        const { name, description, businessCategory, address, phoneNumber, timezone, operatingHours } = req.body;
        const updateData = {};
        if (name !== undefined) {
            if (!name.trim())
                return res.status(400).json({ error: 'Store name cannot be empty' });
            updateData.name = name.trim();
        }
        if (description !== undefined)
            updateData.description = description || null;
        if (businessCategory !== undefined)
            updateData.businessCategory = businessCategory || null;
        if (address !== undefined)
            updateData.address = address || null;
        if (phoneNumber !== undefined)
            updateData.phoneNumber = phoneNumber || null;
        if (timezone !== undefined)
            updateData.timezone = timezone;
        if (operatingHours !== undefined)
            updateData.operatingHours = operatingHours || null;
        const store = await prisma.store.update({ where: { id: storeId }, data: updateData });
        // Auto-generate and save system prompt if not already set
        await promptBuilderService.saveInitialPromptIfMissing(storeId);
        res.json({
            success: true,
            data: {
                name: store.name,
                description: store.description,
                businessCategory: store.businessCategory,
                address: store.address,
                phoneNumber: store.phoneNumber,
                timezone: store.timezone,
                operatingHours: store.operatingHours,
            },
        });
    }
    catch (error) {
        adapters.logger.error('Failed to update profile', error);
        res.status(500).json({ error: error?.message || 'Failed to update profile' });
    }
});
router.post('/photo', upload.single('photo'), async (req, res) => {
    try {
        const storeId = req.user.storeId;
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        const { url } = await adapters.profileStorage.uploadImage(req.file.buffer, `garuda/stores/${storeId}`);
        const store = await prisma.store.update({
            where: { id: storeId },
            data: { profilePhotoUrl: url },
        });
        res.json({ success: true, data: { profilePhotoUrl: store.profilePhotoUrl } });
    }
    catch (error) {
        adapters.logger.error('Failed to upload profile photo', error);
        res.status(500).json({ error: error?.message || 'Failed to upload photo' });
    }
});
router.put('/password', async (req, res) => {
    try {
        const storeId = req.user.storeId;
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'currentPassword and newPassword are required' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters' });
        }
        const setting = await prisma.storeSetting.findUnique({
            where: { storeId_key: { storeId, key: 'auth_password' } },
        });
        if (!setting)
            return res.status(404).json({ error: 'Account password not found' });
        const { valid } = await verifyPassword(currentPassword, setting.value);
        if (!valid) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        const newHash = await hashPassword(newPassword);
        await prisma.storeSetting.update({
            where: { storeId_key: { storeId, key: 'auth_password' } },
            data: { value: newHash },
        });
        res.json({ success: true, message: 'Password updated successfully' });
    }
    catch (error) {
        adapters.logger.error('Failed to change password', error);
        res.status(500).json({ error: error?.message || 'Failed to change password' });
    }
});
export default router;
//# sourceMappingURL=profile.js.map