/**
 * Fast Path Deterministic Resolver — FASE B3
 * src/services/chat/fast-path.ts
 *
 * Modul 0-LLM yang mencoba menjawab pesan TANPA memanggil LLM interpreter.
 * Urutan eksekusi:
 *   A. Cek pending clarification aktif → deterministic resolver
 *   B. Cek tier deterministik (fallback service) — READ-ONLY
 *   C. Miss total → serahkan ke LLM interpreter
 *
 * I8: stage ini 0-LLM — tidak ada panggilan model di jalur utama.
 *     Tier fallback juga rule-based (cache, FAQ, SOP, total, ongkir, dll).
 * I10: resolver menutup klarifikasi tanpa LLM; tidak menghasilkan harga/stok.
 * I15: hasil tier belum diverifikasi ke DB — verifikasi dilakukan di stage terpisah.
 */
import type { WorkspaceV2 } from './types-v2.js';
import type { CatalogItem } from './setops.js';
import type { ResponseResult } from '../../domain/types.js';
/**
 * Payload ketika pending clarification berhasil di-resolve secara deterministik.
 * `action` menentukan apa yang harus dilakukan orchestrator:
 *  - 'EXECUTE': konfirmasi opsi yang dipilih
 *  - 'ROLLBACK': batalkan pending clarification (mis. kata negasi)
 */
export interface ResolvedPayload {
    /** ID pending yang diselesaikan */
    pendingId: string;
    /** Aksi yang dieksekusi */
    action: 'EXECUTE' | 'ROLLBACK';
    /** Indeks opsi yang dipilih (0-based). Hanya untuk EXECUTE. */
    resolvedIndices?: number[];
    /** Nama opsi yang matched. Hanya untuk EXECUTE. */
    matchedNames?: string[];
}
/**
 * Hasil fast-path — discriminated union.
 * - hit=true : jawaban ditemukan tanpa LLM, payload mengandung detailnya.
 * - hit=false: tidak ada fast-path match; lanjut ke LLM interpreter.
 */
export type FastPathResult = {
    hit: true;
    outcome: 'resolved' | 'tier';
    payload: ResolvedPayload | ResponseResult;
} | {
    hit: false;
    pendingParked: boolean;
    topicSwitch: boolean;
};
/**
 * Cek afirmatif: keyword iya/ya/oke/sip + N ≤ 2 opsi → EXECUTE semua.
 * I10: 0-LLM affirmation closes clarification.
 */
export declare function tryMatchAffirmative(message: string, options: string[]): boolean;
/**
 * Cek negasi: keyword ga/gak/batal → ROLLBACK.
 */
export declare function tryMatchNegation(message: string): boolean;
/**
 * Cek quantifier eksak: "dua duanya" + N=2 → EXECUTE semua.
 * Mengembalikan {exact, indices} di mana:
 * - exact=true, indices=[0..N-1] bila quantifier cocok dan N sesuai
 * - exact=false, indices=null bila tidak cocok
 */
export declare function tryMatchQuantifier(message: string, N: number): {
    exact: boolean;
    indices: number[] | null;
};
/**
 * Parse indeks opsi dari pesan.
 * Contoh: "nomor 1" → [0], "nomor 2" → [1], "yang kedua" → [1].
 * Kembalikan null bila tidak ada indeks yang terdeteksi.
 */
export declare function tryMatchIndices(message: string): number[] | null;
/**
 * Cek apakah pesan menyebut nama opsi yang ada.
 * Kembalikan array nama yang matched, atau null bila tidak ada.
 */
export declare function tryMatchNames(message: string, options: string[]): string[] | null;
/**
 * Parkirkan pending: ubah status ke 'deferred' + increment deferred_turns.
 * Mutasi in-place pada workspace (Accessor PURE — storage di-handle caller).
 */
export declare function parkPendingAndIncrementTurns(workspace: WorkspaceV2, pendingId: string): void;
/**
 * Coba selesaikan pesan via 0-LLM fast path.
 *
 * @param message        pesan mentah customer
 * @param workspace      state workspace perpercakapan (v2)
 * @param catalog        katalog produk toko
 * @param fallbackService  service tier deterministik (READ-ONLY); typed as any
 * @returns FastPathResult — discriminated union
 *
 * I8: maksimal 0 panggilan LLM di fast path ini.
 * I10: semua hasil resolved/tier berasal dari rule-based resolver, bukan LLM.
 */
export declare function tryFastPath(message: string, workspace: WorkspaceV2, catalog: CatalogItem[], fallbackService: any): Promise<FastPathResult>;
//# sourceMappingURL=fast-path.d.ts.map