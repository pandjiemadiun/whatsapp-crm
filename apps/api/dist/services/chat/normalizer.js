/**
 * Chat Normalizer — BAGIAN 1
 * src/services/chat/normalizer.ts
 *
 * Pure-function normalizer. Lowercase, squash repeats, slang/typo dict,
 * protected product-name spans (EXACT match, case-insensitive).
 *
 * "LLM mengusulkan, kode memutuskan" — normalizer adalah rule-based, 0 LLM.
 */
import { prisma } from '../../infrastructure/prisma.js';
const WINDOW_MS = 5 * 60000; // 5 menit cache katalog
const catalogCache = new Map();
/** Kamus typo — EXACT match priority, diurutkan panjang→pendek */
const TYPO_DICT = {
    toralin: 'total',
    totalin: 'total',
    itungin: 'hitung',
    jumlahin: 'jumlah',
    makasi: 'makasih',
    makasiii: 'makasih',
    brp: 'berapa',
    ongkirr: 'ongkir',
    hrg: 'harga',
    tgl: 'tanggal',
    gk: 'tidak',
    gak: 'tidak',
    bli: 'beli',
    beliin: 'beli',
    pesen: 'pesan',
    orderin: 'order',
    km: 'kamu',
    sy: 'saya',
    ga: 'tidak',
    udah: 'sudah',
    blm: 'belum',
    jg: 'juga',
    lg: 'lagi',
    yg: 'yang',
    dr: 'dari',
    aja: 'saja',
    cetpin: 'cek',
    cekk: 'cek',
    kirimin: 'kirim',
    gantiin: 'ganti',
    hapusin: 'hapus',
    batalin: 'batal',
    refundin: 'refund',
    komplainin: 'komplain',
};
/** Levenshtein distance — untuk fuzzy match typo */
function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0)
        return n;
    if (n === 0)
        return m;
    const dp = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++)
        dp[i][0] = i;
    for (let j = 0; j <= n; j++)
        dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            }
            else {
                dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
        }
    }
    return dp[m][n];
}
/** Ambil daftar nama produk aktif untuk satu store (cached) */
async function getActiveProductNames(storeId) {
    const now = Date.now();
    const cached = catalogCache.get(storeId);
    if (cached && cached.expiresAt > now)
        return cached.products;
    try {
        const products = await prisma.product.findMany({
            where: { storeId, deletedAt: null, isActive: true },
            select: { name: true },
        });
        const names = new Set(products.map((p) => p.name.toLowerCase().trim()));
        catalogCache.set(storeId, { products: names, expiresAt: now + WINDOW_MS });
        return names;
    }
    catch {
        const empty = new Set();
        catalogCache.set(storeId, { products: empty, expiresAt: now + WINDOW_MS });
        return empty;
    }
}
/** Invalidate catalog cache (setelah produk ditambah/ubah) */
export function invalidateChatCatalogCache(storeId) {
    catalogCache.delete(storeId);
}
/**
 * Cari produk aktif yang EXACT-match (case-insensitive) sebagai substring.
 * Mengembalikan array span {start, end, productName} yang harus dilindungi.
 */
function findProtectedSpans(text, productNames) {
    const spans = [];
    const lower = text.toLowerCase();
    // Sort product names by length descending (longest first — greedy match)
    const sorted = Array.from(productNames).sort((a, b) => b.length - a.length);
    for (const name of sorted) {
        if (!name)
            continue;
        // Exact substring match (case-insensitive)
        const idx = lower.indexOf(name);
        if (idx === -1)
            continue;
        // Check no existing span overlaps
        let overlap = false;
        for (const s of spans) {
            if (idx < s.end && idx + name.length > s.start) {
                overlap = true;
                break;
            }
        }
        if (overlap)
            continue;
        spans.push({ start: idx, end: idx + name.length, name });
    }
    // Sort by start position
    return spans.sort((a, b) => a.start - b.start);
}
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
export async function normalizeText(rawText, protectedProductNames) {
    // Step a: lowercase + b: trim
    const lower = rawText.toLowerCase().trim();
    // Step c: squash repeated chars — 3+ → 1
    // Note: spec regex is /(.)\1{2,}/g → $1
    // This squashes "berasss"→"beras" (3 s's → 1 s), "murahhh"→"murah"
    const squashed = lower.replace(/(.)\1{2,}/g, '$1');
    // Build product name set from provided + DB lookup (for this store)
    // protectedProductNames param: explicitly passed product names to protect
    const productSet = new Set(protectedProductNames.map((n) => n.toLowerCase().trim()));
    // Step d: find protected spans
    const spans = findProtectedSpans(squashed, productSet);
    if (spans.length === 0) {
        // No protected spans — tokenize and normalize whole text
        return normalizeTokens(squashed);
    }
    // Step e-g: tokenize segments between protected spans
    let result = '';
    let cursor = 0;
    for (const span of spans) {
        // Normalize text before this span
        if (cursor < span.start) {
            result += normalizeTokens(squashed.slice(cursor, span.start));
        }
        // Insert protected span AS-IS (original case preserved from squashed text)
        result += squashed.slice(span.start, span.end);
        cursor = span.end;
    }
    // Normalize remaining text after last span
    if (cursor < squashed.length) {
        result += normalizeTokens(squashed.slice(cursor));
    }
    return result;
}
/**
 * Tokenize text, apply typo dict (exact first, then Levenshtein ≤2).
 * Protected spans are already handled by caller.
 */
function normalizeTokens(text) {
    // Split on word boundaries, preserving punctuation spacing
    const tokens = text.split(/(\s+)/);
    return tokens
        .map((token) => {
        const trimmed = token.trim();
        if (!trimmed || /^\s+$/.test(token))
            return token; // keep whitespace as-is
        // Exact match
        if (TYPO_DICT[trimmed]) {
            return token.replace(trimmed, TYPO_DICT[trimmed]);
        }
        // Fuzzy match (Levenshtein ≤2) — hanya token panjang ≥4 & typo panjang ≥4
        // Guard: hindari "dua" → "ga" (edit distance 2, tapi berbeda makna)
        if (trimmed.length >= 4) {
            let bestMatch = null;
            let bestDist = Infinity;
            for (const typo of Object.keys(TYPO_DICT)) {
                if (typo.length < 4)
                    continue; // hanya fuzzy-match typo yang cukup panjang
                const dist = levenshtein(trimmed, typo);
                if (dist <= 2 && dist < bestDist) {
                    bestDist = dist;
                    bestMatch = typo;
                }
            }
            if (bestMatch) {
                return token.replace(trimmed, TYPO_DICT[bestMatch]);
            }
        }
        return token;
    })
        .join('');
}
/**
 * Helper: normalizeText menggunakan DB katalog (untuk single-store context).
 * Jika protectedProductNames kosong, lookup dari DB.
 */
export async function normalizeMessage(rawText, storeId, productNamesOverride) {
    let products;
    if (productNamesOverride !== undefined) {
        products = productNamesOverride;
    }
    else {
        const dbNames = await getActiveProductNames(storeId);
        products = Array.from(dbNames);
    }
    // Guard: jika pesan AS-IS (after lowercase+trim) exact-match produk
    const lower = rawText.toLowerCase().trim();
    const productSet = new Set(products.map((p) => p.toLowerCase().trim()));
    for (const name of productSet) {
        if (lower === name) {
            return { normalized: rawText.trim(), isProductName: true };
        }
    }
    const normalized = await normalizeText(rawText, products);
    return { normalized, isProductName: false };
}
// Re-export dictionary untuk test
export { TYPO_DICT as TYPO_DICTIONARY };
//# sourceMappingURL=normalizer.js.map