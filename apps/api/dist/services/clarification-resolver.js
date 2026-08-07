/**
 * Clarification Resolver — BAGIAN 2 (integration layer)
 *
 * Re-exports pure classifier functions from chat/pendingClarification.ts.
 * The integration wrapper resolvePendingClarification loads pending state
 * from DB, calls the pure resolver, then executes side effects.
 */
import { prisma } from '../infrastructure/prisma.js';
import { conversationContextService } from '../business/conversation-context.service.js';
/**
 * BAGIAN 2: Pending clarification resolver (pure functions) — re-exported from chat module.
 * BAGIAN 2: Integration wrapper — loads pending from DB, calls pure resolver, executes side effects.
 */
export { resolvePendingClarification as resolvePendingClarificationPure, isAffirmative, isNegation, parseExplicitChoice, normalizeForMatch, selectOption, } from './chat/pendingClarification.js';
/**
 * BAGIAN 2 — Integration resolver.
 * Dipanggil di awal processCustomerMessage; jika ada pending clarification,
 * resolver menangani V0 LLM berdasarkan afirmatif/negasi.
 */
export async function resolvePendingClarification(conversationId, storeId, customerMessage) {
    const ctxRow = await prisma.conversationContext.findUnique({
        where: { conversationId },
        select: { extractedEntities: true, lastMessages: true },
    });
    if (!ctxRow)
        return { handled: false };
    const entities = conversationContextService.parseExtractedEntities(ctxRow.extractedEntities);
    const pending = conversationContextService.getPendingClarification(entities);
    if (!pending)
        return { handled: false };
    // Convert flat options format to ClarificationOption[]
    const pendingWithOptions = {
        ...pending,
        options: (pending.options || pending.rawOptions || []).map((opt, i) => typeof opt === 'string' ? { id: String(i), label: opt } : opt),
    };
    const { resolvePendingClarification: pureResolve } = await import('./chat/pendingClarification.js');
    const result = pureResolve(customerMessage, pendingWithOptions);
    switch (result.status) {
        case 'RESOLVED':
            await conversationContextService.clearPendingClarification(conversationId);
            // Rollback snapshot if negasi
            if (result.cartOps && result.cartOps.length === 0) {
                const previousMutation = entities.previousMutation;
                if (previousMutation && previousMutation.cartSnapshot) {
                    await conversationContextService.restoreCart(conversationId, previousMutation.cartSnapshot);
                    const updated = { ...entities, previousMutation: null };
                    await prisma.conversationContext.update({
                        where: { conversationId },
                        data: { extractedEntities: updated },
                    });
                }
            }
            const reply = await renderPostActionReply(conversationId, storeId, pendingWithOptions);
            return {
                handled: true,
                action: { approved: Boolean(result.cartOps && result.cartOps.length > 0), selectedProducts: undefined },
                reply,
            };
        case 'NEED_RETRY':
            return { handled: true, reply: result.message, retryQuestion: result.message };
        case 'ESCALATE':
            return { handled: true, escalate: true, reply: result.message };
        case 'NOT_PENDING_ANSWER':
        default:
            return { handled: false };
    }
}
/**
 * Render reply setelah cart_ops dieksekusi — FROM DB STATE, bukan dari LLM.
 */
async function renderPostActionReply(conversationId, storeId, pending) {
    const ctxRow = await prisma.conversationContext.findUnique({
        where: { conversationId },
        select: { extractedEntities: true },
    });
    const entities = conversationContextService.parseExtractedEntities(ctxRow?.extractedEntities);
    const cart = entities.confirmedItems ?? [];
    const productNames = cart.map((i) => i.product);
    const totalQty = cart.reduce((sum, i) => sum + (typeof i.qty === 'number' ? i.qty : 1), 0);
    let reply = '';
    if (productNames.length > 0) {
        reply = `✅ Baik Kak, sudah kudapatkan!\n\n*Keranjang:*\n${productNames.map((p) => `• ${p}`).join('\n')}\n\nTotal: ${totalQty} item. Mau tambah lagi atau sudah cukup?`;
    }
    else {
        reply = `✅ Siap Kak!`;
    }
    return reply;
}
/**
 * Build a PendingClarification dari interpreter output.
 */
export function buildPendingFromClarification(clarification) {
    return {
        question: clarification.question,
        options: clarification.options,
        expected_type: clarification.expected_type,
    };
}
//# sourceMappingURL=clarification-resolver.js.map