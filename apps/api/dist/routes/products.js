import { Router } from 'express';
import { productService } from '../business/product.service.js';
import { prisma } from '../infrastructure/prisma.js';
import { adapters } from '../adapters/container.js';
import { validateRequest, getValidated } from '../middleware/validate-request.js';
import { listProductsQuerySchema, searchProductsQuerySchema, } from '../schemas/index.js';
import { ApiError } from '../errors/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
const router = Router();
/**
 * GET /api/stores/:storeId/products
 * List produk per toko (publik), dengan pagination + sort.
 */
router.get('/stores/:storeId/products', validateRequest(listProductsQuerySchema, 'query'), async (req, res) => {
    try {
        const { storeId } = req.params;
        const query = getValidated(req);
        const store = await prisma.store.findFirst({ where: { id: storeId, deletedAt: null } });
        if (!store) {
            return res.status(404).json({ error: 'Store not found' });
        }
        const { products, total } = await productService.getProductsByStore(storeId, {
            limit: query.limit,
            offset: query.offset,
            sortBy: query.sortBy,
            order: query.order,
        });
        const hasMore = query.offset + products.length < total;
        adapters.logger.info('Products listed', { storeId, count: products.length });
        res.json({
            success: true,
            data: {
                products,
                pagination: {
                    limit: query.limit,
                    offset: query.offset,
                    total,
                    hasMore,
                },
            },
        });
    }
    catch (error) {
        if (error instanceof ApiError && error.code === ErrorCodes.ERR_NOT_FOUND) {
            return res.status(404).json({ error: error.message });
        }
        adapters.logger.error('Failed to list products', error);
        res.status(500).json({ error: error?.message || 'Failed to list products' });
    }
});
/**
 * GET /api/stores/:storeId/products/search
 * Cari produk by nama/deskripsi/sku (case-insensitive).
 */
router.get('/stores/:storeId/products/search', validateRequest(searchProductsQuerySchema, 'query'), async (req, res) => {
    try {
        const { storeId } = req.params;
        const query = getValidated(req);
        const store = await prisma.store.findFirst({ where: { id: storeId, deletedAt: null } });
        if (!store) {
            return res.status(404).json({ error: 'Store not found' });
        }
        const results = await productService.searchProducts(storeId, query.q);
        const offset = query.offset;
        const paginated = results.slice(offset, offset + query.limit);
        adapters.logger.info('Products searched', { storeId, q: query.q, count: paginated.length });
        res.json({
            success: true,
            data: {
                query: query.q,
                results: paginated,
                pagination: {
                    total: results.length,
                    returned: paginated.length,
                    offset,
                    limit: query.limit,
                },
            },
        });
    }
    catch (error) {
        adapters.logger.error('Failed to search products', error);
        res.status(500).json({ error: error?.message || 'Failed to search products' });
    }
});
export default router;
//# sourceMappingURL=products.js.map