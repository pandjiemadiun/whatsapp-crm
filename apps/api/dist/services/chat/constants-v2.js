/**
 * Engine Configuration Constants — BAGIAN 1 (v3.2)
 * src/services/chat/constants-v2.ts
 *
 * Konstanta-konstanta tunable untuk staged pipeline v3.2.
 * Semua nilai bersifat immutable (readonly) dan tidak bergantung pada DB/LLM.
 *
 * I13: nilai threshold default bersifat overridable via store config, tetapi
 *      konstanta ini menjadi fallback ketika store config belum disediakan.
 */
// ─────────────────────────────────────────────────────────────────────────────
// Engine identity
// ─────────────────────────────────────────────────────────────────────────────
/** Versi engine pipeline v3.2 — seluruh artefak types/constants v2 berpatokan pada nilai ini. */
export const ENGINE_VERSION = '3.2';
// ─────────────────────────────────────────────────────────────────────────────
// Selection threshold
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Ambang keyakinan minimum (0..1) agar satu ActV2 dapat dipilih sebagai
 * draft-cart operation secara otomatis. Di bawah nilai ini, act diklasifikasikan
 * sebagai 'needs_clarification'. (I13)
 */
export const SELECTION_CONFIDENCE_THRESHOLD = 0.6;
// ─────────────────────────────────────────────────────────────────────────────
// Clarification limits
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Jumlah maksimum upaya (attempts) clarification sebelum resolver meningkatkan
 * ke tier berikutnya (escalate ke rule-based tier). Sesuai CLARIFICATION_MAX_ATTEMPTS.
 */
export const CLARIFICATION_MAX_ATTEMPTS = 2;
// ─────────────────────────────────────────────────────────────────────────────
// Deferred pending auto-drop
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Selang turn (jumlah pesan selanjutnya yang diproses) yang harus menunggu
 * sebelum sebuah pending clarification yang statusnya 'deferred' otomatis
 * di-drop (dijadikan 'dropped') bila tidak ada progres.
 */
export const DEFERRED_AUTO_DROP_TURNS = 3;
//# sourceMappingURL=constants-v2.js.map