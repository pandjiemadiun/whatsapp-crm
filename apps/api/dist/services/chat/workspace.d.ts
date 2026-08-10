/**
 * Workspace v2 Accessor — BAGIAN 1 (v3.2)
 * src/services/chat/workspace.ts
 *
 * Accessor PURE untuk objek WorkspaceV2 yang sudah ada di memori.
 * Storage (persist JSON) sepenuhnya di-handle caller; file ini hanya:
 *   - mengakses/mutasi struktur WorkspaceV2 di memori, dan
 *   - konversi JSON <-> WorkspaceV2 (loadWorkspace / saveWorkspace).
 *
 * I8: stage ini 0-LLM — tidak ada panggilan model dilakukan di accessor manapun.
 * I10: resolver (resolvePending) menutup klarifikasi tanpa LLM; accessor hanya
 *      merekam status, tidak menghasilkan harga/stok. (I15)
 */
import type { WorkspaceV2, PendingV2, DraftCartOp, ActV2 } from './types-v2.js';
import type { ExtractedEntities } from '../../domain/types.js';
/**
 * Parse JSON string menjadi WorkspaceV2.
 * Defensif pada batas boundary JSON: bidang struktural (array/object)
 * di-defaultkan agar tidak crash bila storage data parsial.
 */
export declare function loadWorkspace(json: string): WorkspaceV2;
/**
 * Serialisasi WorkspaceV2 ke JSON string (untuk persist caller).
 */
export declare function saveWorkspace(ws: WorkspaceV2): string;
/**
 * Dapatkan daftar pending, opsional difilter per status.
 */
export declare function getPendings(ws: WorkspaceV2, status?: PendingV2['status']): PendingV2[];
/**
 * Parkirkan (store) sebuah pending baru ke workspace.
 * Mutasi in-place pada ws.pendings; mengembalikan ws untuk chaining.
 */
export declare function parkPending(ws: WorkspaceV2, pending: PendingV2): WorkspaceV2;
/**
 * Aktifkan kembali pending yang 'deferred' -> status 'active'.
 */
export declare function resumePending(ws: WorkspaceV2, id: string): PendingV2 | undefined;
/**
 * Tandai pending sebagai 'resolved' (jawaban ditemukan). I10: tidak perlu LLM.
 */
export declare function resolvePending(ws: WorkspaceV2, id: string): PendingV2 | undefined;
/**
 * Tandai pending sebagai 'dropped' (dibiarkan / timeout). I13.
 */
export declare function dropPending(ws: WorkspaceV2, id: string): PendingV2 | undefined;
/**
 * Increment counter `attempts` pada pending dengan id tertentu.
 */
export declare function incrementAttempts(ws: WorkspaceV2, id: string): PendingV2 | undefined;
/**
 * Increment counter `deferred_turns` pada pending.
 */
export declare function incrementDeferredTurns(ws: WorkspaceV2, id: string): PendingV2 | undefined;
/**
 * Apakah pending harus otomatis di-drop?
 * I13: ambang ditentukan oleh DEFERRED_AUTO_DROP_TURNS.
 */
export declare function shouldAutoDrop(pending: PendingV2): boolean;
/**
 * Tambahkan act sebagai draft cart op.
 * I13: status 'confirmed' hanya bila confidence >= SELECTION_CONFIDENCE_THRESHOLD;
 *      di bawah ambang -> 'needs_clarification' (draft belum dieksekusi).
 * I15: draft belum diverifikasi ke DB — validation ke DB dilakukan di stage terpisah.
 */
export declare function addToDraft(ws: WorkspaceV2, act: ActV2): DraftCartOp;
/**
 * Konfirmasi (flip status) sebuah draft item ke 'confirmed' berdasarkan index.
 */
export declare function confirmDraftItem(ws: WorkspaceV2, index: number): DraftCartOp | undefined;
/**
 * Simpan fakta terselesaikan (key/value) ke resolved_facts.
 */
export declare function setFact(ws: WorkspaceV2, key: string, value: unknown): WorkspaceV2;
/**
 * Ambil fakta yang pernah diselesaikan (undefined bila belum ada).
 */
export declare function getFact(ws: WorkspaceV2, key: string): unknown;
/**
 * Catat tipe pesan bot terakhir + opsi yang disajikan (ditambahkan ke history).
 * I8: 0-LLM bookkeeping — hanya mencatat, mengirim tidak dilakukan di sini.
 */
export declare function setLastBotMessage(ws: WorkspaceV2, type: string, options: string[]): WorkspaceV2;
/**
 * Dapatkan ringkasan percakapan.
 */
export declare function getSummary(ws: WorkspaceV2): string;
/**
 * Perbarui ringkasan percakapan.
 */
export declare function setSummary(ws: WorkspaceV2, summary: string): WorkspaceV2;
/**
 * Cek apakah legacy extractedEntities masih "ada isi" yang perlu dimigrasi ke v2.
 * Hanya migrasi bila ada confirmedItems atau pendingClarification — field in-itu
 * yang punya padanan v2 (draft_cart / pendings). Field lain (recipientName,
 * shippingAddress, discussedItems) tidak beralih otomatis pada turn pertama
 * kecuali memang ada keranjang/klarifikasi untuk dilanjutkan.
 */
export declare function hasLegacyState(legacy: ExtractedEntities | null | undefined): boolean;
/**
 * Migrasi satu arah: legacy ExtractedEntities (kolom `extractedEntities`) ke
 * WorkspaceV2 (kolom `workspace_v2`).
 *
 * Pemetaan (T3 fix — P3.2):
 *   - confirmedItems  -> draft_cart   (action:'add', status:'confirmed', qty_source:'default')
 *   - pendingClarification -> pendings  (status:'active'; question/options/asked_at/retry_count
 *                                       dipetakan ke PendingV2; retry_count -> attempts)
 *   - recipientName / shippingAddress / lastAmbiguousPrompt -> resolved_facts
 *     (v2 tidak punya slot eksplisit; masukkan ke resolved_facts yang generik)
 * Field tanpa padanan (discussedItems, previousMutation) tidak dipetakan —
 * biarkan default kosong.
 *
 * PURE: tidak ada I/O; dipanggil di titik baca conversation.service.ts:141.
 * Hasil mapping ini kemudian di-persist ke `workspace_v2` oleh caller agar turn
 * berikutnya pakai workspace_v2 sebagai sumber kebenaran (tidak re-map legacy).
 */
export declare function mapLegacyEntitiesToWorkspace(legacy: ExtractedEntities): WorkspaceV2;
//# sourceMappingURL=workspace.d.ts.map