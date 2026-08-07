/**
 * RouteDecider — Single source of truth untuk routing intent customer.
 * Pipeline (conversation.service.ts + fallback.service.ts) WAJIB memakai fungsi ini.
 * Test runner (golden-runner) memakai fungsi yang sama.
 */
import { adapters } from '../adapters/container.js';
import { prisma } from '../infrastructure/prisma.js';
import { groqAdapter } from '../adapters/ai/groq.adapter.js';
// ── Keyword fast-path (murah, tidak pakai LLM) ──
const TOTAL_KEYWORDS = [
    'total', 'totalnya', 'total saya', 'berapa semua', 'semuanya berapa',
    'jumlahnya', 'grand total', 'gtotal', 'tagihannya', 'bayar berapa',
];
const ORDER_CHANGE_KEYWORDS = [
    'batalkan', 'batal', 'ganti barang', 'ganti item', 'ubah pesanan',
    'ubah item', 'cancel', 'ganti jadi', 'ganti pesanan', 'ganti',
];
// BAGIAN 1.2 — Payment keywords: NEVER trigger order_change / cart_modify
const PAYMENT_KEYWORDS = ['bayar', 'mau bayar', 'pembayaran', 'checkout', 'totalin'];
// BAGIAN 1.4 — Negation keywords: trigger rollback if system mutated on prev turn
const NEGATION_KEYWORDS = ['ga minta', 'gak minta', 'bukan itu', 'salah', 'kok dihapus', 'lah',
    'batalin', 'batal', 'hapusin',
];
const ORDER_STATUS_KEYWORDS = [
    'sudah dikirim', 'kapan dikirim', 'status pesanan', 'status order',
    'sampai mana', 'udah sampai', 'udah sampe', 'pesanan saya',
    'order saya', 'mana pesanan',
];
function hasKeyword(msg, keywords) {
    return keywords.some((kw) => msg.includes(kw));
}
/**
 * Build a lightweight context for decideRoute, optionally fetching from DB
 * if fullContext is not provided.
 * For tests: pass `{ conversationId, storeId, cart, activeOrder, customerCity, lowerMsg }`
 * For production: the caller fetches these beforehand to avoid N+1.
 */
export async function buildRouteContext(conversationId, storeId, customerMessage, customerCity = null) {
    const lowerMsg = customerMessage.trim().toLowerCase();
    const ctxRow = await prisma.conversationContext.findUnique({
        where: { conversationId },
        select: { extractedEntities: true },
    });
    const raw = ctxRow?.extractedEntities || {};
    const cart = Array.isArray(raw.confirmedItems) ? raw.confirmedItems : [];
    const previousMutation = raw.previousMutation || null;
    const activeOrder = await prisma.order.findFirst({
        where: {
            conversationId,
            deletedAt: null,
            orderStatus: { notIn: ['shipped', 'delivered', 'cancelled'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, orderStatus: true, items: true, notes: true },
    });
    return {
        conversationId,
        storeId,
        cart,
        activeOrder: activeOrder,
        customerCity,
        lowerMsg,
        previousMutation,
    };
}
/**
 * Keputusan rute utama:
 *  1. Total query → 'total' (skip cart gatekeeper)
 *  2. Order status keyword → 'order_status'
 *  3. Order change keyword + active order → 'order_change'
 *  4. Jika activeOrder ada & keyword tidak match → Groq semantic gate
 *  5. Cart items + MODIFY_CART intent → 'cart_modify'
 *  6. Otherwise → 'waterfall'
 */
export async function decideRoute(ctx) {
    const { lowerMsg, cart, activeOrder, customerCity, previousMutation } = ctx;
    // BAGIAN 1.4 — Negation rollback: if customer negates AND we mutated prev turn,
    // signal rollback via 'cart_clarify' so conversation.service can restore snapshot
    if (hasKeyword(lowerMsg, NEGATION_KEYWORDS)) {
        if (previousMutation && previousMutation.cartSnapshot) {
            return {
                kind: 'cart_clarify',
                intent: 'ROLLBACK',
                reason: 'negation + previous_mutation -> rollback_to_snapshot',
            };
        }
        // Negation but no prior mutation → clarify (don't mutate blindly)
        return {
            kind: 'cart_clarify',
            intent: 'CLARIFY',
            reason: 'negation without prior_mutation -> need_confirmation',
        };
    }
    // 1. Total query — selalu langsung ke tryTotal, skip MODIFY_CART gatekeeper
    if (hasKeyword(lowerMsg, TOTAL_KEYWORDS)) {
        return { kind: 'total', reason: 'total_keyword_match' };
    }
    // BAGIAN 1.2 — Payment priority: NEVER trigger order_change / cart_modify
    if (hasKeyword(lowerMsg, PAYMENT_KEYWORDS)) {
        return { kind: 'waterfall', reason: 'payment_keyword -> waterfall' };
    }
    // 2. Order status keywords
    if (hasKeyword(lowerMsg, ORDER_STATUS_KEYWORDS)) {
        if (activeOrder) {
            return { kind: 'order_status', reason: 'status_keyword + active_order' };
        }
        return { kind: 'order_status', reason: 'status_keyword, no active_order' };
    }
    // 3. Order change keywords + active order
    if (hasKeyword(lowerMsg, ORDER_CHANGE_KEYWORDS) && activeOrder) {
        return { kind: 'order_change', reason: 'change_keyword + active_order' };
    }
    // BAGIAN 1.3 — Remove keyword fast-path (no Groq needed for keyword detection)
    // Destructive guard: item name MUST be explicitly mentioned
    const REMOVE_KEYWORDS = ['ga jadi', 'gajadi', 'nggak jadi', 'enggak jadi', 'tidak jadi', 'hapus', 'coret', 'kurangi'];
    if (cart.length > 0 && hasKeyword(lowerMsg, REMOVE_KEYWORDS)) {
        const hasExplicitItem = cart.some(ci => {
            const name = ci.product.toLowerCase();
            const words = name.split(/\s+/).filter(w => w.length > 1);
            return lowerMsg.includes(name) || words.some(w => lowerMsg.includes(w));
        });
        if (!hasExplicitItem) {
            return { kind: 'cart_clarify', intent: 'CLARIFY', reason: 'remove_keyword but no explicit item name' };
        }
        // Groq to identify which item — single call via contextInterpreter
        const interpreted = await contextInterpreter(ctx);
        if (interpreted) {
            return interpreted;
        }
        // Fast-path: if Groq fails, manually identify from explicit mention (fuzzy word match)
        const removeMatch = cart.find(ci => {
            const prodLower = ci.product.toLowerCase();
            const words = prodLower.split(/\s+/).filter(w => w.length > 1);
            return lowerMsg.includes(prodLower) || words.some(w => lowerMsg.includes(w));
        });
        if (removeMatch) {
            return { kind: 'cart_modify', intent: 'remove', remove: [removeMatch.product], reason: 'remove_keyword + explicit_mention' };
        }
    }
    // BAGIAN 2 — Context Interpreter (single Groq call)
    // Hanya dipanggil ketika ada order aktif (untuk ORDER_CHANGE semantic)
    if (activeOrder) {
        const interpreted = await contextInterpreter(ctx);
        if (interpreted) {
            if (interpreted.kind === 'cart_modify' && interpreted.add && !interpreted.remove) {
                // Add-only modification -> let waterfall + buy signal handle it
            }
            else {
                return interpreted;
            }
        }
    }
    // 6. Waterfall
    return { kind: 'waterfall', reason: 'default' };
}
/**
 * BAGIAN 2 — Context Interpreter (single source of truth)
 * SATU panggilan Groq (maxTokens 120, temp 0.1, jsonMode) yang menerima:
 *   - 6 pesan terakhir
 *   - cart items
 *   - order aktif
 *   - daftar produk toko
 *   - pesan pelanggan
 * Output: { intent, cart_ops, confidence, correction }
 */
async function contextInterpreter(ctx) {
    const { lowerMsg, cart, activeOrder, customerCity, conversationId, storeId } = ctx;
    // Fetch last 6 messages from DB for context
    let lastMessages = [];
    let productList = [];
    try {
        const history = await prisma.conversationHistory.findMany({
            where: { conversationId },
            orderBy: { createdAt: 'desc' },
            take: 6,
            select: { content: true, role: true },
        });
        lastMessages = history.reverse().map(h => `${h.role === 'user' ? 'customer' : 'assistant'}: ${h.content}`);
    }
    catch {
        // non-critical — proceed with empty history
    }
    try {
        const products = await prisma.product.findMany({
            where: { storeId, deletedAt: null, isActive: true },
            select: { name: true, price: true },
            take: 50,
        });
        productList = products.map(p => `${p.name} (Rp ${p.price})`);
    }
    catch {
        // non-critical
    }
    const orderItems = activeOrder && Array.isArray(activeOrder.items)
        ? activeOrder.items.map((i) => i.product || i.productName || 'produk').join(', ')
        : '-';
    const cartItems = cart.map((c) => `${c.product} (qty: ${c.qty || 1}${c.price ? ', harga: ' + c.price : ''})`).join('; ') || 'kosong';
    const prompt = `Konteks percakapan (6 pesan terakhir):\n${lastMessages.join('\n') || '(belum ada pesan sebelumnya)'}\n\n` +
        `Keranjang: [${cartItems}]\n` +
        `Order aktif: status=${activeOrder?.orderStatus || 'tidak ada'}, isi=[${orderItems}]\n` +
        `Produk toko: [${productList.join(', ')}]\n` +
        `Pesan customer: "${lowerMsg}"\n\n` +
        `Output JSON ONLY: {"intent":"ORDER_CHANGE"|"CART_MODIFY"|"OTHER","cart_ops":{"add":[...],"remove":[...]},"confidence":0.0-1.0,"correction":"string atau null"}.`;
    try {
        const result = await groqAdapter.generate(prompt, {
            temperature: 0.1,
            maxTokens: 120,
            jsonMode: true,
            intent: 'order-extraction',
        });
        const parsed = JSON.parse(result.content);
        // BAGIAN 2.2 — confidence < 0.7 -> null (fall through to waterfall)
        const conf = parsed.confidence || 0;
        if (conf < 0.7) {
            return null;
        }
        if (parsed.intent === 'ORDER_CHANGE') {
            return {
                kind: 'order_change',
                intent: parsed.intent,
                add: parsed.cart_ops?.add,
                remove: parsed.cart_ops?.remove,
                confidence: conf,
                reason: 'groq_context_interpreter: ORDER_CHANGE',
            };
        }
        if (parsed.intent === 'CART_MODIFY') {
            const removeItems = parsed.cart_ops?.remove || [];
            // BAGIAN 2.3 — Code disposes: add wajib fuzzy-match produk; remove tunduk 1.3
            const addItems = (parsed.cart_ops?.add || []).filter(a => productList.some(p => p.toLowerCase().includes(a.toLowerCase().split(' ').pop() || '')));
            // Destructive guard: remove must be explicit (item name in message)
            const matchedRemove = removeItems.filter(r => {
                const inMsg = lowerMsg.includes(r.toLowerCase().split(' ').pop() || '');
                const inCart = cart.some(ci => ci.product.toLowerCase().includes(r.toLowerCase().split(' ').pop() || ''));
                return inMsg && inCart;
            });
            if (matchedRemove.length === 0 && removeItems.length > 0) {
                // Proposed remove but no explicit match → clarify
                return {
                    kind: 'cart_clarify',
                    intent: 'CLARIFY',
                    confidence: conf,
                    reason: 'remove proposed but destructive guard failed -> clarify',
                };
            }
            return {
                kind: 'cart_modify',
                intent: 'CART_MODIFY',
                add: addItems,
                remove: matchedRemove,
                confidence: conf,
                reason: 'groq_context_interpreter: CART_MODIFY',
            };
        }
        // OTHER → fall through
        return null;
    }
    catch (err) {
        adapters.logger.warn('Context interpreter Groq failed', {
            conversationId,
            error: err.message,
        });
        return null;
    }
}
//# sourceMappingURL=route-decider.js.map