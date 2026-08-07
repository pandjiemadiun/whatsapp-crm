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
// ─────────────────────────────────────────────────────────────────────────────
// Kamus typo (verbatim dari spesifikasi, minimal 30 entri)
// ─────────────────────────────────────────────────────────────────────────────
const typoDictionary = {
    toralin: 'total',
    totalin: 'total',
    brp: 'berapa',
    hrg: 'harga',
    ongkir: 'ongkos kirim',
    krm: 'kirim',
    resi: 'resi',
    stok: 'stok',
    ada: 'ada',
    ready: 'ada',
    kosong: 'habis',
    pesen: 'pesan',
    order: 'pesan',
    byr: 'bayar',
    tf: 'transfer',
    cod: 'bayar ditempat',
    dmn: 'dimana',
    almt: 'alamat',
    jam: 'jam',
    buka: 'buka',
    tutup: 'tutup',
    wa: 'whatsapp',
    rek: 'rekening',
    diskon: 'diskon',
    promo: 'promo',
    gratis: 'gratis',
    bisa: 'bisa',
    boleh: 'boleh',
    dah: 'sudah',
    blm: 'belum',
    iyaa: 'iya',
    ok: 'oke',
};
/** Alias uppercase — kompatibilitas lama (message-normalizer.ts re-export). */
export const TYPO_DICTIONARY = typoDictionary;
// ─────────────────────────────────────────────────────────────────────────────
// Levenshtein edit distance
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Levenshtein distance (rolling 1-D DP).
 * Digunakan fuzzyMatchProduct: match jika distance <= 2 ATAU token === namaProduk.
 */
function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    if (m === 0)
        return n;
    if (n === 0)
        return m;
    const prev = new Array(n + 1).fill(0);
    const curr = new Array(n + 1).fill(0);
    for (let j = 0; j <= n; j++)
        prev[j] = j;
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
                curr[j] = prev[j - 1];
            }
            else {
                curr[j] = 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
            }
        }
        for (let j = 0; j <= n; j++)
            prev[j] = curr[j];
    }
    return prev[n];
}
// ─────────────────────────────────────────────────────────────────────────────
// Tokenize
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Tokenize pesan menjadi array token berdasarkan whitespace.
 * Spesifikasi: `tokens = tokenize(message)` lalu `tokens.map(...).join(" ")`.
 */
export function tokenize(message) {
    return message
        .trim()
        .split(/\s+/)
        .filter((token) => token.length > 0);
}
// ─────────────────────────────────────────────────────────────────────────────
// Fuzzy product match (I12 guard)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Cek apakah sebuah token fuzzy-match sebuah nama produk.
 *
 * Match jika:
 *   - token === namaProduk (exact), ATAU
 *   - Levenshtein(token, namaProduk) <= 2
 *
 * (Case-sensitive pada `===` dan Levenshtein, konsisten dengan spesifikasi.)
 */
export function fuzzyMatchProduct(token, productDictionary) {
    for (const name of productDictionary) {
        if (token === name)
            return true;
        if (levenshtein(token, name) <= 2)
            return true;
    }
    return false;
}
// ─────────────────────────────────────────────────────────────────────────────
// Normalizer utama (pure, synchronous)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Normalizer utama — BAGIAN 1.
 *
 * @param message           pesan mentah customer
 * @param productDictionary  nama produk aktif (oleh caller / DB)
 * @returns normalized string (sync, pure)
 */
export function normalize(message, productDictionary) {
    return tokenize(message)
        .map((token) => {
        // Guard: cek produk DULU (I12)
        if (fuzzyMatchProduct(token, productDictionary)) {
            return token; // JANGAN ubah nama produk
        }
        // Baru cek kamus typo
        return typoDictionary[token] ?? token;
    })
        .join(' ');
}
/**
 * Apakah `message` (atau tokennya) merepresentasikan nama produk aktif?
 * True jika trimmed+lowercased message fuzzy-match (exact atau Levenshtein<=2)
 * terhadap setidaknya satu nama produk.
 */
function isProductNameMatch(message, productDictionary) {
    const compact = message.trim().toLowerCase();
    const names = productDictionary.map((n) => n.toLowerCase());
    return names.some((name) => fuzzyMatchProduct(compact, [name]));
}
/**
 * Wrapper async kompatibilitas lama.
 * Signature: (message, storeId, productNames?) -> Promise<NormalizerResult>.
 */
export async function normalizeMessage(message, storeId, productNames) {
    void storeId; // reserv fase pengkabelan DB (orkestrator tidak disentuh fase 1)
    const products = productNames ?? [];
    return {
        normalized: normalize(message, products),
        isProductName: isProductNameMatch(message, products),
    };
}
/**
 * Alias synchronous klasik (kompat message-normalizer.ts re-export).
 */
export function normalizeText(text) {
    return normalize(text, []);
}
/**
 * Invalidate cache katalog produk (no-op placeholder kompat, fase 1).
 */
export async function invalidateChatCatalogCache() { }
//# sourceMappingURL=normalizer.js.map