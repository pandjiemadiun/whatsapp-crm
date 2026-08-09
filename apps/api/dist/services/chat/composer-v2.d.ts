import type { ActV2, InterpreterResultV2, WorkspaceV2 } from './types-v2.js';
export interface CatalogItem {
    id: string;
    name: string;
}
/**
 * Balasan customer ketika percakapan eskalasi ke manusia/owner.
 * BUKAN generic "kurang paham" — menyatakan dengan jujur bahwa akan
 * disambungkan ke admin toko, sehingga customer tahu keadaan sebenarnya.
 */
export declare const ESCALATE_REPLY = "Baik kak, akan saya sambungkan ke admin toko ya, mohon ditunggu \uD83D\uDE4F";
/** Balasan eskalasi — pure, untuk di-test & dipakai conversation.service.ts. */
export declare function composeEscalateReply(): string;
/**
 * Payload konvensi yang sudah ada di codebase untuk menandai percakapan butuh
 * perhatian manusia (lihat routes/conversations.ts:88 & circuit breaker
 * message-processor.service.ts:491). Dipakai oleh conversation.service.ts
 * pada cabang ESCALATE/terminal — JANGAN bikin status baru di luar konvensi.
 */
export declare function escalateStatusUpdate(): {
    status: 'human_takeover';
    humanTakeoverAt: Date;
};
export declare function composeReply(params: {
    plannedActs: ActV2[];
    reasoningResult: InterpreterResultV2;
    workspace: WorkspaceV2;
    catalog: CatalogItem[];
    clarificationAttempt: number;
}): string;
//# sourceMappingURL=composer-v2.d.ts.map