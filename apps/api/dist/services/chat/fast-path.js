import { ResponseSource } from '../../domain/types.js';
import { getPendings } from './workspace.js';
import { normalizeForMatch } from './pendingClarification.js';
// ─────────────────────────────────────────────────────────────────────────────
// Keyword-guard lists (module-level named constants, substring-matched)
// ─────────────────────────────────────────────────────────────────────────────
/** Kata afirmatif untuk menutup pending clarification tanpa LLM (guard pertama). */
const AFFIRMATIVE = ['iya', 'ya', 'oke', 'sip'];
/** Kata negasi/cancellation untuk rollback pending clarification. */
const NEGATION = ['ga', 'gak', 'batal'];
/** "dua duanya" — quantifier eksak yang hanya valid saat N=2. */
const QUANTIFIER_BOTH = 'dua duanya';
/** Jumlah opsi maksimum agar affirmative menjadi deterministik (N ≤ 2). */
const AFFIRMATIVE_MAX_OPTIONS = 2;
/** Count yang diharapkan untuk quantifier "dua duanya". */
const QUANTIFIER_BOTH_COUNT = 2;
/** Peta kata ordinal → indeks 0-based (untuk parsing "yang kedua" dll). */
const ORDINAL_MAP = {
    pertama: 0,
    kedua: 1,
    ketiga: 2,
    keempat: 3,
    kelima: 4,
};
/** Kata penanda order/cart intent (guard sebelum tier fallback, substring-matched). */
const ORDER_INTENT_KEYWORDS = [
    'mau',
    'beli',
    'pesan',
    'tambah',
    'kurang',
    'hapus',
    'ga jadi',
    'gak jadi',
    'batal',
    'cancel',
];
/**
 * Kata penanda katalog/menu intent (guard order INTENT — kalau ada di pesan,
 * pesan kemungkinan besar cuma nanya daftar product, bukan order multi-produk).
 */
const CATALOG_INTENT_KEYWORDS = [
    'jual apa',
    'jualan apa',
    'katalog',
    'menu',
    'produk apa',
    'list produk',
    'ada apa',
];
/** Kata order untuk guard multi-produk (narrow). */
const MULTI_PRODUCT_ORDER_VERBS = [
    'mau',
    'beli',
    'pesan',
    'tambah',
    'ambil',
];
/** Jumlah minimal nama produk agar dianggap order multi-produk. */
const MULTI_PRODUCT_MIN_COUNT = 2;
// ─────────────────────────────────────────────────────────────────────────────
// Helper: normalisasi pesan untuk tier call
// ─────────────────────────────────────────────────────────────────────────────
/** Normalisasi pesan: lowercase, trim, squash huruf berulang, buang punctuation. */
function normalizeMessage(message) {
    return normalizeForMatch(message);
}
/**
 * Cek apakah pesan adalah order/cart intent (guard murah, 0-LLM).
 * Dipanggil SEBELUM tier fallback agar multi-add / cancel JANGAN disergap
 * tier klarifikasi produk (mis. tryProduct menyergap "aku mau kangkung 1").
 *
 * Deteksi (terhadap pesan ternormalisasi):
 *   - mengandung nama produk dari catalog DAN angka kuantitas, ATAU
 *   - mengandung kata kunci order (mau/beli/pesan/tambah/kurang/hapus/
 *     ga jadi/gak jadi/batal/cancel).
 */
function isOrderIntent(message, catalog) {
    // Kalau ada indikasi katalog/menu ("jual apa", "katalog"), JANGAN treat
    // sebagai order — biarkan tier tryCatalog menjawab (B).
    if (CATALOG_INTENT_KEYWORDS.some((kw) => message.includes(kw)))
        return false;
    if (ORDER_INTENT_KEYWORDS.some((kw) => message.includes(kw)))
        return true;
    const mentionsProduct = catalog.some((c) => message.includes(c.name.toLowerCase()));
    return mentionsProduct && /\d/.test(message);
}
/**
 * Cek apakah pesan adalah order MULTI-PRODUK (>= 2 nama produk katalog
 * terdeteksi) disertai kata order (mau/beli/pesan/tambah/ambil).
 *
 * Guard ini SEMPIT dan eksplisit: hanya mem-block tier saat kondisi
 * multi-produk terpenuhi. Di luar itu (greeting, katalog, total) tier
 * tetap berjalan normal. Nama produk dicocokkan substring terhadap
 * pesan ternormalisasi; jumlah unik dihitung.
 */
function isMultiProductOrder(message, catalog) {
    if (!MULTI_PRODUCT_ORDER_VERBS.some((v) => message.includes(v))) {
        return false;
    }
    const mentioned = new Set();
    for (const item of catalog) {
        const name = item.name.trim().toLowerCase();
        if (name.length > 0 && message.includes(name)) {
            mentioned.add(name);
        }
    }
    return mentioned.size >= MULTI_PRODUCT_MIN_COUNT;
}
// ─────────────────────────────────────────────────────────────────────────────
// Helper: match deterministik terhadap pending clarification
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Cek afirmatif: keyword iya/ya/oke/sip + N ≤ 2 opsi → EXECUTE semua.
 * I10: 0-LLM affirmation closes clarification.
 */
export function tryMatchAffirmative(message, options) {
    if (options.length > AFFIRMATIVE_MAX_OPTIONS)
        return false;
    const msg = message.toLowerCase();
    return AFFIRMATIVE.some((kw) => msg.includes(kw));
}
/**
 * Cek negasi: keyword ga/gak/batal → ROLLBACK.
 */
export function tryMatchNegation(message) {
    const msg = message.toLowerCase();
    return NEGATION.some((kw) => msg.includes(kw));
}
/**
 * Cek quantifier eksak: "dua duanya" + N=2 → EXECUTE semua.
 * Mengembalikan {exact, indices} di mana:
 * - exact=true, indices=[0..N-1] bila quantifier cocok dan N sesuai
 * - exact=false, indices=null bila tidak cocok
 */
export function tryMatchQuantifier(message, N) {
    const msg = message.toLowerCase();
    if (msg.includes(QUANTIFIER_BOTH)) {
        if (N === QUANTIFIER_BOTH_COUNT) {
            return { exact: true, indices: [...Array(N).keys()] };
        }
        return { exact: false, indices: null };
    }
    return { exact: false, indices: null };
}
/**
 * Parse indeks opsi dari pesan.
 * Contoh: "nomor 1" → [0], "nomor 2" → [1], "yang kedua" → [1].
 * Kembalikan null bila tidak ada indeks yang terdeteksi.
 */
export function tryMatchIndices(message) {
    const msg = message.toLowerCase();
    const indices = [];
    // Pattern "nomor <angka>" — 1-based, konversi ke 0-based
    const numRegex = /nomor\s+(\d+)/g;
    let m;
    while ((m = numRegex.exec(msg)) !== null) {
        const num = parseInt(m[1], 10);
        if (!isNaN(num) && num > 0)
            indices.push(num - 1);
    }
    // Pattern "yang <ordinal>" — menggunakan ORDINAL_MAP
    for (const [word, idx] of Object.entries(ORDINAL_MAP)) {
        if (msg.includes(`yang ${word}`))
            indices.push(idx);
    }
    return indices.length > 0 ? indices : null;
}
/**
 * Cek apakah pesan menyebut nama opsi yang ada.
 * Kembalikan array nama yang matched, atau null bila tidak ada.
 */
export function tryMatchNames(message, options) {
    const msg = message.toLowerCase();
    const matched = options.filter((opt) => opt.trim().length > 0 && msg.includes(opt.toLowerCase()));
    return matched.length > 0 ? matched : null;
}
/**
 * Parkirkan pending: ubah status ke 'deferred' + increment deferred_turns.
 * Mutasi in-place pada workspace (Accessor PURE — storage di-handle caller).
 */
export function parkPendingAndIncrementTurns(workspace, pendingId) {
    const pending = workspace.pendings.find((p) => p.id === pendingId);
    if (pending) {
        pending.status = 'deferred';
        pending.deferred_turns += 1;
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator internal: coba match satu pending active
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Coba match deterministik terhadap satu pending clarification yang aktif.
 * Urutan guard (guard-first per spesifikasi):
 *   1. Afirmatif + N≤2 → EXECUTE
 *   2. Negasi → ROLLBACK
 *   3. Quantifier exact (dua duanya + N=2) → EXECUTE semua
 *   4. INDICES (nomor 1, yang kedua) → EXECUTE selected
 *   5. NAMES (mention nama opsi) → EXECUTE selected
 *
 * Kembalikan ResolvedPayload bila match, atau null bila tidak match.
 */
function tryMatchPending(message, pending) {
    const options = pending.options;
    const N = options.length;
    // 1. Afirmatif → EXECUTE (cek DULU)
    if (tryMatchAffirmative(message, options)) {
        return {
            pendingId: pending.id,
            action: 'EXECUTE',
            resolvedIndices: [...Array(N).keys()],
            matchedNames: [...options],
        };
    }
    // 2. Negasi → ROLLBACK
    if (tryMatchNegation(message)) {
        return {
            pendingId: pending.id,
            action: 'ROLLBACK',
        };
    }
    // 3. Quantifier exact → EXECUTE semua
    const q = tryMatchQuantifier(message, N);
    if (q.exact && q.indices !== null) {
        return {
            pendingId: pending.id,
            action: 'EXECUTE',
            resolvedIndices: q.indices,
            matchedNames: q.indices.map((i) => options[i]),
        };
    }
    // 4. INDICES → EXECUTE selected
    const indices = tryMatchIndices(message);
    if (indices !== null) {
        const valid = indices.filter((i) => i >= 0 && i < N);
        if (valid.length > 0) {
            return {
                pendingId: pending.id,
                action: 'EXECUTE',
                resolvedIndices: valid,
                matchedNames: valid.map((i) => options[i]),
            };
        }
    }
    // 5. NAMES dari opsi → EXECUTE selected
    const names = tryMatchNames(message, options);
    if (names !== null && names.length > 0) {
        return {
            pendingId: pending.id,
            action: 'EXECUTE',
            resolvedIndices: names.map((n) => options.indexOf(n)),
            matchedNames: names,
        };
    }
    return null;
}
// ─────────────────────────────────────────────────────────────────────────────
// Helper: bangun PipelineContext minimal untuk tier call (READ-ONLY)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Bangun PipelineContext minimal dari workspace + catalog.
 * Hanya bidang yang dibutuhkan fallbackService.getResponse.
 * I8: tidak ada panggilan LLM di sini — hanya persiapan konteks saja.
 */
function buildMinimalContext(workspace, catalog, storeId, conversationId) {
    return {
        storeId,
        customerId: '',
        conversationId,
        messages: [],
        customerCity: null,
        customerName: null,
        cart: workspace.draft_cart.map((op) => ({
            product: op.product,
            qty: op.qty,
            price: catalog.find((c) => c.name.toLowerCase() === op.product.toLowerCase())?.price ?? null,
            unit: 'unit',
            mentionedAt: '',
            confirmedAt: '',
        })),
        activeOrder: null,
        pendingClarification: null,
        llmCalledThisTurn: false,
        storeProducts: catalog.map((c) => ({
            name: c.name,
            price: c.price,
            stock: null,
        })),
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// Entry point: tryFastPath
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Coba selesaikan pesan via 0-LLM fast path.
 *
 * @param message        pesan mentah customer
 * @param workspace      state workspace perpercakapan (v2)
 * @param catalog        katalog produk toko
 * @param fallbackService  service tier deterministik (READ-ONLY); typed as any
 * @param storeId        id toko (diteruskan ke tier, READ-ONLY)
 * @param conversationId id percakapan (agar tier 'total' membaca cart DB yang benar)
 * @returns FastPathResult — discriminated union
 *
 * I8: maksimal 0 panggilan LLM di fast path ini.
 * I10: semua hasil resolved/tier berasal dari rule-based resolver, bukan LLM.
 */
export async function tryFastPath(message, workspace, catalog, fallbackService, storeId = '', conversationId = '') {
    const normalizedMsg = normalizeMessage(message);
    // ── A. CEK PENDING ACTIVE ──────────────────────────────────────────────
    // cek pending active DULU sebelum tier (guard-first per spesifikasi)
    const activePendings = getPendings(workspace, 'active');
    if (activePendings.length > 0) {
        const pending = activePendings[0];
        // a. Coba match deterministik terhadap message
        const match = tryMatchPending(message, pending);
        if (match) {
            // b. MATCH → resolved (EXECUTE atau ROLLBACK)
            return { hit: true, outcome: 'resolved', payload: match };
        }
        // c. TIDAK MATCH → park pending, increment deferred_turns
        //    topicSwitch = true karena pesan ini tidak menjawab klarifikasi
        parkPendingAndIncrementTurns(workspace, pending.id);
        return { hit: false, pendingParked: true, topicSwitch: true };
    }
    // ── A2. ORDER-INTENT GUARD ─────────────────────────────────────────────
    // Multi-add & cancel JANGAN disergap tier klarifikasi produk —
    // biarkan LLM reasoning (Stage 4) yang menangani.
    if (isOrderIntent(normalizedMsg, catalog)) {
        return { hit: false, pendingParked: false, topicSwitch: false };
    }
    // ── A3. MULTI-PRODUCT ORDER GUARD (narrow) ─────────────────────────────
    // Pesan order multi-produk (>=2 nama produk + kata order) skip tier —
    // biarkan LLM yang menghitung kuantitas & menyusun cart ops. Di luar
    // kondisi ini tier berjalan normal (greeting, katalog, total tetap hit).
    if (isMultiProductOrder(normalizedMsg, catalog)) {
        return { hit: false, pendingParked: false, topicSwitch: false };
    }
    // ── B. CEK TIER DETERMINISTIK (READ-ONLY) ──────────────────────────────
    // Baru cek tier setelah konfirmasi tidak ada pending active
    const ctx = buildMinimalContext(workspace, catalog, storeId, conversationId);
    const tierResult = await fallbackService.getResponse(normalizedMsg, ctx);
    // Jika bukan HUMAN → ada jawaban deterministik
    if (tierResult && tierResult.source !== ResponseSource.HUMAN) {
        return { hit: true, outcome: 'tier', payload: tierResult };
    }
    // ── C. RETURN — semua miss, lanjut ke LLM interpreter (Stage 4) ────────
    return { hit: false, pendingParked: false, topicSwitch: false };
}
//# sourceMappingURL=fast-path.js.map