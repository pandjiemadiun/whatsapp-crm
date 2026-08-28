import type { Product, ProductCategory, ProductImage } from '../domain/types.js';
export declare class ProductService {
    /**
     * Ambil semua kategori aktif milik toko, urut displayOrder ASC.
     */
    getCategoriesByStore(storeId: string): Promise<ProductCategory[]>;
    /**
     * List semua produk aktif untuk katalog toko (untuk tryCatalog).
     */
    listActiveProducts(storeId: string): Promise<Product[]>;
    /**
     * Ambil produk aktif dalam satu kategori, urut createdAt DESC.
     */
    getProductsByCategory(categoryId: string): Promise<Product[]>;
    /**
     * Related products — same store + same category as the source product,
     * active, non-deleted, excluding the source itself.
     * Enforces tenant isolation: a cross-tenant productId throws NOT_FOUND.
     */
    getRelatedProducts(productId: string, opts: {
        storeId: string;
    }): Promise<Product[]>;
    /**
     * Cari produk dalam toko berdasarkan nama/sku/deskripsi (case-insensitive).
     * Hasil diurutkan: nama cocok lebih dulu, dibatasi 20 item.
     */
    searchProducts(storeId: string, query: string): Promise<Product[]>;
    /**
     * Ambil produk by ID. Melempar error jika tidak ditemukan atau sudah di-soft-delete.
     */
    getProductById(productId: string): Promise<Product>;
    /**
     * Cek ketersediaan stok. stock null = tidak terbatas.
     */
    checkStockAvailability(productId: string, quantity: number): Promise<boolean>;
    /**
     * Buat produk baru. Validasi kategori milik toko yang sama.
     */
    createProduct(storeId: string, categoryId: string | null, data: {
        name: string;
        price: number;
        currency?: string;
        description?: string;
        sku?: string;
        stock?: number;
        weight: number;
        images?: ProductImage[];
    }): Promise<Product>;
    /**
     * Update produk. Field yang dikirim parsial.
     */
    updateProduct(productId: string, data: Partial<Omit<Product, 'id' | 'storeId' | 'createdAt' | 'updatedAt'>>): Promise<Product>;
    /**
     * Soft-delete produk (set deletedAt).
     */
    deleteProduct(productId: string): Promise<void>;
    /**
     * Create a ProductVariant for a product.
     * Flips Product.hasVariants = true in the SAME transaction if this is the first variant.
     */
    createVariant(productId: string, storeId: string, data: {
        price: number;
        stock?: number | null;
        sku?: string | null;
        attributes: Record<string, any>;
    }): Promise<any>;
    /**
     * List variants for a product.
     */
    listVariants(productId: string, storeId: string): Promise<any[]>;
    getMappedVariants(productId: string, storeId: string): Promise<Array<{
        id: string;
        label: string;
        price: number | null;
        stock: number | null;
        sku: string | null;
    }>>;
    /**
     * Update a ProductVariant.
     * Does NOT touch hasVariants flag.
     * productId is immutable — cannot be changed.
     */
    updateVariant(variantId: string, productId: string, storeId: string, data: {
        price?: number;
        stock?: number | null;
        sku?: string | null;
        attributes?: Record<string, any>;
        isActive?: boolean;
    }): Promise<any>;
    /**
     * Delete a ProductVariant.
     * Flips Product.hasVariants = false in the SAME transaction if this was the last variant.
     * Soft-delete is NOT used for variants (hard delete per Prisma schema onDelete: Cascade).
     */
    deleteVariant(variantId: string, productId: string, storeId: string): Promise<void>;
    /**
     * List produk milik toko, opsional filter kategori.
     */
    listProductsByStore(storeId: string, filter?: {
        categoryId?: string;
    }): Promise<Product[]>;
    /**
     * List produk per toko dengan pagination + sort (Phase 1.9.2b).
     * Return { products, total } untuk dipakai route.
     */
    getProductsByStore(storeId: string, options?: {
        limit?: number;
        offset?: number;
        sortBy?: 'name' | 'price' | 'createdAt';
        order?: 'asc' | 'desc';
    }): Promise<{
        products: Product[];
        total: number;
    }>;
    private mapCategory;
    private mapProduct;
    /** Batas atas harga (IDR) */
    private static readonly MAX_PRICE;
    /** Batas bawah harga (IDR) */
    private static readonly MIN_PRICE;
    /** Maksimal percobaan generate SKU unik */
    private static readonly SKU_MAX_RETRIES;
    /**
     * Magic Paste — extract product dari teks bebas via LLM, lalu buat produk.
     * Flow: LLM extract → validasi harga → fuzzy match kategori → SKU retry → create.
     * Returns product + extractedEntities + warnings.
     *
     * @param options.preview true = hanya ekstrak (product: null), tanpa create (Phase 1.9.4 UI)
     */
    magicPaste(storeId: string, text: string, options?: {
        preview?: boolean;
        source?: 'store' | 'admin';
        overrides?: MagicPasteOverrides;
    }): Promise<{
        product: Product | null;
        extractedEntities: Record<string, unknown>;
        warning: string[] | null;
        needsWeightInput?: boolean;
    }>;
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
    magicPasteBatch(storeId: string, text: string, options?: {
        preview?: boolean;
        source?: 'store' | 'admin';
    }): Promise<{
        items: Array<{
            index: number;
            line: string;
            status: 'success' | 'failed' | 'skipped';
            product: Product | null;
            extractedEntities: Record<string, unknown> | null;
            error: string | null;
            warning: string[] | null;
        }>;
        summary: {
            total: number;
            success: number;
            failed: number;
            skipped: number;
        };
    }>;
    /**
     * Panggil LLM dengan system prompt extraction produk Indonesia.
     */
    private extractWithLLM;
    /**
     * Muat pattern library dari SystemSetting.
     * Jika belum ada, kembalikan default patterns.
     */
    loadPatterns(): Promise<MagicPastePattern[]>;
    /**
     * Simpan pattern library ke SystemSetting (untuk admin API).
     */
    savePatterns(patterns: MagicPastePattern[]): Promise<void>;
    /**
     * Muat settings Magic Paste dari SystemSetting.
     * Jika belum ada, kembalikan default settings.
     */
    loadSettings(): Promise<MagicPasteSettings>;
    /**
     * Simpan settings Magic Paste ke SystemSetting (untuk admin API).
     */
    saveSettings(settings: MagicPasteSettings): Promise<void>;
    /** Default patterns — dioptimalkan untuk format UMKM Indonesia. */
    private defaultPatterns;
    /** Default settings. */
    private defaultSettings;
    /**
     * Coba ekstrak pakai pattern library.
     * Jika pattern match dan confidence mencapai threshold, return hasil.
     * Jika tidak match, kembalikan null agar LLM yang menangani.
     */
    private tryPatternExtraction;
    /**
     * Fallback extraction via regex — dipakai jika LLM gagal/unavailable
     * (mendukung format harga Indonesia + unit stock).
     */
    private regexFallbackExtraction;
    /**
     * Normalisasi string harga Indonesia → integer IDR.
     * "5K"→5000, "5 ribu"→5000, "5.000"→5000, "1 juta"→1000000, dst.
     */
    private normalizePriceText;
    /**
     * Ekstrak berat dari teks sumber → gram. HANYA jika ada angka + satuan berat
     * eksplisit (gr/gram/g/kg/kilogram). kg → ×1000. Jika tidak ada, return null
     * (JANGAN tebak — berat kosong = butuh input manual, bukan angka palsu).
     */
    private extractWeightGrams;
    /**
     * Fuzzy match nama kategori terhadap kategori aktif milik store.
     * Skor = 1 (exact) · substring match ≥ 0.8 · ratio-based otherwise.
     * Threshold: >= 0.75.
     */
    private fuzzyMatchCategory;
    /**
     * Similarity sederhana (bigram Dice coefficient) — ringan, tanpa dependency.
     */
    private stringSimilarity;
    /**
     * Generate SKU unik AUTO-{6 char store}-{timestamp}. Retry 5x pada collision.
     */
    private generateUniqueSKU;
    /**
     * Catat satu eksekusi Magic Paste ke tabel magic_paste_runs.
     * Basis data analytics confidence (Phase 1.9.6). Best-effort — kegagalan
     * pencatatan tidak boleh mengganggu alur utama.
     */
    private recordMagicPasteRun;
}
/** Override nilai yang di-edit user setelah preview (Phase 1.9.7b) */
export interface MagicPasteOverrides {
    name?: string;
    price?: number;
    stock?: number | null;
    /** Berat (gram) — bisa diisi manual setelah preview needsWeightInput. */
    weight?: number | null;
}
/** Pattern ekstraksi regex yang dikelola admin (Phase 1.9.8) */
export interface MagicPastePattern {
    id: string;
    name: string;
    description: string;
    regex: string;
    fieldMappings: Array<{
        field: string;
        group: number;
    }>;
    confidence: number;
    isActive: boolean;
    sortOrder: number;
}
/** Pengaturan Magic Paste (Phase 1.9.8) */
export interface MagicPasteSettings {
    regexFirstThreshold: number;
    llmEnabled: boolean;
    cacheEnabled: boolean;
}
export declare const productService: ProductService;
//# sourceMappingURL=product.service.d.ts.map