/**
 * Prompt Template v2 — BAGIAN 1 (v3.2)
 * src/services/chat/prompts-v2.ts
 *
 * Builder untuk system prompt + user prompt LLM interpreter v3.2, beserta
 * 6 contoh transkrip (few-shot) sebagai konstanta terpisah.
 *
 * I8: artefak prompt ini tidak memanggil model — hanya memproduksi string
 *     yang dikirimkan ke interpreter (stage 4, LLM).
 */
import type { WorkspaceV2 } from './types-v2.js';
import type { CatalogItem } from './setops.js';
/**
 * Satu giliran dalam riwayat percakapan (role + isi pesan).
 * Dipakai buildUserPrompt untuk merekonstruksi konteks ke LLM.
 */
export interface HistoryTurn {
    role: 'user' | 'assistant' | 'system';
    content: string;
}
/** Satu contoh transkrip (few-shot) untuk dilatih prompt interpreter. */
export interface FewShotV2 {
    user_message: string;
    context_description: string;
    expected_json: string;
}
/**
 * Buat system prompt utama. Memuat:
 *   - 11 aturan eksplisit (rule a..k) yang wajib dipatuhi interpreter, dan
 *   - daftar nama produk dari katalog (dibaca dari parameter, bukan hardcoded).
 */
export declare function buildSystemPrompt(catalog: CatalogItem[]): string;
/**
 * Buat user prompt: gabungan pesan user, ringkasan workspace (summary +
 * pending aktif + opsi terakhir), dan riwayat conversasi.
 */
export declare function buildUserPrompt(message: string, workspace: WorkspaceV2, history: HistoryTurn[]): string;
/**
 * 11 contoh (user_message + konteks + expected_json) yang memandu interpreter:
 *   1. multi-act 3 produk — tidak ada product mention yang missing.
 *   2. revisi dalam satu kalimat — act kedua punya supersedes=act_id pertama.
 *   3. topic switch — pending aktif + user tanya di luar scope order.
 *   4. quantifier mismatch — user merujuk opsi ketiga yang tidak ada.
 *   5. afirmasi ambigu — "iya" pada 4 opsi, butuh clarifikasi.
 *   6. multi-add dalam satu kalimat — 3 produk qty 1 eksplisit, confidence tinggi.
 *   7. greeting — acts kosong, reply_draft ramah.
 *   8. cancel — intent cancel + reply_draft konfirmasi pembatalan.
 *   9. single variant product (warna/size) — deskripsi varian ke draft_cart_ops[].variant.
 *   10. mix variant + non-variant — variant hanya pada draft_cart_op produk bervarian.
 *   11. variant product tanpa qty eksplisit (qty default) — varian tetap tercatat.
 */
export declare const FEW_SHOTS: FewShotV2[];
//# sourceMappingURL=prompts-v2.d.ts.map