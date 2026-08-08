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
/** Versi engine pipeline v3.2 — seluruh artefak types/constants v2 berpatokan pada nilai ini. */
export declare const ENGINE_VERSION: string;
/**
 * Ambang keyakinan minimum (0..1) agar satu ActV2 dapat dipilih sebagai
 * draft-cart operation secara otomatis. Di bawah nilai ini, act diklasifikasikan
 * sebagai 'needs_clarification'. (I13)
 */
export declare const SELECTION_CONFIDENCE_THRESHOLD: number;
/**
 * Jumlah maksimum upaya (attempts) clarification sebelum resolver meningkatkan
 * ke tier berikutnya (escalate ke rule-based tier). Sesuai CLARIFICATION_MAX_ATTEMPTS.
 */
export declare const CLARIFICATION_MAX_ATTEMPTS: number;
/**
 * Selang turn (jumlah pesan selanjutnya yang diproses) yang harus menunggu
 * sebelum sebuah pending clarification yang statusnya 'deferred' otomatis
 * di-drop (dijadikan 'dropped') bila tidak ada progres.
 */
export declare const DEFERRED_AUTO_DROP_TURNS: number;
//# sourceMappingURL=constants-v2.d.ts.map