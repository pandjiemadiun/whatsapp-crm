/**
 * One-Shot Interpreter — BAGIAN 3 (compatibility re-export shim)
 *
 * Re-exports the new single-shot interpreter API (runOneCall) +
 * countLlmCallsInWindow for I8 verification. The old interpretMessage
 * wrapper has been removed (unused after the Tahap 4 orchestrator moved
 * to runOneCall directly).
 */
import { prisma } from '../infrastructure/prisma.js';
// Re-export the new single-shot interpreter API for legacy callers/tests.
export { runOneCall, validateCartOpsAgainstDb } from './chat/interpreter.js';
/**
 * Count LLM calls in a time window — for I8 verification.
 * Queries conversationHistory for AI-sourced messages.
 */
export async function countLlmCallsInWindow(conversationId, windowMs = 60000) {
    const now = Date.now();
    const since = new Date(now - windowMs);
    const history = await prisma.conversationHistory.findMany({
        where: {
            conversationId,
            createdAt: { gte: since },
            source: { in: ['ai', 'groq', 'gemini', 'llm'] },
        },
        select: { id: true },
    });
    return history.length;
}
//# sourceMappingURL=ot-or-interpreter.js.map