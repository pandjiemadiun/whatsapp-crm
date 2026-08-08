/** Versi skema workspace v2 yang dipakai trace (selaras ENGINE_VERSION v3.2). */
export declare const SCHEMA_VERSION: string;
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
/**
 * Buat trace baru untuk sebuah conversation.
 * engine_version + schema_version langsung ter-stamp dari konstanta v3.2.
 */
export declare function newTrace(conversation_id: string): Trace;
/**
 * Tambahkan satu langkah ke trace. Mutasi in-place pada trace.steps.
 * @param trace   trace yang dimutasi
 * @param step    label langkah (mis. 'plan', 'resolve', 'supersede')
 * @param detail  payload opsional
 */
export declare function add(trace: Trace, step: string, detail?: Record<string, unknown>): Trace;
/**
 * Ambil snapshot (point-in-time) dari trace — copy permukaan (shallow)
 * dengan array steps yang disalin agar penambahan selanjutnya tidak
 * mengubah snapshot yang sudah diambil.
 */
export declare function snapshot(trace: Trace): Trace;
/**
 * Flush trace ke logger. Setiap entry WAJIB ter-stamp ENGINE_VERSION + schema_version
 * (diambil dari objek trace itu sendiri, yang di-set newTrace pada saat pembuatan).
 */
export declare function logTrace(trace: Trace, extra?: Record<string, unknown>): void;
//# sourceMappingURL=decisionTrace.d.ts.map