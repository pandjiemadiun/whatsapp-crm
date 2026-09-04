/**
 * V2 Engine — Context Assembly Layer
 *
 * Standalone utility: buildLLMContext().
 * No wiring to interpreter.ts / reasoning.ts / fallback.service.ts.
 *
 * Implements Part 3 of CHAT-ENGINE-V2-DESIGN-P1.md:
 *  - Sliding window (MAX_TURNS = 10)
 *  - Workspace_v2 state injection
 *  - 3-layer format: state → history → current message
 */
import type { WorkspaceV2 } from '../types-v2.js';
import type { HistoryTurn } from '../prompts-v2.js';
export declare const MAX_TURNS = 10;
export interface BuildLLMContextOptions {
    recentHistory: HistoryTurn[];
    workspace: WorkspaceV2;
    customerMessage: string;
}
export declare function buildLLMContext({ recentHistory, workspace, customerMessage, }: BuildLLMContextOptions): string;
//# sourceMappingURL=context-builder.d.ts.map