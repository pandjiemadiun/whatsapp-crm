/**
 * Reasoning Engine — FASE B4 (INTEGRASI)
 * src/services/chat/reasoning.ts
 *
 * Menggabungkan 4 lapis deterministik + LLM single-pass:
 *   A. Fast path (0-LLM): pending resolver + tier deterministik
 *   B. Reasoning (LLM): single-pass interpret + validate + plan
 *   C. Fallback: jika semua gagal
 *
 * I8: maksimal 1 LLM call per attempt (fast path = 0).
 *     Transport retry (429/timeout) max 1x; validation retry max 1x.
 * I10: fast path + tier tidak menghasilkan harga/stok dari LLM.
 * I15: hasil tier/reasoned belum diverifikasi ke DB — verifikasi di stage terpisah.
 */
import type { WorkspaceV2, InterpreterResultV2, ActV2 } from './types-v2.js';
import type { CatalogItem } from './setops.js';
import type { Trace } from './decisionTrace.js';
import type { HistoryTurn } from './prompts-v2.js';
/**
 * Hasil akhir reasoning engine — discriminated union.
 * - 'resolved'/'tier': jawaban ditemukan di fast path (0 LLM).
 * - 'reasoned': LLM interpreter berhasil, hasil divalidasi + di-plan.
 * - 'fallback_reasoning_failed': semua jalur gagal.
 */
export type ReasoningOutcome = {
    outcome: 'resolved' | 'tier';
    payload: any;
    llmCalls: 0;
} | {
    outcome: 'reasoned';
    result: InterpreterResultV2;
    plannedActs: ActV2[];
    llmCalls: 1 | 2;
    trace: Trace;
} | {
    outcome: 'fallback_reasoning_failed';
    error: string;
    llmCalls: 0 | 1 | 2;
    trace?: Trace;
};
/**
 * Jika LLM output pakai supersedes sebagai number (positional index),
 * konversi ke act_id string setelah parse, sehingga semua komponen
 * selanjutnya (validator, planner) pakai act_id string.
 *
 * I5: semua referensi pakai act_id, BUKAN index — diterapkan di sini.
 */
export declare function convertPositionalSupersedes(result: InterpreterResultV2): void;
/**
 * Orchestrator utama reasoning engine — menggabungkan fast path + LLM + validator + planner.
 *
 * Alur:
 *   A. Fast path (0 LLM): cek pending active + tier deterministik
 *      - hit → return resolved/tier (llmCalls=0)
 *      - miss → lanjut ke B
 *   B. LLM single-pass:
 *      - attempt 1: groqAdapter.generate → parse → validate
 *      - ok → return reasoned (llmCalls=1)
 *      - ok=false, retryable → attempt 2 (with validator feedback)
 *        - ok → return reasoned (llmCalls=2)
 *        - ok=false → fallback (llmCalls=2)
 *      - ok=false, terminal (I-V2-4/I-V2-6) → fallback (llmCalls=1, JANGAN retry)
 *      - transport error → retry sekali, fallback jika gagal (llmCalls=1|2)
 *
 * I8: maksimal 1 LLM call per attempt; fast path = 0 LLM.
 * I10: fast path dan tier result tidak dari LLM.
 *
 * @param message        pesan mentah customer
 * @param workspace      state workspace perpercakapan (v2)
 * @param catalog        katalog produk toko
 * @param history        riwayat conversasi (untuk prompt LLM)
 * @param fallbackService  service tier deterministik (READ-ONLY; typed as any)
 * @returns ReasoningOutcome
 */
export declare function understand(message: string, workspace: WorkspaceV2, catalog: CatalogItem[], history: HistoryTurn[], fallbackService: any): Promise<ReasoningOutcome>;
//# sourceMappingURL=reasoning.d.ts.map