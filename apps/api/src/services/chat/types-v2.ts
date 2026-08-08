/**
 * v3.2 Type Definitions — BAGIAN 1 (v3.2)
 * src/services/chat/types-v2.ts
 *
 * Definisi tipe struktural untuk staged pipeline v3.2.
 * File ini PURE — tidak ada impor sisi-effek, hanya type imports.
 *
 * I13: semua tipe di bawah bersifat versioned ('v2 suffix') agar tidak
 *      bertabrakan dengan tipe legacy di domain/types.ts; orkestrator akan
 *      beralih ke tipe v2 pada fase yang sesuai.
 */
import type { ExtractedEntity } from '../../domain/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Act (unit aksi yang diekstraksi dari satu pesan customer)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Satu act yang diekstraksi dari pesan customer.
 * `qty_source` membedakan apakah kuantitas diekstrak secara eksplisit
 * dari teks, atau diisi default oleh rule/engine.
 * `supersedes` — act_id act sebelumnya yang digantikan (atau null).
 */
export interface ActV2 {
  act_id: string;
  intent: string;
  entities: ExtractedEntity[];
  qty?: number;
  qty_source: 'explicit' | 'default';
  confidence: number;
  supersedes: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Quantifier
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hasil kuantifikasi (resolution) quantity dari act.
 * `resolved_indices` — indeks entitas kuantitas yang berhasil dipetakan.
 */
export interface QuantifierV2 {
  resolution_type: 'exact' | 'subset' | 'ambiguous' | 'mismatch';
  resolved_indices: number[];
  mismatch_reason?: string;
}

/**
 * Skor keyakinan terperinci per dimensi (0..1).
 */
export interface ConfidenceV2 {
  entities: number;
  intent: number;
  selection: number;
  topic: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft cart operation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Operasi draft keranjang yang dihasilkan dari act.
 * `status`='confirmed' berarti kuantitas dan produk sudah valid;
 * 'needs_clarification' berarti menunggu konfirmasi lanjutan.
 */
export interface DraftCartOp {
  action: 'add' | 'remove';
  product: string;
  qty: number;
  qty_source: 'explicit' | 'default';
  status: 'confirmed' | 'needs_clarification';
}

// ─────────────────────────────────────────────────────────────────────────────
// Pending clarification (v2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clarification yang sedang pending pada satu siklus.
 * `attempts` — berapa kali question sudah dihadirkan kembali.
 * `deferred_turns` — berapa turn menunggu sejak status beralih ke 'deferred'.
 */
export interface PendingV2 {
  id: string;
  question: string;
  options: string[];
  status: 'active' | 'deferred' | 'resolved' | 'dropped';
  attempts: number;
  deferred_turns: number;
  asked_at: string;
}

/**
 * Clarification yang baru dibangkitkan oleh interpreter.
 */
export interface ClarificationV2 {
  question: string;
  options: string[];
  expected_type: 'affirmative' | 'choice' | 'yes_no';
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace
// ─────────────────────────────────────────────────────────────────────────────

/**
 * State workspace perpercakapan yang persisten (serialized ke kolom context JSON).
 * `options_presented` — riwayat array opsi yang pernah ditampilkan per turn.
 */
export interface WorkspaceV2 {
  schema_version: string;
  conversation_summary: string;
  pendings: PendingV2[];
  draft_cart: DraftCartOp[];
  resolved_facts: Record<string, unknown>;
  last_bot_message_type?: string;
  options_presented: string[][];
}

// ─────────────────────────────────────────────────────────────────────────────
// Interpreter result (v2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Output satu siklus interpreter v3.2.
 * Berisi kumpulan act, quantifier opsional, draft cart ops, dan
 * clarification yang mungkin perlu ditanyakan kembali.
 */
export interface InterpreterResultV2 {
  acts: ActV2[];
  quantifier?: QuantifierV2;
  unmatched_mentions: string[];
  topic_switch: boolean;
  draft_cart_ops: DraftCartOp[];
  clarification?: ClarificationV2;
  reply_draft?: string;
  confidence: ConfidenceV2;
  summary_update?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validator result (v2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hasil validasi interpreter result terhadap katalog/DB.
 */
export interface ValidatorResultV2 {
  ok: boolean;
  reasons: string[];
  retryable: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shadow outcome (type alias)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Label alur eksekusi yang dipilih secara shadow (untuk telemetry/audit).
 * - 'resolved'                : jawaban ditemukan via pending/resolver (0-LLM)
 * - 'tier'                    : cocok via rule-based tier (0-LLM)
 * - 'reasoned'                : LLM interpreter berhasil (Stage 4)
 * - 'fallback_reasoning_failed': LLM gagal dan fallback ke dead-end (I15)
 */
export type ShadowOutcome = 'resolved' | 'tier' | 'reasoned' | 'fallback_reasoning_failed';
