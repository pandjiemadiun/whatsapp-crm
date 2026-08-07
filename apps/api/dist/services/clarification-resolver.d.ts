import type { PendingClarification, ResolvedAction, InterpreterOutput } from '../domain/types.js';
/**
 * BAGIAN 2: Pending clarification resolver (pure functions) — re-exported from chat module.
 * BAGIAN 2: Integration wrapper — loads pending from DB, calls pure resolver, executes side effects.
 */
export { resolvePendingClarification as resolvePendingClarificationPure, isAffirmative, isNegation, parseExplicitChoice, normalizeForMatch, selectOption, } from './chat/pendingClarification.js';
export interface ResolveResult {
    handled: boolean;
    action?: ResolvedAction;
    reply?: string;
    retryQuestion?: string;
    escalate?: boolean;
}
/**
 * BAGIAN 2 — Integration resolver.
 * Dipanggil di awal processCustomerMessage; jika ada pending clarification,
 * resolver menangani V0 LLM berdasarkan afirmatif/negasi.
 */
export declare function resolvePendingClarification(conversationId: string, storeId: string, customerMessage: string): Promise<ResolveResult>;
/**
 * Build a PendingClarification dari interpreter output.
 */
export declare function buildPendingFromClarification(clarification: NonNullable<InterpreterOutput['clarification']>): Omit<PendingClarification, 'asked_at' | 'retry_count'>;
//# sourceMappingURL=clarification-resolver.d.ts.map