// ─────────────────────────────────────────────────────────────────────────────
// BAGIAN 2 — Resolver utama (spesifikasi fase 2)
// ─────────────────────────────────────────────────────────────────────────────
/** Kata afirmatif (spesifikasi). */
const AFFIRMATIVE = [
    'iya', 'ya', 'yoi', 'oke', 'ok', 'sip',
    'dua duanya', 'semua', 'semuanya', 'dua2nya', 'ambil semua',
];
/** Kata negasi/cancellation (spesifikasi). */
const NEGATIVE = ['ga', 'gak', 'ngga', 'bukan', 'gajadi', 'batal'];
/**
 * Resolver utama — BAGIAN 2 (spesifikasi).
 *
 * @param ctx     { pending: { ops?, snapshot?, retryCount? }, requiresHumanReview }
 * @param message  pesan mentah customer
 * @returns ResolvePendingResult  (action-based)
 */
export function resolvePending(ctx, message) {
    // Guard: cek afirmatif DULU
    if (AFFIRMATIVE.some((aff) => message.includes(aff))) {
        return { action: 'EXECUTE', ops: ctx.pending.ops };
    }
    // Baru cek negasi → ROLLBACK
    if (NEGATIVE.some((neg) => message.includes(neg))) {
        return { action: 'ROLLBACK', snapshot: ctx.pending.snapshot };
    }
    // Retry maks 1, lalu escelate
    const retryCount = ctx.pending.retryCount ?? 0;
    if (retryCount >= 1) {
        ctx.requiresHumanReview = true;
        return { action: 'ESCALATE' };
    }
    ctx.pending.retryCount = retryCount + 1;
    return { action: 'RETRY' };
}
// ─────────────────────────────────────────────────────────────────────────────
// Kompatibilitas lama (status-based) — agar dependen lama tetap compile & pass
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Normalisasi teks untuk matching: lowercase, trim, squash huruf berulang,
 * buang trailing punctuation, collapse whitespace.
 */
export function normalizeForMatch(text) {
    return text
        .trim()
        .toLowerCase()
        .replace(/([a-z])\1{1,}/g, '$1')
        .replace(/[.,!?;:]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
/** Kata afirmatif/positif (whole-word; untuk kompat status-based & old tests). */
const AFFIRMATIVE_WORDS = [
    'iya', 'ya', 'oke', 'yaudah', 'boleh', 'dua duanya', 'dua dua', 'keduanya',
    'semua', 'all', 'both', 'jadi', 'gas', 'lanjut', 'yes', 'bener', 'benar',
    'setuju', 'ikut', 'siap', 'mantap', 'done', 'ok', 'semuanya', 'ikut aja',
];
/** Kata negasi/cancellation (whole-word). */
const NEGATION_WORDS = [
    'tidak', 'nggak', 'engak', 'gak', 'ga', 'batal', 'jangan', 'hapus', 'cancel',
    'gajadi', 'bukan', 'no', 'nope', 'maunah', 'salah',
];
/** Cek apakah teks mengandung kata afirmatif (whole-word match). */
export function isAffirmative(text) {
    const norm = normalizeForMatch(text);
    const words = norm.split(/\s+/);
    return AFFIRMATIVE_WORDS.some((w) => words.includes(w) || norm === w);
}
/** Cek apakah teks mengandung kata negasi. */
export function isNegation(text) {
    const norm = normalizeForMatch(text);
    const words = norm.split(/\s+/);
    return (NEGATION_WORDS.some((w) => words.includes(w)) ||
        NEGATION_WORDS.some((w) => words[0] === w) ||
        NEGATION_WORDS.some((w) => norm.startsWith(w)));
}
/**
 * Flatten semua cartOps dari opsi pending clarification.
 */
function flattenCartOps(pending) {
    const opts = pending.options && pending.options.length > 0
        ? pending.options
        : (pending.rawOptions || []).map((r, i) => ({
            id: String(i),
            label: r,
        }));
    const ops = [];
    for (const opt of opts) {
        const cartOps = opt.cartOps;
        if (cartOps)
            ops.push(...cartOps);
    }
    return ops;
}
/**
 * Resolver kompatibilitas lama — PURE, status-based.
 * Dipakai legacy compatibility re-exports.
 *
 * @param message  pesan mentah customer
 * @param pending  PendingClarification dari DB
 * @returns ResolverResult (status: RESOLVED | NEED_RETRY | ESCALATE | NOT_PENDING_ANSWER)
 */
export function resolvePendingClarification(message, pending) {
    const msg = normalizeForMatch(message);
    // Afirmatif → RESOLVED, eksekusi semua cartOps
    if (isAffirmative(msg)) {
        return { status: 'RESOLVED', cartOps: flattenCartOps(pending) };
    }
    // Negasi → RESOLVED, rollback (tidak eksekusi cartOps)
    if (isNegation(msg)) {
        return { status: 'RESOLVED', cartOps: [] };
    }
    // Sudah nyampe retry limit → ESCALATE
    const retryCount = pending.retry_count ?? 0;
    if (retryCount >= 1) {
        return { status: 'ESCALATE' };
    }
    // Belum selesai → minta ulang
    return { status: 'NEED_RETRY' };
}
/**
 * Pilih opsi yang cocok (keyword, case-insensitive) dari daftar label string.
 */
export function selectOption(text, options) {
    const t = text.toLowerCase();
    return options.filter((opt) => t.includes(opt.toLowerCase()));
}
/**
 * Parse pilihan eksplisit customer terhadap opsi.
 * Mengembalikan opsi pertama yang cocok, atau null.
 */
export function parseExplicitChoice(text, options) {
    const t = text.toLowerCase();
    for (const opt of options) {
        if (t.includes(opt.toLowerCase()))
            return opt;
    }
    return null;
}
//# sourceMappingURL=pendingClarification.js.map