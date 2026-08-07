/**
 * One-Shot Interpreter — BAGIAN 3 (compatibility wrapper)
 *
 * Re-exports callSingleInterpreter + countLlmCallsInWindow.
 * The old interpretMessage wrapper adapts the old signature to the new module.
 */
import { prisma } from '../infrastructure/prisma.js';
import type { InterpreterOutput } from '../domain/types.js';
import { adapters } from '../adapters/container.js';

// Re-export callSingleInterpreter for new integration
export { callSingleInterpreter, validateCartOpsAgainstDb } from './chat/interpreter.js';

/**
 * Count LLM calls in a time window — for I8 verification.
 * Queries conversationHistory for AI-sourced messages.
 */
export async function countLlmCallsInWindow(
  conversationId: string,
  windowMs: number = 60_000
): Promise<number> {
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

/**
 * Legacy wrapper — adapt old interpretMessage signature to callSingleInterpreter.
 * Old callers pass (conversationId, storeId, customerMessage, cart, activeOrder, customerCity).
 */
export async function interpretMessage(
  conversationId: string,
  storeId: string,
  customerMessage: string,
  cart: Array<{ product: string; qty?: number; price?: number }>,
  activeOrder: { orderStatus: string; items: any[] } | null,
  customerCity: string | null
): Promise<InterpreterOutput | null> {
  const { callSingleInterpreter } = await import('./chat/interpreter.js');
  const result = await callSingleInterpreter(customerMessage, {
    storeId,
    customerId: '',
    conversationId,
    messages: [],
  }, {
    cart,
    activeOrder: activeOrder as any,
    customerCity,
    products: [],
  });

  if (!result) return null;
  return result;
}
