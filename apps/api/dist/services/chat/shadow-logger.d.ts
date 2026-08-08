import type { ShadowEntry, ShadowMismatch } from './shadow-types.js';
import type { ResponseSource } from '../../domain/types.js';
import type { ActV2, InterpreterResultV2, ShadowOutcome } from './types-v2.js';
export interface BuildShadowEntryParams {
    conversationId: string;
    messageId: string;
    storeId: string;
    oldSource: ResponseSource;
    oldReply: string;
    oldEntities: any[];
    newOutcome: ShadowOutcome;
    reasoningResult: InterpreterResultV2;
    plannedActs: ActV2[];
    validatorReasons: string[];
    validatorRetryable: boolean;
    llmCalls: 0 | 1 | 2;
}
/**
 * Hitung mismatch antara output engine lama dan baru.
 * READ-ONLY — tidak memutate input.
 *
 * @param old    hasil engine lama: { reply, entities }
 * @param newv   hasil engine baru:  { reply_draft, entities }
 * @returns      ShadowMismatch
 */
export declare function computeMismatch(old: {
    reply: string;
    entities: any[];
}, newv: {
    reply_draft: string | null;
    entities: any[];
}): ShadowMismatch;
/**
 * Bangun ShadowEntry lengkap dari hasil engine lama dan baru.
 * Pure function — tidak melakukan I/O.
 *
 * WAJIB stamp engine_version + schema_version dari konstanta v3.2.
 */
export declare function buildShadowEntry(params: BuildShadowEntryParams): ShadowEntry;
/**
 * Log shadow entry ke logger.
 * WAJIB stamp engine_version + schema_version pada setiap entry.
 */
export declare function logShadowEntry(entry: ShadowEntry): void;
//# sourceMappingURL=shadow-logger.d.ts.map