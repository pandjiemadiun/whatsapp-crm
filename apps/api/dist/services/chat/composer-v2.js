import { composeClarification } from './clarification-composer.js';
export function composeReply(params) {
    const { plannedActs, reasoningResult, workspace, clarificationAttempt } = params;
    // A. JIKA ada clarification
    if (reasoningResult.clarification) {
        return composeClarification(reasoningResult.clarification, clarificationAttempt);
    }
    // B. JIKA plannedActs kosong
    if (plannedActs.length === 0) {
        return reasoningResult.reply_draft || "Maaf kak, saya kurang paham.";
    }
    const messages = [];
    // C. JIKA ada cart_update act (draft_cart_ops)
    if (reasoningResult.draft_cart_ops && reasoningResult.draft_cart_ops.length > 0) {
        const cartMessages = reasoningResult.draft_cart_ops.map((op) => {
            if (op.status === 'needs_clarification') {
                return `Boleh tolong konfirmasi produk ${op.product}?`;
            }
            return `🛒 Ditambahkan ke keranjang: ${op.product} x${op.qty}`;
        });
        messages.push(...cartMessages);
    }
    // D. JIKA ada info_answer act (cek intents di plannedActs)
    const hasInfo = plannedActs.some((act) => act.intent === 'info_answer');
    if (hasInfo && reasoningResult.reply_draft) {
        messages.push(reasoningResult.reply_draft);
    }
    // E. JIKA ada topic_switch=true
    if (reasoningResult.topic_switch) {
        const pendingProduct = workspace.pendings.length > 0 ? 'pesanan' : 'pembicaraan';
        messages.push(`Oh ya Kak, tadi masih lanjut pesan ${pendingProduct} atau mau batal?`);
    }
    // F. Format final
    return messages.slice(0, 3).join('\n');
}
//# sourceMappingURL=composer-v2.js.map