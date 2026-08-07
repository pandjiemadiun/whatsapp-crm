import type { InterpreterOutput } from '../domain/types.js';
export { callSingleInterpreter, validateCartOpsAgainstDb } from './chat/interpreter.js';
/**
 * Count LLM calls in a time window — for I8 verification.
 * Queries conversationHistory for AI-sourced messages.
 */
export declare function countLlmCallsInWindow(conversationId: string, windowMs?: number): Promise<number>;
/**
 * Legacy wrapper — adapt old interpretMessage signature to callSingleInterpreter.
 * Old callers pass (conversationId, storeId, customerMessage, cart, activeOrder, customerCity).
 */
export declare function interpretMessage(conversationId: string, storeId: string, customerMessage: string, cart: Array<{
    product: string;
    qty?: number;
    price?: number;
}>, activeOrder: {
    orderStatus: string;
    items: any[];
} | null, customerCity: string | null): Promise<InterpreterOutput | null>;
//# sourceMappingURL=ot-or-interpreter.d.ts.map