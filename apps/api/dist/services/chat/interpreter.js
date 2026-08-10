/**
 * Single-Shot Interpreter — BAGIAN 3
 * src/services/chat/interpreter.ts
 *
 * Hanya dipanggil jika normalizer + resolver + tier SEMUA miss (Stage 4).
 * SATU panggilan Groq. Config: temp 0.2, jsonMode, maxTokens 250.
 * I8: max 1 LLM call per message.
 *
 * Legacy buy-signal + context-interpreter logic absorbed into runOneCall —
 * buy_signal + intent + cart_ops in a single Groq call.
 */
import { groqAdapter } from '../../adapters/ai/groq.adapter.js';
import { adapters } from '../../adapters/container.js';
import { prisma } from '../../infrastructure/prisma.js';
/** 3 potongan transcript nyata founder — few-shot */
const FEW_SHOT = `--- Contoh 1 ---\ncustomer: "toralin brp ya?"\nassistant: "Total belanjaan Kakak: Rp 25.000 ya. Ada tambahan?"\ncustomer: "mau tambah ayam goreng"\nassistant: "Oke, ayam goreng sudah dimasukkan. Total baru: Rp 35.000."\n\n--- Contoh 2 ---\ncustomer: "brp ongkirr ke jakarta?"\nassistant: "Ongkir ke Jakarta: Rp 15.000 (standar) atau Rp 25.000 (express)."\ncustomer: "mau express"\n\n--- Contoh 3 ---\ncustomer: "mau beli wortel dan kentang, dua-duanya"\nassistant: "Baik Kak, wortel dan kentang sudah di keranjang. Mau tambah?"\ncustomer: "ya, keduanya"\n`;
const INTERPRETER_SCHEMA = `{
  "intent": "product_info|total|buy|smalltalk|clarify",
  "cart_ops": [{ "type": "add|remove", "product": string, "qty": number, "price": number }],
  "buy_signal": "yes|no|maybe",
  "order_extract": { "order_id": string } | null,
  "missing_info": string[] | null,
  "identity": { "name": string } | null,
  "reply_draft": string | null,
  "confidence": 0.0-1.0,
  "clarification": { "question": string, "options": [{ "id": string, "label": string, "cartOps": [{ "type":"add|remove", "product": string, "qty": number, "price": number }], "action": string }], "expected_type": "affirmative|choice|yes_no" } | null
}`;
/**
 * runOneCall — BAGIAN 3 (SATU LLM CALL).
 *
 * Absorbs: intent classification, buy_signal, cart ops, missing info,
 * identity extraction, clarification generation — ALL in ONE Groq call.
 *
 * @param normalizedText  pesan yang sudah dinormalisasi (Stage 2 output)
 * @param ctx             PipelineContext (storeId, cart, activeOrder, products, city, messages)
 * @returns InterpreterResult | null
 */
export async function runOneCall(normalizedText, ctx) {
    // Build conversation history
    const lastMessages = ctx.messages
        .slice(-6)
        .map((m) => `${m.sender === 'customer' ? 'customer' : 'assistant'}: ${m.content}`)
        .join('\n');
    const productCatalog = ctx.storeProducts
        .map((p) => `- ${p.name} (Rp ${p.price}, stok: ${p.stock ?? 0})`)
        .join('\n');
    const cartSummary = ctx.cart.length > 0
        ? ctx.cart
            .map((c) => `${c.product ?? c.name} (qty: ${c.qty || c.quantity || 1})`)
            .join('; ')
        : 'kosong';
    const orderInfo = ctx.activeOrder
        ? `status=${ctx.activeOrder.orderStatus}, items=${ctx.activeOrder.items
            .map((i) => i.product || i.productName)
            .join(', ')}`
        : 'tidak ada order aktif';
    const prompt = `[SYSTEM — Interpreter WhatsApp commerce QloBot.
Berikan HANYA JSON valid. Aturan kaku:
  1. JANGAN sertakan harga/stok di reply_draft — reply_draft hanya teks ucapan semata.
  2. reply_draft maks 2 kalimat.
  3. Jika produk yang disebutkan customer tidak ada di katalog, set intent='clarify', isi clarification.question, dan JANGAN menebak harga/stok.
Schema:\n${INTERPRETER_SCHEMA}\n]` +
        `\n\n${FEW_SHOT}` +
        `\n--- Riwayat 6 pesan terakhir ---\n${lastMessages || '(belum ada)'}` +
        `\n\n--- State ---\nKeranjang: [${cartSummary}]\nOrder aktif: ${orderInfo}\nProduk toko:\n${productCatalog}\nKota customer: ${ctx.customerCity || 'tidak diketahui'}\nNama customer: ${ctx.customerName || 'tidak diketahui'}` +
        `\n\n--- Pesan customer (sudah dinormalisasi) ---\n"${normalizedText}"\n\nBerikan JSON:`;
    const maxRetries = 1; // I8: max 1 retry (transport/parse only)
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const result = await groqAdapter.generate(prompt, {
                temperature: 0.2,
                maxTokens: 250,
                jsonMode: true,
                intent: 'conversation-interpreter',
                conversationId: ctx.conversationId,
            });
            const parsed = JSON.parse(result.content);
            // Validation
            if (!parsed.intent || typeof parsed.confidence !== 'number') {
                lastError = new Error(`Invalid schema: ${JSON.stringify(parsed).slice(0, 200)}`);
                continue;
            }
            adapters.logger.info('Interpreter runOneCall', {
                conversationId: ctx.conversationId,
                intent: parsed.intent,
                buy_signal: parsed.buy_signal,
                confidence: parsed.confidence,
                attempt,
                inputTokens: result.tokens.input,
                outputTokens: result.tokens.output,
            });
            return parsed;
        }
        catch (err) {
            lastError = err;
            const isRetryable = lastError.message.includes('429') ||
                lastError.message.includes('timeout') ||
                lastError.message.includes('JSON');
            if (!isRetryable) {
                adapters.logger.warn('Interpreter non-retryable error', {
                    conversationId: ctx.conversationId,
                    error: lastError.message,
                });
                return null;
            }
            continue;
        }
    }
    adapters.logger.error('Interpreter exhausted retries', {
        conversationId: ctx.conversationId,
        error: lastError?.message,
    });
    return null;
}
/**
 * Validasi cart_ops terhadap DB — hanya jalankan jika produk ada + qty valid.
 * Harga SELALU dari DB, bukan dari LLM.
 * I15: cart_ops dari LLM wajib divalidasi terhadap DB
 */
export async function validateCartOpsAgainstDb(cartOps, storeId) {
    const products = await prisma.product.findMany({
        where: { storeId, deletedAt: null, isActive: true },
        select: { name: true, price: true, stock: true },
    });
    const productMap = new Map();
    for (const p of products) {
        productMap.set(p.name.toLowerCase().trim(), { price: p.price, stock: p.stock });
    }
    const valid = [];
    const invalid = [];
    const missing = [];
    for (const op of cartOps) {
        const dbProduct = productMap.get(op.product.toLowerCase().trim());
        if (!dbProduct) {
            // Produk tidak ada di DB -> laporkan sebagai `missing` (biar reply
            // bisa tanya ketersediaan) dan JANGAN dieksekusi. Harga tetap dari DB.
            invalid.push(op);
            missing.push(op.product);
            continue;
        }
        if (typeof op.qty !== 'number' || op.qty < 1) {
            invalid.push({ ...op, qty: 1, price: dbProduct.price });
            continue;
        }
        valid.push({
            ...op,
            qty: Math.floor(op.qty),
            price: dbProduct.price,
        });
    }
    return { valid, invalid, missing };
}
export function validateCartOps(cartOps, storeProducts) {
    const known = new Set(storeProducts.map((p) => p.name.toLowerCase().trim()));
    const valid = [];
    const missing = [];
    for (const op of cartOps) {
        const ref = op.product.toLowerCase().trim();
        if (known.has(ref)) {
            valid.push(op);
        }
        else {
            missing.push(op.product);
        }
    }
    return { valid, missing };
}
/**
 * truncateTo2Sentences — memotong teks ke (paling banyak) 2 kalimat pertama.
 * Kalimat dipisahkan oleh [.!?] diikuti pemisah spasi (look-behind boundary).
 *
 * Pure & sync. Pipeline (FASE 4) pakai sebagai safety-net agar reply_draft
 * tak melebihi 2 kalimat, sekaligus memenuhi aturan system prompt.
 */
export function truncateTo2Sentences(text) {
    if (!text)
        return '';
    const sentences = text
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
    return sentences.slice(0, 2).join(' ');
}
//# sourceMappingURL=interpreter.js.map