/**
 * Clarification Composer — BAGIAN 2 (v3.2)
 * src/services/chat/clarification-composer.ts
 *
 * Menyusun kalimat clarification (natural language) dengan bentuk yang
 * BERUBAH per attempt:
 *   - attempt 1: klarifikasi normal (tanya langsung + list opsi).
 *   - attempt 2: berubah bentuk — tidak mengulang question; menawarkan
 *                jalan keluar (default / sebut nomor / batal).
 *   - attempt >= 3: fallback (defensive; seharusnya tidak tercapai karena
 *                validator menolak sebelum ke sini).
 *
 * I8: composer ini 0-LLM — hanya memformat string, tidak memanggil model.
 * I10: attempt 2 menawarkan jalan keluar sehingga user tidak terasa ditahan;
 *      klarifikasi final ditutup oleh user (bukan LLM), sehingga tidak menghasilkan
 *      harga/stok yang belum diverifikasi. (I15)
 */
import type { ClarificationV2 } from './types-v2.js';
/** Konteks opsional untuk personalisasi clarification. */
export interface ComposeContextV2 {
    /** Nama produk paling laris — ditawarkan sebagai default di attempt 2 (jika ada). */
    topProduct?: string;
}
/**
 * Susun kalimat clarification untuk attempt tertentu.
 *
 * @param clar    clarification yang akan disusun.
 * @param attempt nomor attempt clarification (1 = normal, 2 = berubah bentuk,
 *                >= 3 = fallback).
 * @param context opsional (mis. topProduct untuk default attempt 2).
 */
export declare function composeClarification(clar: ClarificationV2, attempt: number, context?: ComposeContextV2): string;
//# sourceMappingURL=clarification-composer.d.ts.map