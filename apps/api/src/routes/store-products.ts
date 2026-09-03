import { Router, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import multer from 'multer';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { validateRequest, getValidated } from '../middleware/validate-request.js';
import { productService } from '../business/product.service.js';
import { prisma } from '../infrastructure/prisma.js';
import { adapters } from '../adapters/container.js';
import { ApiError } from '../errors/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import { variantOverrideSchema } from '../schemas/index.js';

const router = Router();

// Semua route di sini butuh auth store owner. storeId selalu dari token.
router.use(authMiddleware);

// Multer untuk upload gambar produk (memory storage, 3MB, image only)
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

// ─── Schema (store owner) ───
// SKU opsional untuk store owner — auto-generate jika kosong.
const createStoreProductSchema = z.object({
  name: z.string().min(1, 'Nama produk wajib diisi').max(100, 'Maksimal 100 karakter'),
  description: z.string().max(1000).optional().nullable(),
  price: z.coerce.number().min(0, 'Harga tidak boleh negatif'),
  stock: z.coerce.number().int().min(0, 'Stok tidak boleh negatif').optional().nullable(),
  weight: z.coerce.number().int().min(1, 'Berat (gram) wajib diisi dan harus >= 1'),
  sku: z.string().max(100).optional().nullable(),
  categoryId: z.string().uuid('Kategori tidak valid').optional().nullable(),
  currency: z.string().max(10).optional().default('IDR'),
});

const updateStoreProductSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional().nullable(),
  price: z.coerce.number().min(0).optional(),
  stock: z.coerce.number().int().min(0).optional().nullable(),
  weight: z.coerce.number().int().min(1, 'Berat (gram) harus >= 1').optional(),
  categoryId: z.string().uuid('Kategori tidak valid').optional().nullable(),
  isActive: z.boolean().optional(),
});

const magicPasteOwnerSchema = z.object({
  text: z
    .string()
    .min(10, 'Minimal 10 karakter')
    .max(2000, 'Maksimal 2000 karakter')
    .trim(),
  overrides: z
    .object({
      name: z.string().min(1).max(100).optional(),
      price: z.number().int().min(1).optional(),
      stock: z.number().int().min(0).nullable().optional(),
      weight: z.number().int().min(1).optional(),
    })
    .optional(),
  // PV-P3 — merchant-edited variant list (overrides raw LLM variants on create)
  variantOverrides: z.array(variantOverrideSchema).optional(),
});

function generateSku(): string {
  return `SKU-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

// ─── Helper: verifikasi produk milik store ini ───
async function getOwnedProduct(productId: string, storeId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, storeId, deletedAt: null },
  });
  if (!product) {
    throw new ApiError(ErrorCodes.ERR_NOT_FOUND, 'Produk tidak ditemukan');
  }
  return product;
}

// ─── GET /api/products/my — list produk milik sendiri ───
router.get('/my', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 20), 100);
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const result = await productService.getProductsByStore(storeId, { limit, offset });

    // Refresh R2 presigned URLs (7-hari expiry) agar thumbnail tidak broken
    const refreshUrl = adapters.catalogStorage.refreshImageUrl
      ? adapters.catalogStorage.refreshImageUrl.bind(adapters.catalogStorage)
      : (u: string) => u;
    for (const p of result.products) {
      if (p.primaryImageUrl && typeof refreshUrl === 'function') {
        p.primaryImageUrl = await refreshUrl(p.primaryImageUrl);
      }
      if (Array.isArray(p.images)) {
        p.images = await Promise.all(
          (p.images as any[]).map(async (img: any) => ({ ...img, url: await refreshUrl(img.url) }))
        );
      }
    }

    res.json({ success: true, data: { products: result.products, total: result.total, limit, offset } });
  } catch (error) {
    adapters.logger.error('List store products failed', error as Error);
    res.status(500).json({ error: 'Gagal memuat produk' });
  }
});

// ─── GET /api/products/my/:productId — detail produk milik sendiri ───
router.get('/my/:productId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const { productId } = req.params;

    const product = await productService.getProductById(productId);
    if (product.storeId !== storeId) {
      return res.status(403).json({ error: 'Produk bukan milik toko Anda' });
    }

    const variants = await prisma.productVariant.findMany({
      where: { productId, storeId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ success: true, data: { ...product, variants } });
  } catch (error: any) {
    adapters.logger.error('Get store product detail failed', error as Error);
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(500).json({ error: 'Gagal memuat detail produk' });
  }
});

// ─── POST /api/products/my — create produk ───
router.post('/my', validateRequest(createStoreProductSchema, 'body'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const input = getValidated<any>(req);

    const product = await productService.createProduct(storeId, input.categoryId ?? null, {
      name: input.name,
      price: input.price,
      stock: input.stock ?? null,
      weight: input.weight,
      sku: input.sku?.trim() || generateSku(),
      description: input.description ?? undefined,
      currency: input.currency ?? 'IDR',
    });

    res.status(201).json({ success: true, data: product });
  } catch (error: any) {
    adapters.logger.error('Create store product failed', error as Error);
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(400).json({ error: error?.message || 'Gagal membuat produk' });
  }
});

// ─── PUT /api/products/my/:productId — update produk ───
router.put('/my/:productId', validateRequest(updateStoreProductSchema, 'body'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const { productId } = req.params;
    const input = getValidated<any>(req);

    // Ownership check: produk harus milik store ini
    await getOwnedProduct(productId, storeId);

    const product = await productService.updateProduct(productId, {
      name: input.name,
      price: input.price,
      stock: input.stock ?? null,
      weight: input.weight ?? undefined,
      description: input.description ?? undefined,
      categoryId: input.categoryId ?? undefined,
      isActive: input.isActive,
    });

    res.json({ success: true, data: product });
  } catch (error: any) {
    adapters.logger.error('Update store product failed', error as Error);
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(400).json({ error: error?.message || 'Gagal mengupdate produk' });
  }
});

// ─── DELETE /api/products/my/:productId — soft delete ───
router.delete('/my/:productId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const { productId } = req.params;

    // Ownership check
    await getOwnedProduct(productId, storeId);

    await productService.deleteProduct(productId);
    res.json({ success: true });
  } catch (error: any) {
    adapters.logger.error('Delete store product failed', error as Error);
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(500).json({ error: 'Gagal menghapus produk' });
  }
});

// ─── POST /api/products/my/magic-paste — Magic Paste untuk store owner ───
// storeId selalu dari token — tidak bisa dipakai untuk store lain.
router.post('/my/magic-paste', validateRequest(magicPasteOwnerSchema, 'body'), async (req: AuthenticatedRequest, res: Response) => {
  try {
const storeId = req.user!.storeId;
    const { text, overrides, variantOverrides } = getValidated<any>(req);
    const preview = req.query.preview === 'true';

    const result = await productService.magicPaste(storeId, text, {
      preview,
      source: 'store',
      overrides,
      variantOverrides,
    });

    if (!preview && result.product) {
      adapters.logger.info('Store magic paste completed', { productId: result.product.id, storeId });
      return res.status(201).json({ success: true, data: result });
    }

    // preview mode, ATAU needsWeightInput (tidak ada produk ter-create) → 200
    adapters.logger.info('Store magic paste no-create (preview / needs-weight)', {
      storeId,
      needsWeightInput: !!result.needsWeightInput,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    adapters.logger.error('Store magic paste failed', error as Error);
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(400).json({ error: error?.message || 'Gagal memproses magic paste' });
  }
});

// ─── POST /api/products/my/magic-paste/batch — Magic Paste BATCH (multi-baris) ───
// Tiap baris diproses independen; baris gagal tidak menggagalkan batch.
// ?preview=true → hanya ekstrak semua baris, tanpa create.
router.post('/my/magic-paste/batch', validateRequest(magicPasteOwnerSchema, 'body'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const { text } = getValidated<any>(req);
    const preview = req.query.preview === 'true';

    const result = await productService.magicPasteBatch(storeId, text, { preview, source: 'store' });

    if (!preview) {
      adapters.logger.info('Store magic paste batch completed', {
        storeId,
        total: result.summary.total,
        success: result.summary.success,
        failed: result.summary.failed,
      });
      return res.status(201).json({ success: true, data: result });
    }

    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    adapters.logger.error('Store magic paste batch failed', error as Error);
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(400).json({ error: error?.message || 'Gagal memproses batch' });
  }
});

// ─── GET /api/products/my/categories — kategori milik store ───
router.get('/my/categories', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const categories = await productService.getCategoriesByStore(storeId);
    res.json({ success: true, data: categories });
  } catch (error) {
    adapters.logger.error('List store categories failed', error as Error);
    res.status(500).json({ error: 'Gagal memuat kategori' });
  }
});

// ─── POST /api/products/my/:productId/image — upload gambar produk ───
// Menyimpan gambar ke storage (R2/Cloudinary), lalu update images[] + primaryImageUrl.
router.post('/my/:productId/image', upload.single('image'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const { productId } = req.params;

    const product = await getOwnedProduct(productId, storeId);
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    const { url } = await adapters.catalogStorage.uploadImage(req.file.buffer, `garuda/products/${storeId}`);

    const existingImages = Array.isArray(product.images) ? (product.images as any[]) : [];
    const images = [...existingImages, { url }];

    const updated = await prisma.product.update({
      where: { id: productId },
      data: {
        images: images as unknown as Prisma.InputJsonValue,
        primaryImageUrl: url,
      },
    });

    adapters.logger.info('Product image uploaded', { productId, storeId });
    res.status(201).json({ success: true, data: { images, primaryImageUrl: url } });
  } catch (error: any) {
    adapters.logger.error('Product image upload failed', error as Error);
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(400).json({ error: error?.message || 'Gagal upload gambar' });
  }
});

// ─── DELETE /api/products/my/:productId/image/:index — hapus gambar produk ───
router.delete('/my/:productId/image/:index', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const { productId, index } = req.params;

    const product = await getOwnedProduct(productId, storeId);
    const idx = Number(index);
    const existingImages = Array.isArray(product.images) ? (product.images as any[]) : [];

    if (isNaN(idx) || idx < 0 || idx >= existingImages.length) {
      return res.status(400).json({ error: 'Index gambar tidak valid' });
    }

    const removed = existingImages[idx];
    const images = existingImages.filter((_, i) => i !== idx);

    await prisma.product.update({
      where: { id: productId },
      data: {
        images: images as unknown as Prisma.InputJsonValue,
        primaryImageUrl: images[0]?.url ?? null,
      },
    });

    // Best-effort hapus dari storage
    if (removed?.url && typeof adapters.catalogStorage.deleteImage === 'function') {
      try {
        const u = new URL(removed.url);
        const key = u.pathname.replace(/^\//, '');
        await adapters.catalogStorage.deleteImage(key);
      } catch { /* abaikan jika key tidak bisa di-extract */ }
    }

    // Refresh presigned URL pada gambar yang tersisa
    let refreshedUrls = images;
    if (adapters.catalogStorage.refreshImageUrl) {
      refreshedUrls = await Promise.all(
        images.map(async (img: any) => ({ ...img, url: await adapters.catalogStorage.refreshImageUrl!(img.url) }))
      );
    }
    res.json({ success: true, data: { images: refreshedUrls, primaryImageUrl: images[0]?.url ?? null } });
  } catch (error: any) {
    adapters.logger.error('Product image delete failed', error as Error);
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(400).json({ error: error?.message || 'Gagal hapus gambar' });
  }
});

export default router;
