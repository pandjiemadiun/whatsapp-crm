/**
 * Single-Shot Interpreter — BAGIAN 3
 * src/services/chat/interpreter.ts
 *
 * Hanya dipanggil jika normalizer + resolver + tier SEMUA miss.
 * SATU panggilan Groq/Gemini. Config: temp 0.2, jsonMode, maxTokens 250.
 * I8: max 1 LLM call per message + 1 retry transport/parse only.
 */
import { groqAdapter } from '../../adapters/ai/groq.adapter.js';
import { adapters } from '../../adapters/container.js';
import { getAiDefaults } from '../../adapters/ai/ai-config.js';
import { prisma } from '../../infrastructure/prisma.js';
import type { InterpreterResult, ClarificationOption } from '../../domain/types.js';

/** 3 potongan transcript nyata founder — few-shot */
const FEW_SHOT = `--- Contoh 1 ---\ncustomer: "toralin brp ya?"\nassistant: "Total belanjaan Kakak: Rp 25.000 ya. Ada tambahan?"\ncustomer: "mau tambah ayam goreng"\nassistant: "Oke, ayam goreng sudah dimasukkan. Total baru: Rp 35.000."\n\n--- Contoh 2 ---\ncustomer: "brp ongkirr ke jakarta?"\nassistant: "Ongkir ke Jakarta: Rp 15.000 (standar) atau Rp 25.000 (express)."\ncustomer: "mau express"\n\n--- Contoh 3 ---\ncustomer: "mau beli wortel dan kentang, dua-duanya"\nassistant: "Baik Kak, wortel dan kentang sudah di keranjang. Mau tambah?"\ncustomer: "ya, keduanya"\n`;

const INTERPRETER_SCHEMA = `{
  intent: "ADD_TO_CART"|"REMOVE_FROM_CART"|"CHECK_TOTAL"|"CHECK_SHIPPING"|"CHECK_ORDER_STATUS"|"COMPLEX_CONVERSATION",
  cart_ops: [{ type: "add"|"remove", product: string, qty?: number, price?: number }],
  buy_signal: boolean,
  order_extract: { items?: [{ product: string, qty?: number, price?: number }] } | null,
  missing_info: string[] | null,
  identity: { name: string|null, address: string|null } | null,
  reply_draft: string | null,
  confidence: 0.0-1.0,
  clarification: { question: string, options: [{ id: string, label: string, cartOps?: [{ type, product, qty?, price? }], action?: string }], expected_type: "affirmative"|"choice"|"yes_no" } | null
}`;

/**
 * callSingleInterpreter — BAGIAN 3.
 *
 * @param normalizedText  pesan yang sudah dinormalisasi
 * @param context          conversation context (storeId, customerId, conversationId, messages)
 * @param dbSnapshot       { cart, activeOrder, customerCity, products }
 */
export async function callSingleInterpreter(
  normalizedText: string,
  context: {
    storeId: string;
    customerId: string;
    conversationId: string;
    messages: any[];
  },
  dbSnapshot: {
    cart: Array<{ product: string; qty?: number; price?: number }>;
    activeOrder: { orderStatus: string; items: any[] } | null;
    customerCity: string | null;
    products: Array<{ name: string; price: number; stock: number | null }>;
  }
): Promise<InterpreterResult | null> {
  // Build conversation history
  const lastMessages = context.messages
    .slice(-6)
    .map((m) => `${m.sender === 'customer' ? 'customer' : 'assistant'}: ${m.content}`)
    .join('\n');

  const productCatalog = dbSnapshot.products
    .map((p) => `- ${p.name} (Rp ${p.price}, stok: ${p.stock ?? 0})`)
    .join('\n');

  const cartSummary = dbSnapshot.cart.length > 0
    ? dbSnapshot.cart.map((c) => `${c.product} (qty: ${c.qty || 1})`).join('; ')
    : 'kosong';

  const orderInfo = dbSnapshot.activeOrder
    ? `status=${dbSnapshot.activeOrder.orderStatus}, items=${dbSnapshot.activeOrder.items
        .map((i: any) => i.product || i.productName)
        .join(', ')}`
    : 'tidak ada order aktif';

  const prompt = `[Instruksi: Anda adalah interpreter WhatsApp commerce. Output JSON ONLY. Schema:\n${INTERPRETER_SCHEMA}\n]` +
    `\n\n${FEW_SHOT}` +
    `\n--- Riwayat 6 pesan terakhir ---\n${lastMessages || '(belum ada)'}` +
    `\n\n--- State ---\nKeranjang: [${cartSummary}]\nOrder aktif: ${orderInfo}\nProduk toko:\n${productCatalog}\nKota customer: ${dbSnapshot.customerCity || 'tidak diketahui'}` +
    `\n\n--- Pesan customer (sudah dinormalisasi) ---\n"${normalizedText}"\n\nBerikan JSON:`;

  const defaults = await getAiDefaults();
  const maxRetries = 1; // I8: max 1 retry (transport/parse only)
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await groqAdapter.generate(prompt, {
        temperature: 0.2,
        maxTokens: 250,
        jsonMode: true,
        intent: 'conversation-interpreter',
        conversationId: context.conversationId,
      });

      const parsed: Partial<InterpreterResult> = JSON.parse(result.content);

      // Validation — schema ketat
      if (!parsed.intent || typeof parsed.confidence !== 'number') {
        lastError = new Error(`Invalid schema: ${JSON.stringify(parsed).slice(0, 200)}`);
        continue; // retry
      }

      // I8: log ke token-tracker
      adapters.logger.info('Interpreter single call', {
        conversationId: context.conversationId,
        intent: parsed.intent,
        confidence: parsed.confidence,
        attempt,
        inputTokens: result.tokens.input,
        outputTokens: result.tokens.output,
      });

      return parsed as InterpreterResult;
    } catch (err) {
      lastError = err as Error;
      // Jika bukan 429/timeout/parse error → jangan retry
      const isRetryable =
        lastError.message.includes('429') ||
        lastError.message.includes('timeout') ||
        lastError.message.includes('JSON');
      if (!isRetryable) {
        adapters.logger.warn('Interpreter non-retryable error', {
          conversationId: context.conversationId,
          error: lastError.message,
        });
        return null;
      }
      continue; // retry
    }
  }

  adapters.logger.error('Interpreter exhausted retries', {
    conversationId: context.conversationId,
    error: lastError?.message,
  });
  return null;
}

/**
 * Validasi cart_ops terhadap DB — hanya jalankan jika produk ada + qty valid.
 * Harga SELALU dari DB, bukan dari LLM.
 * I15: cart_ops dari LLM wajib divalidasi terhadap DB
 */
export async function validateCartOpsAgainstDb(
  cartOps: any[],
  storeId: string
): Promise<{ valid: any[]; invalid: any[] }> {
  const products = await prisma.product.findMany({
    where: { storeId, deletedAt: null, isActive: true },
    select: { name: true, price: true, stock: true },
  });

  const productMap = new Map<string, { price: number; stock: number | null }>();
  for (const p of products) {
    productMap.set(p.name.toLowerCase().trim(), { price: p.price, stock: p.stock });
  }

  const valid: any[] = [];
  const invalid: any[] = [];

  for (const op of cartOps) {
    const dbProduct = productMap.get(op.product.toLowerCase().trim());
    if (!dbProduct) {
      invalid.push(op);
      continue;
    }
    // Validasi qty
    if (typeof op.qty !== 'number' || op.qty < 1) {
      invalid.push({ ...op, qty: 1, price: dbProduct.price }); // default qty=1
      continue;
    }
    // Gunakan harga dari DB, bukan dari LLM
    valid.push({
      ...op,
      qty: Math.floor(op.qty),
      price: dbProduct.price, // override LLM price
    });
  }

  return { valid, invalid };
}
