import { Router } from 'express';
import { adminAuthMiddleware } from '../../middleware/adminAuth.js';
import { validateRequest, getValidated } from '../../middleware/validate-request.js';
import { productService } from '../../business/product.service.js';
import { prisma } from '../../infrastructure/prisma.js';
import { adapters } from '../../adapters/container.js';
import { logAction } from '../../business/auditLog.service.js';
import { createProductSchema, updateProductSchema, magicPasteSchema, } from '../../schemas/index.js';
import { ApiError } from '../../errors/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
const router = Router();
// Semua admin product routes butuh auth admin (UUID token via admin_auth_tokens)
router.use(adminAuthMiddleware);
/**
 * GET /api/admin/stores/:storeId/products?limit=50&offset=0
 * List all products for a specific store (admin view — can read any store).
 */
router.get('/stores/:storeId/products', asyncHandler(async (req, res) => {
    const { storeId } = req.params;
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 20), 100);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const store = await prisma.store.findFirst({ where: { id: storeId, deletedAt: null } });
    if (!store) {
        return res.status(404).json({ error: 'Store not found' });
    }
    const result = await productService.getProductsByStore(storeId, { limit, offset });
    // Refresh R2 presigned URLs (same as store-owner endpoint)
    const refreshUrl = adapters.catalogStorage.refreshImageUrl
        ? adapters.catalogStorage.refreshImageUrl.bind(adapters.catalogStorage)
        : (u) => u;
    for (const p of result.products) {
        if (p.primaryImageUrl && typeof refreshUrl === 'function') {
            p.primaryImageUrl = await refreshUrl(p.primaryImageUrl);
        }
        if (Array.isArray(p.images)) {
            p.images = await Promise.all(p.images.map(async (img) => ({ ...img, url: await refreshUrl(img.url) })));
        }
    }
    res.json({
        success: true,
        data: {
            products: result.products,
            total: result.total,
            limit,
            offset,
        },
    });
}));
/**
 * POST /api/admin/products/magic-paste
 * Auto-create product dari unstructured text via LLM extraction (Phase 1.9.3).
 * Query ?preview=true → hanya ekstrak, tanpa create (Phase 1.9.4 UI).
 */
router.post('/products/magic-paste', validateRequest(magicPasteSchema, 'body'), async (req, res) => {
    try {
        const { storeId, text } = getValidated(req);
        const preview = req.query.preview === 'true';
        const result = await productService.magicPaste(storeId, text, { preview, source: 'admin' });
        if (!preview) {
            await logAction({
                storeId,
                action: 'product_magic_paste',
                entity: 'Product',
                entityId: result.product.id,
                adminId: req.admin.adminId,
                changes: {
                    name: result.product.name,
                    sku: result.product.sku,
                    confidence: result.extractedEntities.confidence,
                    warnings: result.warning,
                },
                ipAddress: req.ip,
            });
            adapters.logger.info('Magic paste completed', {
                productId: result.product.id,
                storeId,
                adminId: req.admin.adminId,
            });
            return res.status(201).json({ success: true, data: result });
        }
        // Preview mode — 200 tanpa create
        adapters.logger.info('Magic paste preview', { storeId, adminId: req.admin.adminId });
        return res.status(200).json({ success: true, data: result });
    }
    catch (error) {
        if (error instanceof ApiError) {
            const payload = {
                success: false,
                error: {
                    code: error.code,
                    message: error.message,
                },
            };
            if (error.details)
                payload.error = { ...payload.error, details: error.details };
            return res.status(error.statusCode).json(payload);
        }
        adapters.logger.error('Magic paste failed', error);
        res.status(500).json({
            success: false,
            error: { code: 'ERR_INTERNAL_SERVER_ERROR', message: 'Internal server error. Please try again.' },
        });
    }
});
/**
 * POST /api/admin/stores/:storeId/products
 * Buat produk baru untuk store tertentu (auth admin).
 */
router.post('/stores/:storeId/products', validateRequest(createProductSchema, 'body'), async (req, res) => {
    try {
        const { storeId } = req.params;
        const body = getValidated(req);
        const store = await prisma.store.findFirst({ where: { id: storeId, deletedAt: null } });
        if (!store) {
            return res.status(404).json({ error: 'Store not found' });
        }
        // Validasi kategori milik store (jika categoryId diberikan)
        if (body.categoryId) {
            const category = await prisma.productCategory.findFirst({
                where: { id: body.categoryId, storeId, deletedAt: null },
            });
            if (!category) {
                return res.status(404).json({ error: 'Category not found for this store' });
            }
        }
        // SKU uniqueness per store — cek manual agar pesan 400 (bukan 500 dari unique constraint)
        if (body.sku) {
            const existing = await prisma.product.findFirst({
                where: { storeId, sku: body.sku, deletedAt: null },
            });
            if (existing) {
                return res.status(400).json({ error: `SKU "${body.sku}" already exists for this store` });
            }
        }
        const images = body.images?.map((img, idx) => ({
            id: `img-${Date.now()}-${idx}`,
            url: img.url,
            uploadedAt: new Date(),
        }));
        const product = await productService.createProduct(storeId, body.categoryId ?? null, {
            name: body.name,
            price: body.price,
            currency: body.currency,
            description: body.description ?? undefined,
            sku: body.sku,
            stock: body.stock ?? undefined,
            images,
        });
        await logAction({
            storeId,
            action: 'product_created',
            entity: 'Product',
            entityId: product.id,
            adminId: req.admin.adminId,
            changes: { name: product.name, sku: product.sku },
            ipAddress: req.ip,
        });
        adapters.logger.info('Product created via admin', { productId: product.id, storeId, adminId: req.admin.adminId });
        res.status(201).json({ success: true, message: 'Product created', data: product });
    }
    catch (error) {
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        adapters.logger.error('Failed to create product', error);
        res.status(500).json({ error: error?.message || 'Failed to create product' });
    }
});
/**
 * PATCH /api/admin/products/:productId
 * Update produk (validasi kepemilikan store).
 */
router.patch('/products/:productId', validateRequest(updateProductSchema, 'body'), async (req, res) => {
    try {
        const { productId } = req.params;
        const body = getValidated(req);
        const product = await productService.getProductById(productId);
        // Validasi kategori baru milik store yang sama
        if (body.categoryId !== undefined && body.categoryId !== null) {
            const category = await prisma.productCategory.findFirst({
                where: { id: body.categoryId, storeId: product.storeId, deletedAt: null },
            });
            if (!category) {
                return res.status(404).json({ error: 'Category not found for this store' });
            }
        }
        const images = body.images?.map((img, idx) => ({
            id: `img-${Date.now()}-${idx}`,
            url: img.url,
            uploadedAt: new Date(),
        }));
        const updated = await productService.updateProduct(productId, {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.price !== undefined ? { price: body.price } : {}),
            ...(body.stock !== undefined ? { stock: body.stock } : {}),
            ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
            ...(body.currency !== undefined ? { currency: body.currency } : {}),
            ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
            ...(body.images !== undefined ? { images } : {}),
        });
        await logAction({
            storeId: product.storeId,
            action: 'product_updated',
            entity: 'Product',
            entityId: productId,
            adminId: req.admin.adminId,
            changes: { fields: Object.keys(body) },
            ipAddress: req.ip,
        });
        adapters.logger.info('Product updated via admin', { productId, adminId: req.admin.adminId });
        res.json({ success: true, message: 'Product updated', data: updated });
    }
    catch (error) {
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        adapters.logger.error('Failed to update product', error);
        res.status(500).json({ error: error?.message || 'Failed to update product' });
    }
});
/**
 * DELETE /api/admin/products/:productId
 * Soft-delete produk.
 */
router.delete('/products/:productId', async (req, res) => {
    try {
        const { productId } = req.params;
        const product = await productService.getProductById(productId);
        await productService.deleteProduct(productId);
        await logAction({
            storeId: product.storeId,
            action: 'product_deleted',
            entity: 'Product',
            entityId: productId,
            adminId: req.admin.adminId,
            changes: { reason: req.body?.reason || null, name: product.name },
            ipAddress: req.ip,
        });
        adapters.logger.info('Product deleted via admin', { productId, adminId: req.admin.adminId });
        res.status(204).send();
    }
    catch (error) {
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        adapters.logger.error('Failed to delete product', error);
        res.status(500).json({ error: error?.message || 'Failed to delete product' });
    }
});
// ─── GET /api/admin/stores/:storeId/categories — Active categories for store (form dropdown) ───
router.get('/stores/:storeId/categories', async (req, res) => {
    try {
        const { storeId } = req.params;
        const categories = await productService.getCategoriesByStore(storeId);
        res.json({ success: true, data: { categories } });
    }
    catch (error) {
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        adapters.logger.error('Failed to fetch categories', error);
        res.status(500).json({ error: error?.message || 'Failed to fetch categories' });
    }
});
export default router;
//# sourceMappingURL=products.js.map