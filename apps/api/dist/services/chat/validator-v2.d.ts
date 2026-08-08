/**
 * Validator v2 — BAGIAN 3 (v3.2)
 * src/services/chat/validator-v2.ts
 *
 * Memvalidasi InterpreterResultV2 terhadap katalog / opsi / pending.
 * 0-LLM (rule-based) — mengembalikan ValidatorResultV2{ok, reasons, retryable}.
 *
 * Invariants (I-V2-*):
 *  - I-V2-1 no entity left behind: tiap product-mention di acts.entities harus
 *        ada di catalog ATAU di unmatched_mentions.             -> retryable
 *  - I-V2-2 no silent affirmation: act affirmative/confirm + N>2 opsi
 *        tanpa quantifier subset.                               -> retryable
 *  - I-V2-3 kardinalitas: quantifier recomputed N dari optionsPresented;
 *        resolution_type=mismatch wajib ada mismatch_reason.   -> retryable
 *  - I-V2-4 attempts > CLARIFICATION_MAX_ATTEMPTS -> ok=false, retryable=FALSE (eskalasi)
 *  - I-V2-5 supersede valid: id yang direferensi ada di acts[], tak bersiklus -> retryable
 *  - I-V2-6 selection confidence < SELECTION_CONFIDENCE_THRESHOLD -> clarify, retryable=FALSE
 *  - I-V2-7 unmatched non-kosong wajib ada clarification ATAU disebut di reply_draft -> retryable
 *  - I-V2-8 conflicting_acts: 2 act cart_update produk sama tanpa supersedes -> retryable
 *  - I-V2-9 qty ada tapi qty_source absent -> retryable
 *
 * terminal (I-V2-4/I-V2-6) menang atas retryable bila konflik: eskalasi/clarify
 * tidak boleh di-retry.
 *
 * I8: validator 0-LLM.
 * I5: semua resolusi pakai act_id / nama, bukan index.
 */
import type { InterpreterResultV2, PendingV2, ValidatorResultV2 } from './types-v2.js';
import type { CatalogItem } from './setops.js';
export interface ValidatorContextV2 {
    optionsPresented: string[];
    catalog: CatalogItem[];
    pendings: PendingV2[];
}
export declare function validate(result: InterpreterResultV2, ctx: ValidatorContextV2): ValidatorResultV2;
//# sourceMappingURL=validator-v2.d.ts.map