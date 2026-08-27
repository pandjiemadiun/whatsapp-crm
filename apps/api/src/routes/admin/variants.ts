import { Router, Response } from 'express';
import { adminAuthMiddleware, AuthenticatedAdminRequest } from '../../middleware/adminAuth.js';
import { validateRequest, getValidated } from '../../middleware/validate-request.js';
import { productService } from '../../business/product.service.js';
import { prisma } from '../../infrastructure/prisma.js';
import { adapters } from '../../adapters/container.js';
import { logAction } from '../../business/auditLog.service.js';
import { ApiError } from '../../errors/ApiError.js';
import {
  createVariantSchema,
  updateVariantSchema,
  CreateVariantInput,
  UpdateVariantInput,
} from '../../schemas/index.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

// Semua admin variant routes butuh auth admin
router.use(adminAuthMiddleware);

/**
 * GET /api/admin/stores/:storeId/products/:productId/variants
 * List all variants for a product.
 */
router.get(
  '/stores/:storeId/products/:productId/variants',
  asyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { storeId, productId } = req.params;

    const variants = await productService.listVariants(productId, storeId);
    res.json({ success: true, data: { variants } });
  })
);

/**
 * POST /api/admin/stores/:storeId/products/:productId/variants
 * Create a new variant for a product.
 * Flips Product.hasVariants = true in the same transaction.
 */
router.post(
  '/stores/:storeId/products/:productId/variants',
  validateRequest(createVariantSchema, 'body'),
  async (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const { storeId, productId } = req.params;
      const body = getValidated<CreateVariantInput>(req);

      // Verify product exists and belongs to store
      const product = await prisma.product.findFirst({
        where: { id: productId, storeId, deletedAt: null },
      });
      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }

      // SKU uniqueness check (clean 400, not raw Postgres error)
      if (body.sku) {
        const existingSku = await prisma.productVariant.findFirst({
          where: { storeId, sku: body.sku },
        });
        if (existingSku) {
          return res.status(400).json({ error: `SKU "${body.sku}" already exists for this store` });
        }
      }

      const variant = await productService.createVariant(productId, storeId, {
        price: body.price,
        stock: body.stock,
        sku: body.sku,
        attributes: body.attributes,
      });

      await logAction({
        storeId,
        action: 'variant_created',
        entity: 'ProductVariant',
        entityId: variant.id,
        adminId: req.admin!.adminId,
        changes: { price: variant.price, sku: variant.sku, attributes: variant.attributes },
        ipAddress: req.ip,
      });

      adapters.logger.info('Variant created via admin', { variantId: variant.id, productId, storeId });
      res.status(201).json({ success: true, message: 'Variant created', data: variant });
    } catch (error: any) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      adapters.logger.error('Failed to create variant', error as Error);
      res.status(500).json({ error: error?.message || 'Failed to create variant' });
    }
  }
);

/**
 * PATCH /api/admin/variants/:variantId
 * Update a variant (price, stock, sku, attributes, isActive).
 * productId is immutable and cannot be changed.
 */
router.patch(
  '/variants/:variantId',
  validateRequest(updateVariantSchema, 'body'),
  async (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const { variantId } = req.params;
      const body = getValidated<UpdateVariantInput>(req);

      // Look up variant to get productId and storeId for tenant scoping
      const existing = await prisma.productVariant.findFirst({
        include: { product: { select: { storeId: true } } },
      });
      // Re-query properly
      const variant = await prisma.productVariant.findUnique({
        where: { id: variantId },
        include: { product: { select: { storeId: true, id: true } } },
      });
      if (!variant) {
        return res.status(404).json({ error: 'Variant not found' });
      }

      const { storeId, id: productId } = variant.product;

      // SKU uniqueness check if sku is being updated
      if (body.sku !== undefined && body.sku !== variant.sku) {
        const duplicateSku = await prisma.productVariant.findFirst({
          where: { storeId, sku: body.sku, id: { not: variantId } },
        });
        if (duplicateSku) {
          return res.status(400).json({ error: `SKU "${body.sku}" already exists for this store` });
        }
      }

      const updated = await productService.updateVariant(variantId, productId, storeId, {
        ...(body.price !== undefined ? { price: body.price } : {}),
        ...(body.stock !== undefined ? { stock: body.stock } : {}),
        ...(body.sku !== undefined ? { sku: body.sku } : {}),
        ...(body.attributes !== undefined ? { attributes: body.attributes } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      });

      await logAction({
        storeId,
        action: 'variant_updated',
        entity: 'ProductVariant',
        entityId: variantId,
        adminId: req.admin!.adminId,
        changes: { fields: Object.keys(body) },
        ipAddress: req.ip,
      });

      adapters.logger.info('Variant updated via admin', { variantId, productId });
      res.json({ success: true, message: 'Variant updated', data: updated });
    } catch (error: any) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      adapters.logger.error('Failed to update variant', error as Error);
      res.status(500).json({ error: error?.message || 'Failed to update variant' });
    }
  }
);

/**
 * DELETE /api/admin/variants/:variantId
 * Delete a variant.
 * Flips Product.hasVariants = false in the same transaction if this was the last variant.
 */
router.delete(
  '/variants/:variantId',
  async (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const { variantId } = req.params;

      // Look up variant to get productId and storeId for tenant scoping
      const variant = await prisma.productVariant.findUnique({
        where: { id: variantId },
        include: { product: { select: { storeId: true, id: true } } },
      });
      if (!variant) {
        return res.status(404).json({ error: 'Variant not found' });
      }

      const { storeId, id: productId } = variant.product;

      await productService.deleteVariant(variantId, productId, storeId);

      await logAction({
        storeId,
        action: 'variant_deleted',
        entity: 'ProductVariant',
        entityId: variantId,
        adminId: req.admin!.adminId,
        changes: { productId },
        ipAddress: req.ip,
      });

      adapters.logger.info('Variant deleted via admin', { variantId, productId, storeId });
      res.status(204).send();
    } catch (error: any) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      adapters.logger.error('Failed to delete variant', error as Error);
      res.status(500).json({ error: error?.message || 'Failed to delete variant' });
    }
  }
);

export default router;
