/**
 * Pending Clarification Resolver — BAGIAN 2
 * src/services/chat/pendingClarification.ts
 *
 * Pure resolver: given a normalizedText + pendingClarification state,
 * determine whether customer's reply resolves the clarification.
 *
 * Afirmatif → execute cart_ops TANPA LLM.
 * Negasi → rollback snapshot, clear pending.
 * Eksplisit (angka/urutan) → pilih opsi spesifik.
 * Miss → retry (retry_count ≤1) atau eskalasi ke pemilik toko.
 */
import type { PendingClarification, ResolverResult } from '../../domain/types.js';
export declare function normalizeForMatch(text: string): string;
/** Cek apakah teks mengandung kata afirmatif */
export declare function isAffirmative(text: string): boolean;
/** Cek apakah teks mengandung kata negasi */
export declare function isNegation(text: string): boolean;
/** Cek apakah teks memilih opsi eksplisit (angka, "yang pertama", dsb) */
export declare function parseExplicitChoice(text: string): number | null;
/**
 * Cek apakah teks memilih opsi spesifik dari clarification.options.
 * Fuzzy match per kata kunci.
 */
export declare function selectOption(text: string, options: any[]): string[];
/**
 * @param normalizedText  pesan yang sudah dinormalisasi
 * @param pending         state pending clarification dari DB
 * @returns ResolverResult
 */
export declare function resolvePendingClarification(normalizedText: string, pending: PendingClarification): ResolverResult;
//# sourceMappingURL=pendingClarification.d.ts.map