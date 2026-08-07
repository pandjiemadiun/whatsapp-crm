/** Kamus typo — EXACT match priority, diurutkan panjang→pendek */
declare const TYPO_DICT: Record<string, string>;
/** Invalidate catalog cache (setelah produk ditambah/ubah) */
export declare function invalidateChatCatalogCache(storeId: string): void;
/**
 * Normalizer utama — BAGIAN 1.
 *
 * a. Lowercase
 * b. Trim whitespace
 * c. Squash huruf berulang (regex (.)\\1{2,}/g → $1)
 * d. Identifikasi protected span (exact product match)
 * e. Tokenize di luar protected span
 * f. Exact match typo dict → ganti
 *    Jika tidak match: fuzzy (Levenshtein ≤2) → ganti
 * g. Gabung protected span + token yang dinormalisasi
 */
export declare function normalizeText(rawText: string, protectedProductNames: string[]): Promise<string>;
/**
 * Helper: normalizeText menggunakan DB katalog (untuk single-store context).
 * Jika protectedProductNames kosong, lookup dari DB.
 */
export declare function normalizeMessage(rawText: string, storeId: string, productNamesOverride?: string[]): Promise<{
    normalized: string;
    isProductName: boolean;
}>;
export { TYPO_DICT as TYPO_DICTIONARY };
//# sourceMappingURL=normalizer.d.ts.map