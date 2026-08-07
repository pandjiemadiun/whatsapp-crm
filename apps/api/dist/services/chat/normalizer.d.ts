/**
 * Chat Normalizer — BAGIAN 1
 * src/services/chat/normalizer.ts
 *
 * Normalizer inti yang PURE & SYNCHRONOUS (0 LLM — rule-based only).
 *
 * Alur (per spesifikasi):
 *   1. tokenize(message)
 *   2. per token, GUARD: cek produk DULU (I12)
 *        - fuzzyMatchProduct(token, productDictionary)
 *          match jika token === namaProduk ATAU Levenshtein(token, namaProduk) <= 2
 *        - jika match -> JANGAN ubah nama produk, kembalikan token apa adanya
 *   3. selain produk -> typoDictionary[token] ?? token
 *   4. join(" ")
 *
 * I12: nama produk aktif TIDAK pernah dimutasi.
 */
/** Alias uppercase — kompatibilitas lama (message-normalizer.ts re-export). */
export declare const TYPO_DICTIONARY: Record<string, string>;
/**
 * Tokenize pesan menjadi array token berdasarkan whitespace.
 * Spesifikasi: `tokens = tokenize(message)` lalu `tokens.map(...).join(" ")`.
 */
export declare function tokenize(message: string): string[];
/**
 * Cek apakah sebuah token fuzzy-match sebuah nama produk.
 *
 * Match jika:
 *   - token === namaProduk (exact), ATAU
 *   - Levenshtein(token, namaProduk) <= 2
 *
 * (Case-sensitive pada `===` dan Levenshtein, konsisten dengan spesifikasi.)
 */
export declare function fuzzyMatchProduct(token: string, productDictionary: string[]): boolean;
/**
 * Normalizer utama — BAGIAN 1.
 *
 * @param message           pesan mentah customer
 * @param productDictionary  nama produk aktif (oleh caller / DB)
 * @returns normalized string (sync, pure)
 */
export declare function normalize(message: string, productDictionary: string[]): string;
export interface NormalizerResult {
    normalized: string;
    isProductName: boolean;
}
/**
 * Wrapper async kompatibilitas lama.
 * Signature: (message, storeId, productNames?) -> Promise<NormalizerResult>.
 */
export declare function normalizeMessage(message: string, storeId: string, productNames?: string[]): Promise<NormalizerResult>;
/**
 * Alias synchronous klasik (kompat message-normalizer.ts re-export).
 */
export declare function normalizeText(text: string): string;
/**
 * Invalidate cache katalog produk (no-op placeholder kompat, fase 1).
 */
export declare function invalidateChatCatalogCache(): Promise<void>;
//# sourceMappingURL=normalizer.d.ts.map