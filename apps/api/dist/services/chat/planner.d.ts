/**
 * Act Planner — BAGIAN 2 (v3.2)
 * src/services/chat/planner.ts
 *
 * Merencanakan urutan act final dari kandidat ActV2:
 *   1. Resolusi rantai supersede (a3 -> a2 -> a1 -> final winner).
 *   2. Deteksi siklus supersede (a1 -> a2 -> a1) -> membuang act bersiklus.
 *   3. Pengurutan prioritas:
 *        safety/correction > clarification/question > cart_update >
 *        info_answer > recommendation > smalltalk
 *
 * I8: planner ini 0-LLM — rule-based, tidak memanggil model.
 * Semua resolusi memakai act_id (bukan index) agar stabil terhadap reorder input.
 */
import type { ActV2 } from './types-v2.js';
/**
 * Rencanakan act final dari kandidat.
 *
 * Alur:
 *   1. buildSupersededBy — peta act_id diganti -> penggantinya.
 *   2. Untuk tiap act, resolveWinner: act surviving hanya bila ia merupakan
 *      head rantai (winner === dirinya) dan tidak bersiklus.
 *   3. Urutkan survivors by priority (lihat PRIORITY_LABELS).
 *
 * Pasca-kondisi: act yang sudah di-supersede atau bersiklus TIDAK muncul
 * di output final.
 *
 * @param acts  kandidat ActV2 (urutan/sembarang; referral pakai act_id).
 * @returns     survivors yang sudah di-supersede & di-sort per prioritas.
 */
export declare function planActs(acts: ActV2[]): ActV2[];
//# sourceMappingURL=planner.d.ts.map