import { composeClarification } from './clarification-composer.js';
/**
 * Balasan customer ketika percakapan eskalasi ke manusia/owner.
 * BUKAN generic "kurang paham" — menyatakan dengan jujur bahwa akan
 * disambungkan ke admin toko, sehingga customer tahu keadaan sebenarnya.
 */
export const ESCALATE_REPLY = 'Baik kak, akan saya sambungkan ke admin toko ya, mohon ditunggu 🙏';
/** Balasan eskalasi — pure, untuk di-test & dipakai conversation.service.ts. */
export function composeEscalateReply() {
    return ESCALATE_REPLY;
}
/**
 * Payload konvensi yang sudah ada di codebase untuk menandai percakapan butuh
 * perhatian manusia (lihat routes/conversations.ts:88 & circuit breaker
 * message-processor.service.ts:491). Dipakai oleh conversation.service.ts
 * pada cabang ESCALATE/terminal — JANGAN bikin status baru di luar konvensi.
 */
export function escalateStatusUpdate() {
    return { status: 'human_takeover', humanTakeoverAt: new Date() };
}
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
    else {
        // C2. Fallback: LLM tidak mengisi draft_cart_ops, tapi plannedActs punya cart/order act.
        // Supaya reply tidak kosong padahal cart ops dieksekusi.
        const cartActs = plannedActs.filter((a) => {
            const intent = ((a?.intent) || '').toLowerCase();
            return intent.includes('cart') || intent.includes('order') || intent.includes('buy') || intent.includes('remove') || intent.includes('hapus') || intent.includes('cancel') || intent.includes('delete') || intent.includes('batal');
        });
        const cartMessages = cartActs.flatMap((act) => {
            const intent = ((act.intent) || '').toLowerCase();
            const isRemove = intent.includes('remove') || intent.includes('hapus') || intent.includes('cancel') || intent.includes('delete') || intent.includes('batal');
            const entities = (Array.isArray(act.entities) ? act.entities : []).filter((e) => e?.type === 'product' && typeof e.value === 'string' && e.value.trim().length > 0);
            const qtyPerEntity = act.qty && entities.length === 1 ? act.qty : 1;
            return entities.map((e) => isRemove ? `🗑️ Dihapus dari keranjang: ${e.value}` : `🛒 Ditambahkan ke keranjang: ${e.value} x${qtyPerEntity}`);
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
    // F. Format final — rugi-rugi: jangan pernah balas kosong
    const finalReply = messages.slice(0, 3).join('\n');
    if (finalReply.trim().length > 0) {
        return finalReply;
    }
    return reasoningResult.reply_draft && reasoningResult.reply_draft.trim().length > 0
        ? reasoningResult.reply_draft
        : "Maaf kak, saya kurang paham. Bisa ulangi pesannya?";
}
//# sourceMappingURL=composer-v2.js.map