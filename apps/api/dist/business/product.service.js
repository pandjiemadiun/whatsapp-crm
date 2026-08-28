import { prisma } from '../infrastructure/prisma.js';
import { adapters } from '../adapters/container.js';
import { ApiError } from '../errors/ApiError.js';
import { ValidationError } from '../errors/ValidationError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
/** Batas maksimal hasil pencarian produk */
const SEARCH_LIMIT = 20;
// Stopwords — hapus dari query natural untuk ekstrak keyword yang meaningful.
// Konsisten dengan FAQ/Knowledge service, ditambah kata tanya transaksional umum.
const PRODUCT_STOPWORDS = new Set([
    'apa', 'bagaimana', 'dimana', 'kapan', 'siapa', 'mengapa',
    'yang', 'dan', 'di', 'ke', 'dari', 'dengan', 'untuk', 'pada',
    'adalah', 'bisa', 'saya', 'tolong', 'apakah',
    'berapa', 'harga', 'harganya', 'hargnya', 'dong', 'ya', 'sih',
    'gan', 'kak', 'bro', 'min', 'admin', 'bang', 'mbak', 'mas',
    'beli', 'mau', 'ingin', 'cari', 'nyari', 'pesan', 'order',
    'ada', 'nggak', 'gak', 'ga', 'gk', 'ada ga', 'ada gak',
    // BUG-10 fix: payment/banking keywords agar tidak bocor ke product search
    'bayar', 'pembayaran', 'pembayarannya', 'transfer', 'rekening',
    'cod', 'qris', 'cash', 'delivery', 'metode',
    // BUG-12 fix: shipping keywords agar tidak bocor ke product search
    'ongkir', 'ongkos', 'kirim', 'pengiriman', 'kurir',
    // Structural words
    'pakai', 'menggunakan', 'lewat', 'via', 'cara', 'gimana',
]);
function extractKeywords(text) {
    return text
        .split(/\s+/)
        .filter(w => w.length > 1 && !PRODUCT_STOPWORDS.has(w.toLowerCase()));
}
export class ProductService {
    /**
     * Ambil semua kategori aktif milik toko, urut displayOrder ASC.
     */
    async getCategoriesByStore(storeId) {
        try {
            const rows = await prisma.productCategory.findMany({
                where: { storeId, isActive: true, deletedAt: null },
                orderBy: { displayOrder: 'asc' },
            });
            return rows.map((r) => this.mapCategory(r));
        }
        catch (error) {
            adapters.logger.error('Failed to fetch categories', error, { storeId });
            throw new ApiError(ErrorCodes.ERR_DB, 'Failed to fetch categories');
        }
    }
    /**
     * List semua produk aktif untuk katalog toko (untuk tryCatalog).
     */
    async listActiveProducts(storeId) {
        try {
            const rows = await prisma.product.findMany({
                where: { storeId, isActive: true, deletedAt: null },
                orderBy: { createdAt: 'desc' },
            });
            return rows.map((r) => this.mapProduct(r));
        }
        catch (error) {
            adapters.logger.error('Failed to list active products', error, { storeId });
            throw new ApiError(ErrorCodes.ERR_DB, 'Failed to list active products');
        }
    }
    /**
     * Ambil produk aktif dalam satu kategori, urut createdAt DESC.
     */
    async getProductsByCategory(categoryId) {
        try {
            const rows = await prisma.product.findMany({
                where: { categoryId, isActive: true, deletedAt: null },
                orderBy: { createdAt: 'desc' },
            });
            return rows.map((r) => this.mapProduct(r));
        }
        catch (error) {
            adapters.logger.error('Failed to fetch products by category', error, { categoryId });
            throw new ApiError(ErrorCodes.ERR_DB, 'Failed to fetch products by category');
        }
    }
    /**
     * Related products — same store + same category as the source product,
     * active, non-deleted, excluding the source itself.
     * Enforces tenant isolation: a cross-tenant productId throws NOT_FOUND.
     */
    async getRelatedProducts(productId, opts) {
        const source = await prisma.product.findUnique({ where: { id: productId } });
        if (!source || source.storeId !== opts.storeId || source.deletedAt) {
            throw new ApiError(ErrorCodes.ERR_NOT_FOUND, 'Product not found');
        }
        if (!source.categoryId) {
            return [];
        }
        try {
            const rows = await prisma.product.findMany({
                where: {
                    storeId: opts.storeId,
                    categoryId: source.categoryId,
                    isActive: true,
                    deletedAt: null,
                    NOT: { id: productId },
                },
                orderBy: { createdAt: 'desc' },
            });
            return rows.map((r) => this.mapProduct(r));
        }
        catch (error) {
            adapters.logger.error('Failed to fetch related products', error, { productId, storeId: opts.storeId });
            throw new ApiError(ErrorCodes.ERR_DB, 'Failed to fetch related products');
        }
    }
    /**
     * Cari produk dalam toko berdasarkan nama/sku/deskripsi (case-insensitive).
     * Hasil diurutkan: nama cocok lebih dulu, dibatasi 20 item.
     */
    async searchProducts(storeId, query) {
        const q = query.trim();
        if (!q)
            return [];
        // Ekstrak keyword meaningful — abaikan stopwords
        const keywords = extractKeywords(q.toLowerCase());
        try {
            // Cari per kata: setiap keyword signifikan dicari di name/sku/description
            // Fallback ke contains(q) utuh jika semua kata adalah stopwords
            const nameFilters = keywords.length > 0
                ? keywords.map(kw => ({ name: { contains: kw, mode: 'insensitive' } }))
                : [{ name: { contains: q.toLowerCase(), mode: 'insensitive' } }];
            const rows = await prisma.product.findMany({
                where: {
                    storeId,
                    isActive: true,
                    deletedAt: null,
                    OR: nameFilters,
                },
                orderBy: { createdAt: 'desc' },
                take: SEARCH_LIMIT,
            });
            const lowerQ = q.toLowerCase();
            return rows
                .map((r) => this.mapProduct(r))
                .sort((a, b) => {
                const aName = a.name.toLowerCase();
                const bName = b.name.toLowerCase();
                // Score: jumlah keyword yang match di nama produk
                const aHits = keywords.filter(kw => aName.includes(kw)).length;
                const bHits = keywords.filter(kw => bName.includes(kw)).length;
                if (aHits !== bHits)
                    return bHits - aHits;
                // Tiebreak: starts-with
                const aStarts = aName.startsWith(lowerQ) ? 0 : 1;
                const bStarts = bName.startsWith(lowerQ) ? 0 : 1;
                if (aStarts !== bStarts)
                    return aStarts - bStarts;
                return 0;
            });
        }
        catch (error) {
            adapters.logger.error('Failed to search products', error, { storeId, query });
            throw new ApiError(ErrorCodes.ERR_DB, 'Failed to search products');
        }
    }
    /**
     * Ambil produk by ID. Melempar error jika tidak ditemukan atau sudah di-soft-delete.
     */
    async getProductById(productId) {
        const row = await prisma.product.findUnique({
            where: { id: productId },
            include: { category: true },
        });
        if (!row || row.deletedAt) {
            throw new ApiError(ErrorCodes.ERR_NOT_FOUND, `Product ${productId} not found`);
        }
        const mapped = this.mapProduct(row);
        // Lampirkan kategori pada detail (optional)
        if (row.category) {
            mapped.category = this.mapCategory(row.category);
        }
        return mapped;
    }
    /**
     * Cek ketersediaan stok. stock null = tidak terbatas.
     */
    async checkStockAvailability(productId, quantity) {
        const product = await this.getProductById(productId);
        if (product.stock === null)
            return true;
        return product.stock >= quantity;
    }
    /**
     * Buat produk baru. Validasi kategori milik toko yang sama.
     */
    async createProduct(storeId, categoryId, data) {
        if (!data.name?.trim()) {
            throw new ValidationError('Product name is required');
        }
        if (typeof data.price !== 'number' || data.price < 0) {
            throw new ValidationError('Product price must be a non-negative number');
        }
        if (categoryId) {
            const category = await prisma.productCategory.findFirst({
                where: { id: categoryId, storeId, deletedAt: null },
            });
            if (!category) {
                throw new ApiError(ErrorCodes.ERR_NOT_FOUND, `Category ${categoryId} not found for store`);
            }
        }
        const images = data.images ?? [];
        const primaryImageUrl = images[0]?.url ?? null;
        try {
            const row = await prisma.product.create({
                data: {
                    storeId,
                    categoryId,
                    name: data.name.trim(),
                    description: data.description ?? null,
                    price: data.price,
                    currency: data.currency ?? 'IDR',
                    sku: data.sku ?? null,
                    stock: data.stock ?? null,
                    weight: data.weight,
                    images: images.length ? images : undefined,
                    primaryImageUrl,
                },
            });
            adapters.logger.info('Product created', { productId: row.id, storeId });
            return this.mapProduct(row);
        }
        catch (error) {
            adapters.logger.error('Failed to create product', error, { storeId });
            throw new ApiError(ErrorCodes.ERR_DB, 'Failed to create product');
        }
    }
    /**
     * Update produk. Field yang dikirim parsial.
     */
    async updateProduct(productId, data) {
        const existing = await this.getProductById(productId);
        try {
            const row = await prisma.product.update({
                where: { id: productId },
                data: {
                    name: data.name ?? undefined,
                    description: data.description ?? undefined,
                    price: data.price ?? undefined,
                    currency: data.currency ?? undefined,
                    sku: data.sku ?? undefined,
                    stock: data.stock ?? undefined,
                    weight: data.weight ?? undefined,
                    isActive: data.isActive ?? undefined,
                    categoryId: data.categoryId ?? undefined,
                    images: data.images ? data.images : undefined,
                    primaryImageUrl: data.images?.[0]?.url ?? undefined,
                },
            });
            adapters.logger.info('Product updated', { productId, storeId: existing.storeId });
            return this.mapProduct(row);
        }
        catch (error) {
            adapters.logger.error('Failed to update product', error, { productId });
            throw new ApiError(ErrorCodes.ERR_DB, 'Failed to update product');
        }
    }
    /**
     * Soft-delete produk (set deletedAt).
     */
    async deleteProduct(productId) {
        await this.getProductById(productId);
        try {
            await prisma.product.update({
                where: { id: productId },
                data: { deletedAt: new Date(), isActive: false },
            });
            adapters.logger.info('Product soft-deleted', { productId });
        }
        catch (error) {
            adapters.logger.error('Failed to delete product', error, { productId });
            throw new ApiError(ErrorCodes.ERR_DB, 'Failed to delete product');
        }
    }
    // ================================================================
    // PV-P3 — ProductVariant CRUD + hasVariants transactional write
    // ================================================================
    /**
     * Create a ProductVariant for a product.
     * Flips Product.hasVariants = true in the SAME transaction if this is the first variant.
     */
    async createVariant(productId, storeId, data) {
        // Verify product exists and belongs to store
        const product = await prisma.product.findFirst({
            where: { id: productId, storeId, deletedAt: null },
        });
        if (!product) {
            throw new ApiError(ErrorCodes.ERR_NOT_FOUND, 'Product not found');
        }
        // SKU uniqueness check within store
        if (data.sku) {
            const existingSku = await prisma.productVariant.findFirst({
                where: { storeId, sku: data.sku },
            });
            if (existingSku) {
                throw new ApiError(ErrorCodes.ERR_CONFLICT, `SKU "${data.sku}" already exists for this store`);
            }
        }
        return await prisma.$transaction(async (tx) => {
            // Create the variant
            const variant = await tx.productVariant.create({
                data: {
                    productId,
                    storeId,
                    price: data.price,
                    stock: data.stock ?? null,
                    sku: data.sku ?? null,
                    attributes: data.attributes,
                    isActive: true,
                },
            });
            // Flip hasVariants = true (idempotent if already true)
            await tx.product.update({
                where: { id: productId },
                data: { hasVariants: true },
            });
            adapters.logger.info('ProductVariant created', { variantId: variant.id, productId, storeId });
            return variant;
        });
    }
    /**
     * List variants for a product.
     */
    async listVariants(productId, storeId) {
        // Verify product exists and belongs to store
        const product = await prisma.product.findFirst({
            where: { id: productId, storeId, deletedAt: null },
        });
        if (!product) {
            throw new ApiError(ErrorCodes.ERR_NOT_FOUND, 'Product not found');
        }
        return await prisma.productVariant.findMany({
            where: { productId },
            orderBy: { createdAt: 'asc' },
        });
    }
    async getMappedVariants(productId, storeId) {
        const variants = await this.listVariants(productId, storeId);
        return variants
            .filter((v) => v.isActive)
            .map((v) => {
            let label = 'Varian';
            if (v.attributes && typeof v.attributes === 'object' && !Array.isArray(v.attributes)) {
                const parts = Object.values(v.attributes)
                    .filter((val) => val !== null && val !== undefined && val !== '')
                    .map((val) => String(val));
                if (parts.length > 0)
                    label = parts.join(' · ');
            }
            if (label === 'Varian' && v.sku)
                label = v.sku;
            return {
                id: v.id,
                label,
                price: v.price ?? null,
                stock: v.stock ?? null,
                sku: v.sku ?? null,
            };
        });
    }
    /**
     * Update a ProductVariant.
     * Does NOT touch hasVariants flag.
     * productId is immutable — cannot be changed.
     */
    async updateVariant(variantId, productId, storeId, data) {
        // Verify variant exists and belongs to product/store
        const existing = await prisma.productVariant.findFirst({
            where: { id: variantId, productId, product: { storeId, deletedAt: null } },
        });
        if (!existing) {
            throw new ApiError(ErrorCodes.ERR_NOT_FOUND, 'Variant not found');
        }
        // SKU uniqueness check (if sku is being updated)
        if (data.sku !== undefined && data.sku !== existing.sku) {
            const duplicateSku = await prisma.productVariant.findFirst({
                where: { storeId, sku: data.sku, id: { not: variantId } },
            });
            if (duplicateSku) {
                throw new ApiError(ErrorCodes.ERR_CONFLICT, `SKU "${data.sku}" already exists for this store`);
            }
        }
        const updateData = {};
        if (data.price !== undefined)
            updateData.price = data.price;
        if (data.stock !== undefined)
            updateData.stock = data.stock;
        if (data.sku !== undefined)
            updateData.sku = data.sku;
        if (data.attributes !== undefined)
            updateData.attributes = data.attributes;
        if (data.isActive !== undefined)
            updateData.isActive = data.isActive;
        const updated = await prisma.productVariant.update({
            where: { id: variantId },
            data: updateData,
        });
        adapters.logger.info('ProductVariant updated', { variantId, productId });
        return updated;
    }
    /**
     * Delete a ProductVariant.
     * Flips Product.hasVariants = false in the SAME transaction if this was the last variant.
     * Soft-delete is NOT used for variants (hard delete per Prisma schema onDelete: Cascade).
     */
    async deleteVariant(variantId, productId, storeId) {
        // Verify variant exists and belongs to product/store
        const existing = await prisma.productVariant.findFirst({
            where: { id: variantId, productId, product: { storeId, deletedAt: null } },
        });
        if (!existing) {
            throw new ApiError(ErrorCodes.ERR_NOT_FOUND, 'Variant not found');
        }
        return await prisma.$transaction(async (tx) => {
            // Delete the variant
            await tx.productVariant.delete({
                where: { id: variantId },
            });
            // Check if there are remaining variants for this product
            const remaining = await tx.productVariant.count({
                where: { productId },
            });
            // Flip hasVariants = false if no variants remain
            if (remaining === 0) {
                await tx.product.update({
                    where: { id: productId },
                    data: { hasVariants: false },
                });
            }
            adapters.logger.info('ProductVariant deleted', { variantId, productId, remaining });
        });
    }
    /**
     * List produk milik toko, opsional filter kategori.
     */
    async listProductsByStore(storeId, filter) {
        try {
            const rows = await prisma.product.findMany({
                where: {
                    storeId,
                    deletedAt: null,
                    ...(filter?.categoryId ? { categoryId: filter.categoryId } : {}),
                },
                orderBy: { createdAt: 'desc' },
            });
            return rows.map((r) => this.mapProduct(r));
        }
        catch (error) {
            adapters.logger.error('Failed to list products', error, { storeId });
            throw new ApiError(ErrorCodes.ERR_DB, 'Failed to list products');
        }
    }
    /**
     * List produk per toko dengan pagination + sort (Phase 1.9.2b).
     * Return { products, total } untuk dipakai route.
     */
    async getProductsByStore(storeId, options = {}) {
        const limit = Math.min(Math.max(1, options.limit ?? 20), 100);
        const offset = Math.max(0, options.offset ?? 0);
        const sortBy = options.sortBy ?? 'name';
        const order = options.order ?? 'asc';
        const orderBy = { [sortBy]: order };
        try {
            const [rows, total] = await Promise.all([
                prisma.product.findMany({
                    where: { storeId, deletedAt: null, isActive: true },
                    orderBy,
                    skip: offset,
                    take: limit,
                }),
                prisma.product.count({ where: { storeId, deletedAt: null, isActive: true } }),
            ]);
            return { products: rows.map((r) => this.mapProduct(r)), total };
        }
        catch (error) {
            adapters.logger.error('Failed to fetch products by store', error, { storeId });
            throw new ApiError(ErrorCodes.ERR_DB, 'Failed to fetch products by store');
        }
    }
    // ============================================================
    // Private helpers
    // ============================================================
    mapCategory(raw) {
        return {
            id: raw.id,
            storeId: raw.storeId,
            name: raw.name,
            description: raw.description,
            icon: raw.icon,
            displayOrder: raw.displayOrder,
            isActive: raw.isActive,
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
            deletedAt: raw.deletedAt,
        };
    }
    mapProduct(raw) {
        return {
            id: raw.id,
            storeId: raw.storeId,
            categoryId: raw.categoryId,
            name: raw.name,
            description: raw.description,
            price: raw.price,
            currency: raw.currency,
            sku: raw.sku,
            stock: raw.stock,
            weight: raw.weight,
            images: Array.isArray(raw.images) ? raw.images : null,
            primaryImageUrl: raw.primaryImageUrl,
            isActive: raw.isActive,
            source: raw.source ?? 'api',
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
            deletedAt: raw.deletedAt,
            hasVariants: raw.hasVariants,
        };
    }
    /**
     * Magic Paste — extract product dari teks bebas via LLM, lalu buat produk.
     * Flow: LLM extract → validasi harga → fuzzy match kategori → SKU retry → create.
     * Returns product + extractedEntities + warnings.
     *
     * @param options.preview true = hanya ekstrak (product: null), tanpa create (Phase 1.9.4 UI)
     */
    async magicPaste(storeId, text, options = {}) {
        // 1. Validasi store ada
        const store = await prisma.store.findFirst({ where: { id: storeId, deletedAt: null } });
        if (!store) {
            throw new ApiError(ErrorCodes.ERR_NOT_FOUND, `Store with ID ${storeId} not found`);
        }
        // 2. LLM extraction (fallback untuk kasus ambigu)
        const raw = await this.extractWithLLM(text, storeId);
        // 2a. Terapkan override yang di-edit user (edit-after-preview)
        if (options.overrides) {
            const ov = options.overrides;
            if (ov.name !== undefined)
                raw.name = ov.name;
            if (ov.price !== undefined)
                raw.price = ov.price;
            if (ov.stock !== undefined)
                raw.stock = ov.stock;
            if (ov.weight !== undefined)
                raw.weight = ov.weight;
            adapters.logger.info('Magic paste overrides applied', { storeId, overrides: ov });
        }
        if (raw.error || !raw.name || raw.price == null) {
            const missing = [];
            if (!raw.name)
                missing.push('name');
            if (raw.price == null)
                missing.push('price');
            adapters.logger.warn('Magic paste extraction failed', { storeId, missing });
            await this.recordMagicPasteRun({
                storeId,
                productId: null,
                textLength: text.length,
                confidence: raw.confidence ?? 0,
                status: 'failed',
                warnings: [`Missing fields: ${missing.join(', ')}`],
                extractedEntities: { name: raw.name ?? null, price: raw.price ?? null, confidence: raw.confidence ?? 0 },
                source: options.source ?? 'store',
                errorMessage: 'Cannot extract required fields from text',
            });
            throw new ApiError(ErrorCodes.ERR_MAGIC_PASTE_PARSE, 'Cannot extract required fields from text', {
                missingFields: missing,
                confidence: raw.confidence ?? 0,
                suggestion: 'Provide at least: product name, price, and stock quantity',
            });
        }
        // 3. Validasi harga (bounds)
        if (raw.price < ProductService.MIN_PRICE || raw.price > ProductService.MAX_PRICE) {
            adapters.logger.warn('Magic paste price out of bounds', { storeId, price: raw.price });
            await this.recordMagicPasteRun({
                storeId,
                productId: null,
                textLength: text.length,
                confidence: raw.confidence ?? 0,
                status: 'failed',
                warnings: [`Price ${raw.price} out of bounds`],
                extractedEntities: { name: raw.name, price: raw.price, confidence: raw.confidence ?? 0 },
                source: options.source ?? 'store',
                errorMessage: 'Price out of bounds',
            });
            throw new ApiError(ErrorCodes.ERR_PRICE_INVALID, `Price ${raw.price} exceeds maximum (${ProductService.MAX_PRICE} IDR)`, {
                extractedPrice: raw.price,
                maxAllowed: ProductService.MAX_PRICE,
                minAllowed: ProductService.MIN_PRICE,
            });
        }
        // 4. Fuzzy match kategori
        let categoryId = null;
        const warnings = [];
        if (raw.categoryName) {
            const match = await this.fuzzyMatchCategory(storeId, raw.categoryName);
            if (match) {
                categoryId = match.categoryId;
                adapters.logger.info('Category fuzzy-matched', {
                    extracted: raw.categoryName,
                    matched: match.matchedName,
                    score: match.score,
                });
            }
            else {
                warnings.push(`Category '${raw.categoryName}' not found in DB — set to uncategorized`);
            }
        }
        // 5. Proses stock
        let stock = null;
        if (typeof raw.stock === 'number' && raw.stock >= 0) {
            stock = raw.stock;
        }
        else if (raw.stockUnit || raw.unit) {
            warnings.push(`Stock ambiguous (unit-based: ${raw.stockUnit ?? raw.unit}) — set to null`);
        }
        // 6. Normalisasi harga untuk warning
        if (raw.priceDisplay && raw.priceDisplay !== String(raw.price)) {
            warnings.push(`Price format normalized: '${raw.priceDisplay}' → ${raw.price}`);
        }
        // 7. Confidence warning
        if (raw.confidence != null && raw.confidence < 0.8) {
            warnings.push(`Extraction confidence low (${raw.confidence.toFixed(2)}) — please review extracted data`);
        }
        // 8a. Preview mode — return hasil ekstraksi tanpa create produk
        if (options.preview) {
            adapters.logger.info('Magic paste preview (no create)', { storeId, confidence: raw.confidence });
            await this.recordMagicPasteRun({
                storeId,
                productId: null,
                textLength: text.length,
                confidence: raw.confidence ?? 0,
                status: 'preview',
                warnings,
                extractedEntities: {
                    name: raw.name,
                    price: raw.price,
                    stock,
                    categoryHint: raw.categoryName ?? null,
                    categoryId,
                    description: raw.description ?? null,
                    unit: raw.unit ?? null,
                    confidence: raw.confidence ?? 0,
                },
                source: options.source ?? 'store',
            });
            return {
                product: null,
                extractedEntities: {
                    name: raw.name,
                    price: raw.price,
                    stock,
                    categoryHint: raw.categoryName ?? null,
                    categoryId,
                    description: raw.description ?? null,
                    unit: raw.unit ?? null,
                    confidence: raw.confidence ?? 0,
                },
                warning: warnings.length > 0 ? warnings.slice(0, 3) : null,
            };
        }
        // 8b. Weight wajib untuk create (schema Product.weight NOT NULL, dan kita TIDAK
        //     menyimpan angka palsu). Kalau ekstraksi tidak menemukan berat di teks
        //     sumber → JANGAN insert; kembalikan sebagai preview dengan flag
        //     needsWeightInput agar UI minta owner isi manual sebelum simpan.
        if (raw.weight == null || raw.weight <= 0) {
            const weightWarning = 'Berat (gram) tidak ditemukan di teks — lengkapi manual sebelum simpan';
            adapters.logger.info('Magic paste needs weight input (no weight in source text)', {
                storeId,
                confidence: raw.confidence,
            });
            await this.recordMagicPasteRun({
                storeId,
                productId: null,
                textLength: text.length,
                confidence: raw.confidence ?? 0,
                status: 'preview',
                warnings: [...warnings, weightWarning],
                extractedEntities: {
                    name: raw.name,
                    price: raw.price,
                    stock,
                    weight: null,
                    categoryHint: raw.categoryName ?? null,
                    categoryId,
                    description: raw.description ?? null,
                    unit: raw.unit ?? null,
                    confidence: raw.confidence ?? 0,
                },
                source: options.source ?? 'store',
            });
            return {
                product: null,
                extractedEntities: {
                    name: raw.name,
                    price: raw.price,
                    stock,
                    weight: null,
                    categoryHint: raw.categoryName ?? null,
                    categoryId,
                    description: raw.description ?? null,
                    unit: raw.unit ?? null,
                    confidence: raw.confidence ?? 0,
                },
                warning: [...warnings, weightWarning].slice(0, 3),
                needsWeightInput: true,
            };
        }
        // 8c. Generate SKU unik (dengan retry)
        const sku = await this.generateUniqueSKU(storeId);
        // 9. Buat produk
        let product;
        try {
            const row = await prisma.product.create({
                data: {
                    storeId,
                    categoryId,
                    name: raw.name,
                    description: raw.description ?? null,
                    price: raw.price,
                    currency: 'IDR',
                    sku,
                    stock,
                    weight: raw.weight,
                    source: 'magic_paste',
                },
            });
            product = this.mapProduct(row);
        }
        catch (error) {
            adapters.logger.error('Magic paste create failed', error, { storeId });
            throw new ApiError(ErrorCodes.ERR_DB, 'Failed to create product');
        }
        adapters.logger.info('Magic paste product created', {
            productId: product.id,
            storeId,
            sku,
            confidence: raw.confidence,
        });
        await this.recordMagicPasteRun({
            storeId,
            productId: product.id,
            textLength: text.length,
            confidence: raw.confidence ?? 0,
            status: 'success',
            warnings,
            extractedEntities: {
                name: raw.name,
                price: raw.price,
                stock,
                weight: raw.weight,
                categoryHint: raw.categoryName ?? null,
                categoryId,
                description: raw.description ?? null,
                unit: raw.unit ?? null,
                confidence: raw.confidence ?? 0,
            },
            source: options.source ?? 'store',
        });
        return {
            product,
            extractedEntities: {
                name: raw.name,
                price: raw.price,
                stock,
                weight: raw.weight,
                categoryHint: raw.categoryName ?? null,
                categoryId,
                description: raw.description ?? null,
                unit: raw.unit ?? null,
                confidence: raw.confidence ?? 0,
            },
            warning: warnings.length > 0 ? warnings.slice(0, 3) : null,
        };
    }
    /**
     * Magic Paste BATCH — proses banyak baris sekaligus (Phase 1.9.7).
     *
     * Setiap baris diproses independen via magicPaste() (preview atau create).
     * Satu baris gagal TIDAK menggagalkan batch: hasilnya dilaporkan per-item.
     * Analytics tercatat per item (transparan) — konsisten dengan magicPaste tunggal.
     *
     * Batas aman (UKM-practical):
     *   - max 20 baris per batch
     *   - max 500 char per baris (baris lebih → skipped)
     */
    async magicPasteBatch(storeId, text, options = {}) {
        // Split baris: handle CRLF & LF, buang baris kosong
        const lines = text
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l.length > 0);
        const MAX_ITEMS = 20;
        const MAX_LINE_LEN = 500;
        const items = [];
        const limitedLines = lines.slice(0, MAX_ITEMS);
        const skippedCount = lines.length - limitedLines.length;
        for (const [i, line] of limitedLines.entries()) {
            if (line.length > MAX_LINE_LEN) {
                items.push({
                    index: i,
                    line: line.slice(0, 80) + (line.length > 80 ? '…' : ''),
                    status: 'skipped',
                    product: null,
                    extractedEntities: null,
                    error: `Baris terlalu panjang (>${MAX_LINE_LEN} karakter)`,
                    warning: null,
                });
                continue;
            }
            try {
                const result = await this.magicPaste(storeId, line, options);
                items.push({
                    index: i,
                    line,
                    status: 'success',
                    product: result.product,
                    extractedEntities: result.extractedEntities,
                    error: null,
                    warning: result.warning,
                });
            }
            catch (error) {
                items.push({
                    index: i,
                    line,
                    status: 'failed',
                    product: null,
                    extractedEntities: null,
                    error: error?.message || 'Gagal memproses baris',
                    warning: null,
                });
            }
        }
        const success = items.filter((it) => it.status === 'success').length;
        const failed = items.filter((it) => it.status === 'failed').length;
        return {
            items,
            summary: {
                total: items.length,
                success,
                failed,
                skipped: items.length - success - failed,
            },
        };
    }
    // ── Private helpers Magic Paste ──
    /**
     * Panggil LLM dengan system prompt extraction produk Indonesia.
     */
    async extractWithLLM(text, storeId) {
        // 1. Coba pattern library dulu (LLM-minimal) — hanya jika storeId tersedia
        if (storeId) {
            const settings = await this.loadSettings();
            if (settings.llmEnabled) {
                const patternResult = await this.tryPatternExtraction(text, settings);
                if (patternResult && (patternResult.confidence ?? 0) >= settings.regexFirstThreshold) {
                    adapters.logger.info('Magic paste extracted via patterns (skip LLM)', {
                        storeId,
                        confidence: patternResult.confidence,
                    });
                    return patternResult;
                }
            }
        }
        // 2. LLM extraction (hanya untuk kasus ambigu yang gagal lewat pattern)
        const prompt = `${MAGIC_PASTE_SYSTEM_PROMPT}\n\nNOW EXTRACT THIS TEXT:\n${text}`;
        try {
            const result = await adapters.ai.generate(prompt, { temperature: 0.1, maxTokens: 200 });
            const cleaned = result.content
                .replace(/```json\s*/gi, '')
                .replace(/```\s*$/g, '')
                .replace(/`/g, '')
                .trim();
            const parsed = JSON.parse(cleaned);
            // Validasi bentuk dasar
            if (typeof parsed !== 'object' || parsed === null) {
                throw new Error('LLM returned non-object');
            }
            // Normalisasi harga di app-level (jaga-jaga LLM gagal normalize)
            if (typeof parsed.price === 'string') {
                parsed.price = this.normalizePriceText(parsed.price);
            }
            if (parsed.price != null && typeof parsed.price !== 'number') {
                parsed.price = null;
            }
            // Normalisasi berat (gram). Jika LLM mengembalikan string, parse via regex.
            // Jika tidak ada / bukan angka valid → null (JANGAN tebak).
            if (typeof parsed.weight === 'string') {
                parsed.weight = this.extractWeightGrams(parsed.weight);
            }
            if (parsed.weight != null && typeof parsed.weight !== 'number') {
                parsed.weight = null;
            }
            return parsed;
        }
        catch (error) {
            adapters.logger.warn('Magic paste LLM parse failed', { error: error.message });
            // Fallback: coba regex extraction dasar (tanpa LLM) agar test mandiri
            return this.regexFallbackExtraction(text);
        }
    }
    // ─── Pattern Library + Settings (Phase 1.9.8) ───
    /**
     * Muat pattern library dari SystemSetting.
     * Jika belum ada, kembalikan default patterns.
     */
    async loadPatterns() {
        try {
            const setting = await prisma.systemSetting.findUnique({
                where: { key: 'magic_paste_patterns' },
            });
            if (!setting)
                return this.defaultPatterns();
            return JSON.parse(setting.value);
        }
        catch {
            return this.defaultPatterns();
        }
    }
    /**
     * Simpan pattern library ke SystemSetting (untuk admin API).
     */
    async savePatterns(patterns) {
        const value = JSON.stringify(patterns);
        await prisma.systemSetting.upsert({
            where: { key: 'magic_paste_patterns' },
            update: { value, updatedAt: new Date() },
            create: { key: 'magic_paste_patterns', value, category: 'magic_paste' },
        });
    }
    /**
     * Muat settings Magic Paste dari SystemSetting.
     * Jika belum ada, kembalikan default settings.
     */
    async loadSettings() {
        try {
            const setting = await prisma.systemSetting.findUnique({
                where: { key: 'magic_paste_settings' },
            });
            if (!setting)
                return this.defaultSettings();
            return { ...this.defaultSettings(), ...JSON.parse(setting.value) };
        }
        catch {
            return this.defaultSettings();
        }
    }
    /**
     * Simpan settings Magic Paste ke SystemSetting (untuk admin API).
     */
    async saveSettings(settings) {
        const value = JSON.stringify(settings);
        await prisma.systemSetting.upsert({
            where: { key: 'magic_paste_settings' },
            update: { value, updatedAt: new Date() },
            create: { key: 'magic_paste_settings', value, category: 'magic_paste' },
        });
    }
    /** Default patterns — dioptimalkan untuk format UMKM Indonesia. */
    defaultPatterns() {
        return [
            {
                id: 'name_price_stock',
                name: 'Nama Harga Stok',
                description: 'Format: Nama Produk Harga Stok (mis. "Kangkung 5000 stok 100")',
                regex: '(.+?)\\s+(?:Rp\\s*|IDR\\s*)?(\\d[\\d.,]*(?:\\s*(?:rb|ribu|juta|jt|k))?)(?:\\s*(?:stok|stock)\\s+(\\d+))?',
                fieldMappings: [
                    { field: 'name', group: 1 },
                    { field: 'price', group: 2 },
                    { field: 'stock', group: 3 },
                ],
                confidence: 0.75,
                isActive: true,
                sortOrder: 0,
            },
            {
                id: 'name_price',
                name: 'Nama Harga',
                description: 'Format: Nama Produk Harga (mis. "Beras premium 15000")',
                regex: '(.+?)\\s+(?:Rp\\s*|IDR\\s*)?(\\d[\\d.,]*(?:\\s*(?:rb|ribu|juta|jt|k))?)(?:\\s|$)',
                fieldMappings: [
                    { field: 'name', group: 1 },
                    { field: 'price', group: 2 },
                ],
                confidence: 0.65,
                isActive: true,
                sortOrder: 1,
            },
            {
                id: 'comma_separated',
                name: 'Koma Terpisah',
                description: 'Format: Nama, Harga, Stok (mis. "Kangkung, 5000, stok 100")',
                regex: '(.+?)\\s*,\\s*(?:Rp\\s*|IDR\\s*)?(\\d[\\d.,]*(?:\\s*(?:rb|ribu|juta|jt|k))?)(?:\\s*,\\s*(?:(?:stok|stock)\\s*)?(\\d+))?',
                fieldMappings: [
                    { field: 'name', group: 1 },
                    { field: 'price', group: 2 },
                    { field: 'stock', group: 3 },
                ],
                confidence: 0.7,
                isActive: true,
                sortOrder: 2,
            },
        ];
    }
    /** Default settings. */
    defaultSettings() {
        return {
            regexFirstThreshold: 0.7,
            llmEnabled: true,
            cacheEnabled: true,
        };
    }
    /**
     * Coba ekstrak pakai pattern library.
     * Jika pattern match dan confidence mencapai threshold, return hasil.
     * Jika tidak match, kembalikan null agar LLM yang menangani.
     */
    async tryPatternExtraction(text, settings) {
        const patterns = await this.loadPatterns();
        const active = patterns
            .filter((p) => p.isActive)
            .sort((a, b) => a.sortOrder - b.sortOrder);
        for (const pattern of active) {
            try {
                const regex = new RegExp(pattern.regex, 'gi');
                const match = text.match(regex);
                if (!match)
                    continue;
                const result = {
                    name: null,
                    price: null,
                    stock: null,
                    stockUnit: null,
                    categoryName: null,
                    unit: null,
                    description: null,
                    weight: this.extractWeightGrams(text),
                    confidence: pattern.confidence,
                };
                for (const mapping of pattern.fieldMappings) {
                    const raw = match[mapping.group];
                    if (raw === undefined || raw === '')
                        continue;
                    if (mapping.field === 'name') {
                        result.name = raw.trim();
                    }
                    else if (mapping.field === 'price') {
                        result.price = this.normalizePriceText(raw);
                    }
                    else if (mapping.field === 'stock') {
                        result.stock = parseInt(raw, 10);
                    }
                    else if (mapping.field === 'categoryName') {
                        result.categoryName = raw.trim();
                    }
                }
                // Hanya return jika ada name dan price (minimal requirement)
                if (result.name && result.price != null) {
                    return result;
                }
            }
            catch (error) {
                adapters.logger.warn('Pattern regex error', {
                    patternId: pattern.id,
                    error: error.message,
                });
            }
        }
        return null;
    }
    /**
     * Fallback extraction via regex — dipakai jika LLM gagal/unavailable
     * (mendukung format harga Indonesia + unit stock).
     */
    regexFallbackExtraction(text) {
        const normalized = text.trim();
        // Hapus pola kuantitas (mis. "1kg", "500gr", "100 ikat") agar tidak
        // salah terbaca sebagai harga pada regex fallback.
        const withoutQuantities = normalized.replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|gr|gram|grams|g|pcs|ikat|dus|botol|kaleng|bungkus|sachet|kemasan|helai|biji|pack|lusin|kodi)\b/gi, '');
        // Price: angka penuh (dukung 5000, 5.000, 5,000) + multiplier
        // Menempel: "5rb", "15rb", "5K", "1juta" — multiplier diikuti non-word (bukan huruf lanjutan)
        // Ber-spasi: "5 ribu", "1 juta" — kata penuh dengan word boundary
        const priceMatch = withoutQuantities.match(/(?:rp\s*|idr\s*)?(\d+(?:[.,]\d+)*)(?:(?:rb|ribu|juta|jt|[km])(?!\w)|\s+(?:rb|ribu|juta|jt)\b)?/i);
        let name = withoutQuantities.split(/(?:rp\s*|idr\s*)?\d[\d.,]*(?:(?:rb|ribu|juta|jt|[km])(?!\w)|\s+(?:rb|ribu|juta|jt)\b)?/i)[0]?.trim() || null;
        // Stock numeric ("stok 100", "100 pcs")
        const stockMatch = normalized.match(/stok\s*[:=]?\s*(\d+)/i);
        let stock = stockMatch ? parseInt(stockMatch[1], 10) : null;
        // Unit-based stock ("per ikat", "per kg", "1/4 kg", "per dus")
        const unitMatch = normalized.match(/per\s+(\w+)/i);
        let stockUnit = null;
        if (unitMatch && stock === null) {
            stockUnit = unitMatch[1].toLowerCase();
        }
        // Kategori ("kategori sayuran hijau", "sayuran")
        const catMatch = normalized.match(/kategori\s+([a-z\s]+)/i);
        const categoryName = catMatch ? catMatch[1].trim() : null;
        // Berat (gram) — HANYA jika ada satuan berat eksplisit di teks sumber
        const weight = this.extractWeightGrams(normalized);
        // Harga
        let price = null;
        if (priceMatch) {
            price = this.normalizePriceText(priceMatch[0]);
        }
        const confidence = name && price != null ? 0.6 : 0.3;
        return {
            name,
            price,
            stock,
            stockUnit,
            categoryName,
            unit: stockUnit,
            weight,
            description: null,
            priceDisplay: priceMatch ? priceMatch[0].trim() : undefined,
            confidence,
        };
    }
    /**
     * Normalisasi string harga Indonesia → integer IDR.
     * "5K"→5000, "5 ribu"→5000, "5.000"→5000, "1 juta"→1000000, dst.
     */
    normalizePriceText(input) {
        let s = input.toLowerCase().trim();
        if (!s)
            return null;
        let multiplier = 1;
        if (s.includes('juta') || s.includes('jt') || /m\b/.test(s)) {
            multiplier = 1000000;
            s = s.replace(/juta|jt/g, '').replace(/\bm\b/, '');
        }
        else if (s.includes('ribu') || s.includes('rb') || /k\b/.test(s)) {
            multiplier = 1000;
            s = s.replace(/ribu|rb/g, '').replace(/\bk\b/, '');
        }
        // Hapus simbol/space/pemisah
        s = s.replace(/rp|idr|\.|,|\s+/g, '');
        const num = parseInt(s, 10);
        if (Number.isNaN(num))
            return null;
        return num * multiplier;
    }
    /**
     * Ekstrak berat dari teks sumber → gram. HANYA jika ada angka + satuan berat
     * eksplisit (gr/gram/g/kg/kilogram). kg → ×1000. Jika tidak ada, return null
     * (JANGAN tebak — berat kosong = butuh input manual, bukan angka palsu).
     */
    extractWeightGrams(text) {
        if (!text)
            return null;
        const m = text.match(/(\d+(?:[.,]\d+)?)\s*(kg|kilogram|gram|grams|gr|g)\b/i);
        if (!m)
            return null;
        const value = parseFloat(m[1].replace(',', '.'));
        const unit = m[2].toLowerCase();
        const grams = unit === 'kg' || unit === 'kilogram' ? value * 1000 : value;
        return Number.isFinite(grams) && grams > 0 ? Math.round(grams) : null;
    }
    /**
     * Fuzzy match nama kategori terhadap kategori aktif milik store.
     * Skor = 1 (exact) · substring match ≥ 0.8 · ratio-based otherwise.
     * Threshold: >= 0.75.
     */
    async fuzzyMatchCategory(storeId, categoryNameText) {
        const categories = await prisma.productCategory.findMany({
            where: { storeId, isActive: true, deletedAt: null },
            select: { id: true, name: true },
        });
        if (!categories.length)
            return null;
        const target = categoryNameText.toLowerCase().trim();
        let best = null;
        for (const cat of categories) {
            const name = cat.name.toLowerCase().trim();
            let score;
            if (name === target)
                score = 1;
            else if (name.includes(target) || target.includes(name))
                score = 0.85;
            else {
                // Token-level: salah satu kata target cocok dgn kata kategori (prefix ≥ 4 huruf)
                const targetTokens = target.split(/[\s\-_]+/).filter((t) => t.length >= 3);
                const nameTokens = name.split(/[\s\-_]+/).filter((t) => t.length >= 3);
                let tokenMatch = false;
                for (const tt of targetTokens) {
                    for (const nt of nameTokens) {
                        const prefixHit = nt.startsWith(tt) || tt.startsWith(nt);
                        const containsHit = nt.length >= 4 && tt.length >= 4 && (nt.includes(tt) || tt.includes(nt));
                        if (prefixHit || containsHit) {
                            tokenMatch = true;
                            break;
                        }
                    }
                    if (tokenMatch)
                        break;
                }
                score = tokenMatch ? 0.8 : this.stringSimilarity(name, target);
            }
            if (!best || score > best.score)
                best = { id: cat.id, name: cat.name, score };
        }
        if (!best || best.score < 0.75)
            return null;
        return { categoryId: best.id, score: best.score, matchedName: best.name };
    }
    /**
     * Similarity sederhana (bigram Dice coefficient) — ringan, tanpa dependency.
     */
    stringSimilarity(a, b) {
        if (a === b)
            return 1;
        if (!a || !b)
            return 0;
        const bigrams = (s) => {
            const set = new Set();
            for (let i = 0; i < s.length - 1; i++)
                set.add(s.slice(i, i + 2));
            return set;
        };
        const ba = bigrams(a);
        const bb = bigrams(b);
        let intersection = 0;
        for (const g of ba)
            if (bb.has(g))
                intersection++;
        return (2 * intersection) / (ba.size + bb.size || 1);
    }
    /**
     * Generate SKU unik AUTO-{6 char store}-{timestamp}. Retry 5x pada collision.
     */
    async generateUniqueSKU(storeId) {
        const prefix = `AUTO-${storeId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase()}`;
        const baseTime = Date.now();
        for (let attempt = 1; attempt <= ProductService.SKU_MAX_RETRIES; attempt++) {
            const sku = `${prefix}-${baseTime + attempt - 1}`;
            try {
                const existing = await prisma.product.findFirst({
                    where: { storeId, sku, deletedAt: null },
                    select: { id: true },
                });
                if (!existing)
                    return sku;
                adapters.logger.debug(`SKU retry attempt ${attempt}/${ProductService.SKU_MAX_RETRIES}`, { sku });
            }
            catch (error) {
                adapters.logger.error('SKU check failed', error, { sku });
            }
        }
        throw new ApiError(ErrorCodes.ERR_SKU_GENERATION_FAILED, 'Unable to generate unique SKU after 5 attempts', {
            attemptedSkus: Array.from({ length: ProductService.SKU_MAX_RETRIES }, (_, i) => `${prefix}-${baseTime + i}`),
            suggestion: 'Try again or contact support',
        });
    }
    /**
     * Catat satu eksekusi Magic Paste ke tabel magic_paste_runs.
     * Basis data analytics confidence (Phase 1.9.6). Best-effort — kegagalan
     * pencatatan tidak boleh mengganggu alur utama.
     */
    async recordMagicPasteRun(input) {
        try {
            await prisma.magicPasteRun.create({
                data: {
                    storeId: input.storeId,
                    productId: input.productId,
                    textLength: input.textLength,
                    confidence: input.confidence,
                    status: input.status,
                    warnings: input.warnings.length ? input.warnings : undefined,
                    extractedEntities: input.extractedEntities,
                    source: input.source,
                    errorMessage: input.errorMessage ?? null,
                },
            });
        }
        catch (error) {
            adapters.logger.error('Failed to record magic paste run', error, {
                storeId: input.storeId,
                status: input.status,
            });
        }
    }
}
// ============================================================
// Phase 1.9.3 — Magic Paste
// ============================================================
/** Batas atas harga (IDR) */
ProductService.MAX_PRICE = 10000000;
/** Batas bawah harga (IDR) */
ProductService.MIN_PRICE = 1;
/** Maksimal percobaan generate SKU unik */
ProductService.SKU_MAX_RETRIES = 5;
/** System prompt extraction produk (Phase 1.9.3) */
const MAGIC_PASTE_SYSTEM_PROMPT = `You are a product data extraction assistant for Indonesian UMKM e-commerce.
Extract structured product information from unstructured text.

EXTRACTION RULES:

1. NAME (required):
   - Product name, 3-100 characters
   - Trim whitespace
   - Examples: "Kangkung segar", "Tahu putih", "Beras pera"

2. PRICE (required):
   - Normalize to integer IDR
   - Support formats: "5000", "5K", "5 ribu", "5rb", "5.000", "5,000", "Rp 5000", "IDR 5000"
   - "K"/"rb"/"ribu" = x 1000
   - "M"/"juta" = x 1,000,000
   - Units like "kg", "gr", "g", "pcs", "ikat", "dus" indicate quantity/unit — NOT price multipliers
   - Example: "bawang 1kg 40.000" → price: 40000 (not 1 or 1000)
   - Remove currency symbols, spaces, punctuation
   - Output: integer only
   - Validation: must be > 0 AND < 10,000,000

3. STOCK (optional):
   - If numeric ("100", "50 pcs"): return integer value
   - If unit-based ("per kg", "per ikat", "per dus"): return null
   - If not mentioned: return null

4. CATEGORY (optional):
   - Extract category name if mentioned (e.g., "sayuran", "buah", "daging")
   - Return as string (will be fuzzy-matched by backend)

5. UNIT (optional):
   - Extract unit of measurement if mentioned
   - Examples: "kg", "ikat", "pcs", "dus", "gram"

6. WEIGHT (optional but IMPORTANT for shipping):
   - Extract product weight in GRAMS if explicitly mentioned
   - Examples: "200gr" → 200, "500 gram" → 500, "1kg" → 1000, "0.5 kg" → 500, "250 g" → 250
   - Normalize ALL to grams: kg/kilogram = x 1000
   - ONLY extract if a weight is explicitly stated with a weight unit (gr/gram/g/kg)
   - If NO weight is mentioned in the text → set to null. NEVER invent or guess a weight.

7. DESCRIPTION (optional):
   - Additional notes or attributes (max 100 chars)

8. CONFIDENCE (required):
   - Score 0-1 for extraction accuracy
   - 0.95-1.0: all fields clear
   - 0.8-0.94: most fields clear, small ambiguity
   - 0.65-0.79: some ambiguity, missing optional fields
   - < 0.65: high uncertainty

RESPONSE FORMAT:
Return ONLY valid JSON (no markdown, no explanation):
{"name":"string","price":number,"stock":number|null,"categoryName":"string|null","unit":"string|null","weight":number|null,"description":"string|null","confidence":number}

ERROR RESPONSE (if cannot extract required fields):
{"error":"Missing required fields: {field1}, {field2}","confidence":0.0,"rawText":"{original_text}"}`;
export const productService = new ProductService();
//# sourceMappingURL=product.service.js.map