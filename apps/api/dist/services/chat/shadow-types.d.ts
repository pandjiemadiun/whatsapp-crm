/**
 * Shadow Compare Types — FASE C1 (sub-fase 1/4)
 * src/services/chat/shadow-types.ts
 *
 * Tipe-tipe untuk log-only shadow compare: membandingkan output engine lama
 * (live) dengan engine v3.2 (shadow) per message, tanpa memengaruhi flow
 * produksi. Modul ini PURE — tidak ada side effect.
 *
 * I8: modul ini tidak memanggil model.
 * I15: hasil shadow belum diverifikasi ke DB — verifikasi di stage terpisah.
 */
import type { ResponseSource } from '../../domain/types.js';
import type { ActV2, ShadowOutcome } from './types-v2.js';
export type { ShadowOutcome } from './types-v2.js';
/**
 * Bagian "old" — output engine yang sekarang live.
 */
export interface ShadowOld {
    /** ResponseSource engine lama */
    source: ResponseSource;
    /** Reply teks yang dikirim ke customer */
    reply: string;
    /** Entitas yang diekstrak dari DB oleh engine lama */
    entities: any[];
}
/**
 * Satu intent yang diekstrak dari acts, beserta entitasnya.
 */
export interface ShadowIntent {
    intent: string;
    entities: any[];
}
/**
 * Bagian "new" — output engine v3.2 (shadow).
 */
export interface ShadowNew {
    outcome: ShadowOutcome;
    /** Draft reply dari reasoning result (bisa null bila gagal) */
    reply_draft: string | null;
    /** Intent + entities per act */
    intents: ShadowIntent[];
    /** Semua entitas gabungan dari semua act */
    entities: any[];
    /** Mention yang tidak ter-resolusi ke catalog */
    unmatched: string[];
    /** Act yang direncanakan oleh planner */
    plannedActs: ActV2[];
    /** Alasan validator (kosong bila ok) */
    validatorReasons: string[];
    /** Apakah validator menandai retryable */
    validatorRetryable: boolean;
    /** Jumlah LLM call yang dilakukan (0 | 1 | 2) */
    llmCalls: 0 | 1 | 2;
}
/**
 * Hasil perbandingan (diff) antara output engine lama dan baru.
 */
export interface ShadowMismatch {
    /** old.reply !== new.reply_draft (case-insensitive) */
    replyDiffers: boolean;
    /** set produk lama ≠ set produk baru */
    entitySetDiffers: boolean;
    /** jumlah entitas produk pada engine lama */
    oldEntityCount: number;
    /** jumlah entitas produk pada engine baru */
    newEntityCount: number;
}
/**
 * Satu entri shadow compare — per-bandingan satu message.
 * engine_version + schema_version WAJIB ter-stamp pada setiap entry.
 */
export interface ShadowEntry {
    conversation_id: string;
    message_id: string;
    engine_version: string;
    schema_version: string;
    timestamp: number;
    store_id: string;
    old: ShadowOld;
    new: ShadowNew;
    mismatch: ShadowMismatch;
}
/**
 * Item review shadow entry oleh manusia (untuk analisis kualitas).
 * Storage/persistence di-handle caller (FASE C3).
 */
export interface ShadowReviewItem {
    id: string;
    conversation_id: string;
    message_id: string;
    entry: ShadowEntry;
    reviewed: boolean;
    decision: 'correct' | 'better' | 'worse' | 'edge_case' | null;
    note: string | null;
    created_at: number;
}
//# sourceMappingURL=shadow-types.d.ts.map