import type { ActV2, InterpreterResultV2, WorkspaceV2 } from './types-v2.js';
export interface CatalogItem {
    id: string;
    name: string;
}
export declare function composeReply(params: {
    plannedActs: ActV2[];
    reasoningResult: InterpreterResultV2;
    workspace: WorkspaceV2;
    catalog: CatalogItem[];
    clarificationAttempt: number;
}): string;
//# sourceMappingURL=composer-v2.d.ts.map