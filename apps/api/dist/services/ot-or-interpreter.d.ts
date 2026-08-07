export { runOneCall, validateCartOpsAgainstDb } from './chat/interpreter.js';
/**
 * Count LLM calls in a time window — for I8 verification.
 * Queries conversationHistory for AI-sourced messages.
 */
export declare function countLlmCallsInWindow(conversationId: string, windowMs?: number): Promise<number>;
//# sourceMappingURL=ot-or-interpreter.d.ts.map