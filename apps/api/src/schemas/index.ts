import { z } from 'zod';

// ─── AUTH SCHEMAS ───

export const loginSchema = z.object({
  email: z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters').max(128, 'Password must not exceed 128 characters'),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const registerAdminSchema = z.object({
  email: z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format'),
  password: z
    .string()
    .min(6, 'Password must be at least 6 characters')
    .max(128, 'Password must not exceed 128 characters'),
});

export type RegisterAdminInput = z.infer<typeof registerAdminSchema>;

export const storeLoginSchema = z.object({
  email: z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export type StoreLoginInput = z.infer<typeof storeLoginSchema>;

export const storeRegisterSchema = z.object({
  email: z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  // Wajib diisi saat daftar toko (NOT NULL di DB).
  phoneNumber: z
    .string()
    .trim()
    .regex(/^(\+62|0)8[1-9][0-9]{6,11}$/, 'Nomor HP Indonesia tidak valid (contoh: 0812xxxxxxx atau +62812xxxxxxx)'),
  address: z.string().trim().min(1, 'Alamat wajib diisi').max(500, 'Alamat terlalu panjang'),
  originProvinceId: z.string().trim().min(1, 'Provinsi wajib dipilih'),
  originProvinceName: z.string().trim().min(1, 'Nama provinsi wajib diisi'),
  originCityId: z.string().trim().min(1, 'Kota wajib dipilih'),
  originCityName: z.string().trim().min(1, 'Nama kota wajib diisi'),
  originSubdistrictId: z.string().trim().min(1, 'Kecamatan wajib dipilih'),
  originSubdistrictName: z.string().trim().min(1, 'Nama kecamatan wajib diisi'),
});

export type StoreRegisterInput = z.infer<typeof storeRegisterSchema>;

// ─── STORE SCHEMAS ───

export const queryStoresSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  search: z.string().max(100).optional(),
  status: z.enum(['active', 'suspended']).optional(),
});

export type QueryStoresInput = z.infer<typeof queryStoresSchema>;

export const updateProfileSchema = z.object({
  storeId: z.string().min(1).optional(),
  name: z.string().min(1).max(100).optional(),
  timezone: z.string().max(50).optional(),
  phoneNumber: z.string().max(20).optional().nullable(),
  fonnteToken: z.string().optional().nullable(),
  fonnteNumber: z.string().max(20).optional().nullable(),
  acceptsTransfer: z.boolean().optional(),
  acceptsQris: z.boolean().optional(),
  acceptsCod: z.boolean().optional(),
  qrisImageUrl: z.string().nullable().optional(),
  shippingMode: z.enum(['pickup', 'flat']).optional(),
  shippingFlatInCity: z.number().optional().nullable(),
  shippingFlatOutCity: z.number().optional().nullable(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const resetPasswordSchema = z.object({
  tempPassword: z.string().min(6).max(128).optional(),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// ─── ADMIN PASSWORD RESET SCHEMA (operator-only, no email flow) ───
export const adminResetPasswordSchema = z.object({
  adminEmail: z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format'),
  newPassword: z.string().min(6, 'Password must be at least 6 characters').max(128, 'Password must not exceed 128 characters'),
});

export type AdminResetPasswordInput = z.infer<typeof adminResetPasswordSchema>;

// ─── CONVERSATION SCHEMAS ───

export const updateStatusSchema = z.object({
  status: z.enum(['open', 'closed', 'human_takeover', 'resolved'], {
    message: 'Status must be one of: open, closed, human_takeover, resolved',
  }),
});

export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;

export const replyMessageSchema = z.object({
  message: z.string().min(1, 'Message is required').max(5000, 'Message too long'),
});

export type ReplyMessageInput = z.infer<typeof replyMessageSchema>;

// ─── CONFIG SCHEMAS ───

export const updateConfigSchema = z.object({
  value: z.string().min(1, 'Value is required').max(10000, 'Value too long'),
  category: z.string().max(50).optional(),
  isSecret: z.boolean().optional(),
  description: z.string().max(200).optional(),
});

export type UpdateConfigInput = z.infer<typeof updateConfigSchema>;

// ─── PRODUCT SCHEMAS (Phase 1.9.2b) ───

export const listProductsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  sortBy: z.enum(['name', 'price', 'createdAt']).optional().default('name'),
  order: z.enum(['asc', 'desc']).optional().default('asc'),
});

export type ListProductsQueryInput = z.infer<typeof listProductsQuerySchema>;

export const searchProductsQuerySchema = z.object({
  q: z.string().min(2, 'Search query must be at least 2 characters').max(100),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type SearchProductsQueryInput = z.infer<typeof searchProductsQuerySchema>;

export const productImageSchema = z.object({
  url: z
    .string()
    .url('Image URL must be valid')
    .max(1000)
    // Blokir javascript:, vbscript:, data: (non-image) dll — cegah stored XSS
    .refine((u) => /^(https?:\/\/|data:image\/)/i.test(u), 'Image URL must be http(s) or data:image'),
  alt: z.string().max(200),
});

export const createProductSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must not exceed 100 characters'),
  description: z.string().max(1000).optional().nullable(),
  price: z.coerce.number().min(0, 'Price must be >= 0'),
  stock: z.coerce.number().int().min(0, 'Stock must be >= 0').optional().nullable(),
  weight: z.coerce.number().int().min(1, 'Weight (gram) is required and must be >= 1'),
  sku: z.string().min(1, 'SKU is required').max(100),
  categoryId: z.string().uuid('categoryId must be a valid UUID').optional().nullable(),
  currency: z.string().max(10).optional().default('IDR'),
  images: z.array(productImageSchema).max(10).optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional().nullable(),
  price: z.coerce.number().min(0).optional(),
  stock: z.coerce.number().int().min(0).optional().nullable(),
  weight: z.coerce.number().int().min(1, 'Weight (gram) must be >= 1').optional(),
  categoryId: z.string().uuid('categoryId must be a valid UUID').optional().nullable(),
  currency: z.string().max(10).optional(),
  images: z.array(productImageSchema).max(10).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateProductInput = z.infer<typeof updateProductSchema>;

// ─── MAGIC PASTE SCHEMAS (Phase 1.9.3) ───

/** PV-P3 — satu entri variantOverrides (merchant-edited, dari magic-paste preview).
 *  Aturan VALIDASI sama seperti Unit 1 LLM-path (attributes non-empty, price valid),
 *  tapi di sini STRICT: merchant data → reject malformed, jangan silent-drop. */
export const variantOverrideSchema = z.object({
  price: z.coerce.number().min(1, 'Variant price must be > 0'),
  stock: z.coerce.number().int().min(0).optional().nullable(),
  sku: z.string().max(100).optional().nullable(),
  attributes: z
    .record(z.string(), z.any())
    .refine((val) => Object.keys(val).length > 0, { message: 'attributes must be a non-empty object' }),
});
export type VariantOverride = z.infer<typeof variantOverrideSchema>;

export const magicPasteSchema = z.object({
  text: z
    .string()
    .min(10, 'Text must be at least 10 characters')
    .max(2000, 'Text must not exceed 2000 characters')
    .trim(),
  // Store ID bisa UUID (admin-created) atau format store-xxx (self-registered)
  storeId: z.string().min(1, 'storeId is required'),
  // PV-P3 — merchant-edited variant list (overrides raw LLM variants pada create)
  variantOverrides: z.array(variantOverrideSchema).optional(),
});

export type MagicPasteInput = z.infer<typeof magicPasteSchema>;

// ─── PRODUCT VARIANT SCHEMAS (PV-P3) ───

export const createVariantSchema = z.object({
  price: z.coerce.number().min(0, 'Price must be >= 0'),
  stock: z.coerce.number().int().min(0, 'Stock must be >= 0').optional().nullable(),
  sku: z.string().max(100).optional().nullable(),
  attributes: z.record(z.string(), z.any()).refine((val) => Object.keys(val).length > 0, {
    message: 'attributes must be a non-empty object',
  }),
});

export type CreateVariantInput = z.infer<typeof createVariantSchema>;

export const updateVariantSchema = z.object({
  price: z.coerce.number().min(0, 'Price must be >= 0').optional(),
  stock: z.coerce.number().int().min(0, 'Stock must be >= 0').optional().nullable(),
  sku: z.string().max(100).optional().nullable(),
  attributes: z.record(z.string(), z.any()).refine((val) => Object.keys(val).length > 0, {
    message: 'attributes must be a non-empty object',
  }).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;
