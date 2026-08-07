/**
 * Pending Clarification Resolver — BAGIAN 2
 * src/services/chat/pendingClarification.ts
 *
 * Fase 1 (introduksi) memperkenalkan resolver pure baru: resolvePending(ctx, message).
 *
 * resolvePending — PURE & SYNCHRONOUS (0 LLM, rule-based).
 *   Guard afirmatif/negasi, lalu retry-cap (maks 1) → escalate.
 *   I10: afirmatif/negasi menutup klarifikasi tanpa LLM.
 *
 * Untuk menjaga kompilasi dependen lama (clarification-resolver.ts + test lama
 * multi-turn / ot-percakapa) tetap utuh, modul ini JUGA mengekspor:
 *   - resolvePendingClarification(message, pending)  -> status-based ResolverResult
 *   - normalizeForMatch, isAffirmative, isNegation
 *   - selectOption, parseExplicitChoice
 *
 * Catatan migrasi: resolvePending (baru, substring-includes) dan
 * resolvePendingClarification (lama, whole-word) memiliki semantik match yang
 * membedakan — ini menahan perilaku lama sampai orkestrator dilakoni fase berikutnya.
 * conversation.service.ts / clarification-resolver.ts TIDAK disentuh fase ini.
 */
import type { PendingClarification, CartOp, ResolverResult } from '../../domain/types.js';
/** State pending yang dibawa resolvePending (camelCase, per spesifikasi fase 2). */
export interface PendingClarificationState {
    ops?: CartOp[];
    snapshot?: unknown;
    retryCount?: number;
}
export interface ResolvePendingContext {
    pending: PendingClarificationState;
    requiresHumanReview?: boolean;
}
/** Hasil resolver — aksi yang dieksekusi setelah clarifying question dijawab. */
export interface ResolvePendingResult {
    action: 'EXECUTE' | 'ROLLBACK' | 'RETRY' | 'ESCALATE';
    /** Ops yang dieksekusi (hanya EXECUTE) */
    ops?: CartOp[];
    /** Snapshot cart sebelum mutasi (hanya ROLLBACK) */
    snapshot?: unknown;
}
/**
 * Resolver utama — BAGIAN 2 (spesifikasi).
 *
 * @param ctx     { pending: { ops?, snapshot?, retryCount? }, requiresHumanReview }
 * @param message  pesan mentah customer
 * @returns ResolvePendingResult  (action-based)
 */
export declare function resolvePending(ctx: ResolvePendingContext, message: string): ResolvePendingResult;
/**
 * Normalisasi teks untuk matching: lowercase, trim, squash huruf berulang,
 * buang trailing punctuation, collapse whitespace.
 */
export declare function normalizeForMatch(text: string): string;
/** Cek apakah teks mengandung kata afirmatif (whole-word match). */
export declare function isAffirmative(text: string): boolean;
/** Cek apakah teks mengandung kata negasi. */
export declare function isNegation(text: string): boolean;
/**
 * Resolver kompatibilitas lama — PURE, status-based.
 * Dipakai clarification-resolver.ts (re-export + dynamic import) dan test lama.
 *
 * @param message  pesan mentah customer
 * @param pending  PendingClarification dari DB
 * @returns ResolverResult (status: RESOLVED | NEED_RETRY | ESCALATE | NOT_PENDING_ANSWER)
 */
export declare function resolvePendingClarification(message: string, pending: PendingClarification): ResolverResult;
/**
 * Pilih opsi yang cocok (keyword, case-insensitive) dari daftar label string.
 */
export declare function selectOption(text: string, options: string[]): string[];
/**
 * Parse pilihan eksplisit customer terhadap opsi.
 * Mengembalikan opsi pertama yang cocok, atau null.
 */
export declare function parseExplicitChoice(text: string, options: string[]): string | null;
//# sourceMappingURL=pendingClarification.d.ts.map