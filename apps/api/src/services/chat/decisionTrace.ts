/**
 * Decision Trace — BAGIAN 2 (v3.2)
 * src/services/chat/decisionTrace.ts
 *
 * Audit trail (0-LLM bookkeeping) untuk setiap langkah keputusan pipeline.
 * Setiap catatan log WAJIB membawa stamp ENGINE_VERSION + schema_version
 * sebagai metadata versi agar traceability tetap utuh sejak ke atas.
 *
 * I8: trace tidak memanggil model — hanya merekam urutan langkah (0-LLM).
 */
import { adapters } from '../../adapters/container.js';
import { ENGINE_VERSION } from './constants-v2.js';

/** Versi skema workspace v2 yang dipakai trace (selaras ENGINE_VERSION v3.2). */
export const SCHEMA_VERSION: string = '3.2';

// ─────────────────────────────────────────────────────────────────────────────
// Trace types
// ─────────────────────────────────────────────────────────────────────────────

/** Satu langkah (event) dalam audit trail. */
export interface TraceStep {
  step: string;
  ts: number;
  detail?: Record<string, unknown>;
}

/**
 * Objek audit trail per-percakapan. Dibangun secara in-memory oleh caller;
 * persistence (flush ke log/FS) di-handle caller via logTrace.
 */
export interface Trace {
  conversation_id: string;
  engine_version: string;
  schema_version: string;
  created_at: number;
  steps: TraceStep[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutators (pure terhadap objek Trace, mutasi in-place)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Buat trace baru untuk sebuah conversation.
 * engine_version + schema_version langsung ter-stamp dari konstanta v3.2.
 */
export function newTrace(conversation_id: string): Trace {
  return {
    conversation_id,
    engine_version: ENGINE_VERSION,
    schema_version: SCHEMA_VERSION,
    created_at: Date.now(),
    steps: [],
  };
}

/**
 * Tambahkan satu langkah ke trace. Mutasi in-place pada trace.steps.
 * @param trace   trace yang dimutasi
 * @param step    label langkah (mis. 'plan', 'resolve', 'supersede')
 * @param detail  payload opsional
 */
export function add(
  trace: Trace,
  step: string,
  detail?: Record<string, unknown>
): Trace {
  trace.steps.push({ step, ts: Date.now(), detail });
  return trace;
}

/**
 * Ambil snapshot (point-in-time) dari trace — copy permukaan (shallow)
 * dengan array steps yang disalin agar penambahan selanjutnya tidak
 * mengubah snapshot yang sudah diambil.
 */
export function snapshot(trace: Trace): Trace {
  return { ...trace, steps: [...trace.steps] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Logging (I/O — persist di-handle logger)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Flush trace ke logger. Setiap entry WAJIB ter-stamp ENGINE_VERSION + schema_version
 * (diambil dari objek trace itu sendiri, yang di-set newTrace pada saat pembuatan).
 */
export function logTrace(
  trace: Trace,
  extra?: Record<string, unknown>
): void {
  adapters.logger.info('decisionTrace', {
    conversation_id: trace.conversation_id,
    engine_version: trace.engine_version,
    schema_version: trace.schema_version,
    created_at: trace.created_at,
    steps: trace.steps,
    ...(extra ?? {}),
  });
}
