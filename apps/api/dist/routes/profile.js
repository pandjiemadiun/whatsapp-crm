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
                slug: store.slug,
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
                originProvinceId: store.originProvinceId,
                originProvinceName: store.originProvinceName,
                originCityId: store.originCityId,
                originCityName: store.originCityName,
                originSubdistrictId: store.originSubdistrictId,
                originSubdistrictName: store.originSubdistrictName,
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
        const { name, description, businessCategory, address, phoneNumber, timezone, operatingHours, slug, originProvinceId, originProvinceName, originCityId, originCityName, originSubdistrictId, originSubdistrictName, } = req.body;
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
        if (address !== undefined) {
            if (!address || !address.trim())
                return res.status(400).json({ error: 'Alamat tidak boleh dikosongkan' });
            updateData.address = address.trim();
        }
        if (phoneNumber !== undefined) {
            if (!phoneNumber || !String(phoneNumber).trim())
                return res.status(400).json({ error: 'Nomor HP tidak boleh dikosongkan' });
            updateData.phoneNumber = String(phoneNumber).trim();
        }
        if (timezone !== undefined)
            updateData.timezone = timezone;
        if (operatingHours !== undefined)
            updateData.operatingHours = operatingHours || null;
        // Origin location (RajaOngkir IDs) — additive, client-supplied as-is.
        // No server-side hierarchy validation (provinsi↔kota↔kecamatan consistency)
        // on purpose: the cascading dropdown guarantees consistency client-side,
        // and over-validating here is scope creep for now.
        if (originProvinceId !== undefined) {
            if (!originProvinceId || !originProvinceId.trim())
                return res.status(400).json({ error: 'Provinsi tidak boleh dikosongkan' });
            updateData.originProvinceId = originProvinceId.trim();
        }
        if (originProvinceName !== undefined) {
            if (!originProvinceName || !originProvinceName.trim())
                return res.status(400).json({ error: 'Nama provinsi tidak boleh dikosongkan' });
            updateData.originProvinceName = originProvinceName.trim();
        }
        if (originCityId !== undefined) {
            if (!originCityId || !originCityId.trim())
                return res.status(400).json({ error: 'Kota tidak boleh dikosongkan' });
            updateData.originCityId = originCityId.trim();
        }
        if (originCityName !== undefined) {
            if (!originCityName || !originCityName.trim())
                return res.status(400).json({ error: 'Nama kota tidak boleh dikosongkan' });
            updateData.originCityName = originCityName.trim();
        }
        if (originSubdistrictId !== undefined) {
            if (!originSubdistrictId || !originSubdistrictId.trim())
                return res.status(400).json({ error: 'Kecamatan tidak boleh dikosongkan' });
            updateData.originSubdistrictId = originSubdistrictId.trim();
        }
        if (originSubdistrictName !== undefined) {
            if (!originSubdistrictName || !originSubdistrictName.trim())
                return res.status(400).json({ error: 'Nama kecamatan tidak boleh dikosongkan' });
            updateData.originSubdistrictName = originSubdistrictName.trim();
        }
        // Slug: hanya update bila dikirim berupa value nonempty. Empty/null/undefined
        // → biarkan slug lama (merchant bisa mengupdate field lain tanpa sentuh slug).
        if (slug !== undefined && slug !== null && String(slug).trim() !== '') {
            const slugStr = String(slug).trim().toLowerCase();
            // Validasi FORMAT sebelum masuk Prisma: huruf kecil, angka, dash;
            // tidak boleh diawali/diakhiri dash; tidak ada dash berurut; 3-50 karakter.
            // Ini validasi format karakter saja — sistem tidak menilai makna semantik
            // (mis. apakah "toko-0812xxx" berisi nomor WA). Lebih aman dibanding
            // menunggu Postgres menolak via constraint, memberi error 400 yang jelas.
            if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugStr) || slugStr.length < 3 || slugStr.length > 50) {
                return res.status(400).json({
                    error: 'Slug tidak valid. Gunakan huruf kecil, angka, dan dash saja (mis. toko-makmur). Panjang 3-50 karakter, tidak boleh diawali/diakhiri dash.',
                });
            }
            updateData.slug = slugStr;
        }
        const store = await prisma.store.update({ where: { id: storeId }, data: updateData });
        // Auto-generate and save system prompt if not already set
        await promptBuilderService.saveInitialPromptIfMissing(storeId);
        res.json({
            success: true,
            data: {
                name: store.name,
                slug: store.slug,
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
        // Unique constraint violation (slug dipakai toko lain) → 409.
        // Pola per-route seperti auth.ts:80-81. Pesan spesifik agar merchant tahu
        // ini collision slug, BUKAN error internal generik. P2002 ditangkap di level
        // DB oleh Postgres unique index — tidak ada pre-check SELECT yang bisa
        // menimbulkan race condition false-negative.
        if (error?.code === 'P2002') {
            return res.status(409).json({ error: 'Slug sudah digunakan toko lain, coba yang lain' });
        }
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