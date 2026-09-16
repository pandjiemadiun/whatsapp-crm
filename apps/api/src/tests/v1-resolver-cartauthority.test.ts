/**
 * P9 — v2 Resolver EXECUTE/ROLLBACK via CartAuthority (end-to-end) — ACTIVE MODE
 *
 * Runner: tsx --env-file=../../.env --test --test-force-exit src/tests/v1-resolver-cartauthority.test.ts
 * (also part of `npm run test:golden`)
 *
 * Migrated from the obsolete v1-lama "resolver_no_llm / rollback" assertions to
 * the V2 active path (metadata.engine === 'v2-active' + outcome/derivedReason).
 * The LLM (llmGateway.generate) is stubbed with a schema-valid V2EngineOutput
 * (NOT empty content) — same pattern as wa-cancel-qty-shipping-v2-active-e2e.test.ts.
 *
 * IMPORTANT SCOPE NOTE (Part A): this suite stubs the LLM's RESOLVED output and
 * verifies CartAuthority DB sync (OrderItem rows + confirmedItems + price = DB).
 * It does NOT assert that a REAL LLM maps the pending "iya" reply to a product —
 * that is the Part B STOP finding: buildLLMContext for the seedPending "iya"
 * scenario emits only "Clarification aktif: Mau yang mana Kak?" (question, NO
 * option->product mapping, NO prices) + empty history, so a real LLM cannot
 * resolve "iya"->beras from this prompt. Part B is intentionally NOT shipped.
 *
 *   - EXECUTE ("iya" / pilih opsi): stub emits ADD_TO_CART beras(1) + woltel(2)
 *     -> OrderItem via CartAuthority, harga dari DB (12000 / 10000), tidak dari
 *     LLM (payload sengaja tak bawa price -> I13 invariant terpenuhi).
 *   - ROLLBACK ("ga jadi"): stub emits NO proposed_actions (no-op) -> keranjang
 *     lama (brambang) tidak berubah, beras/woltel TIDAK ditambah.
 *
 * Pending disemai secara manual (mirror ke canonical _compat) agar
 * buildLLMContext menset "Clarification aktif" — pengujian unit untuk BAGIAN 2
 * (generate clarification adalah concern interpreter/Stage-4 terpisah).
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../infrastructure/prisma.js';
import { conversationService } from '../business/conversation.service.js';
import { conversationContextService } from '../business/conversation-context.service.js';
import { cartAuthority } from '../business/cart-authority.js';
import { orderService } from '../business/order.service.js';
import { llmGateway } from '../adapters/ai/llm-gateway.js';
import type { AIResponse, AIGenerateOptions } from '../adapters/ai/types.js';
import type { ResponseResult } from '../domain/types.js';
import type { V2EngineOutput } from '../services/chat/v2-engine/schema.js';

const STORE_ID = 'store-v1-resolver-p9';

const PRODUCTS = [
  { id: 'prod-beras-p9', name: 'beras', price: 12000, stock: 50 },
  { id: 'prod-woltel-p9', name: 'woltel', price: 10000, stock: 50 },
  { id: 'prod-brambang-p9', name: 'brambang', price: 8000, stock: 50 },
] as const;

const originalGenerate = llmGateway.generate.bind(llmGateway);
const OrderProto = Object.getPrototypeOf(orderService);
const originalDetectDone = OrderProto.detectDoneOrdering;

/**
 * v2out() — minimal duplicate of the helper in
 * wa-cancel-qty-shipping-v2-active-e2e.test.ts:48. It is NOT exported there, so
 * it is duplicated locally here (intentionally minimal, kept in sync by eye).
 * Schema-valid V2EngineOutput per v2-engine/schema.ts.
 */
function v2out(intent: string, actions: any[], reply: string): V2EngineOutput {
  return {
    schema_version: 'v1',
    intent: intent as any,
    confidence: 0.9,
    entities: [],
    proposed_actions: actions,
    reply_text: reply,
    needs_clarification: false,
    uncertainty_signals: [],
  };
}

/** Swap llmGateway.generate to return a canned V2EngineOutput (JSON-stringified). */
function mockLLM(output: V2EngineOutput): void {
  (llmGateway as any).generate = async (_prompt: string, _opts?: AIGenerateOptions): Promise<AIResponse> => ({
    content: JSON.stringify(output),
    provider: 'groq',
    model: 'test-model-v2',
    tokens: { input: 1, output: 1 },
    cost: 0,
  });
}

// EXECUTE ("iya"): stub resolves confirmation -> ADD_TO_CART beras(1) + woltel(2).
// NOTE: payload omits `price` — CartAuthority resolves prices from DB (I13 invariant).
const EXEC_OUTPUT = v2out(
  'add_to_cart',
  [
    { action_type: 'ADD_TO_CART', payload: { product: 'beras', qty: 1 }, confidence: 0.95, requires_validation: true },
    { action_type: 'ADD_TO_CART', payload: { product: 'woltel', qty: 2 }, confidence: 0.95, requires_validation: true },
  ],
  'iya, Kak — beras (1) dan woltel (2) ditambahkan ke keranjang.',
);

// ROLLBACK ("ga jadi"): stub emits NO proposed_actions -> active branch no-op.
const ROLLBACK_OUTPUT = v2out(
  'modify_cart',
  [],
  'Baik, tidak jadi beli ya. Apa ada yang lain Kak?',
);

async function setupStore(): Promise<void> {
  await prisma.store.upsert({
    where: { id: STORE_ID },
    update: { name: 'P9 v1 Resolver Test Store' },
    create: {
      id: STORE_ID,
      name: 'P9 v1 Resolver Test Store',
      phoneNumber: '+6281200000097',
      address: 'Jl. P9 No. 1',
      originProvinceId: 'prov-p9-1',
      originProvinceName: 'Jawa Barat',
      originCityId: 'city-p9-1',
      originCityName: 'Bandung',
      originSubdistrictId: 'sub-p9-1',
      originSubdistrictName: 'Coblong',
    },
  });
  for (const p of PRODUCTS) {
    await prisma.product.upsert({
      where: { id: p.id },
      update: { name: p.name, price: p.price, stock: p.stock, isActive: true, deletedAt: null },
      create: {
        id: p.id,
        storeId: STORE_ID,
        name: p.name,
        price: p.price,
        stock: p.stock,
        isActive: true,
        currency: 'IDR',
      },
    });
  }
}

async function cleanup(): Promise<void> {
  await prisma.conversationHistory.deleteMany({ where: { conversation: { storeId: STORE_ID } } }).catch(() => {});
  await prisma.conversationContext.deleteMany({ where: { conversation: { storeId: STORE_ID } } }).catch(() => {});
  await prisma.orderItem.deleteMany({ where: { order: { storeId: STORE_ID } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
  await prisma.conversation.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
}

async function createConv(convId: string, customerId: string): Promise<void> {
  await prisma.conversation.create({
    data: { id: convId, storeId: STORE_ID, customerId, customerPhone: customerId, channel: 'whatsapp', status: 'open' },
  });
  await conversationContextService.initializeContext({ storeId: STORE_ID, customerId, conversationId: convId });
}

async function seedPending(convId: string): Promise<void> {
  await conversationContextService.setPendingClarification(convId, {
    question: 'Mau yang mana Kak?',
    expected_type: 'choice',
    options: [
      { id: '1', label: 'beras', cartOps: [{ type: 'add', product: 'beras', qty: 1, price: 99999 }] },
      { id: '2', label: 'woltel', cartOps: [{ type: 'add', product: 'woltel', qty: 2, price: 99999 }] },
    ],
  });
}

async function processMsg(convId: string, customerId: string, message: string): Promise<ResponseResult | null> {
  return conversationService.processCustomerMessage(STORE_ID, customerId, convId, message);
}

async function getOrderItems(convId: string): Promise<{ productName: string; quantity: number; unitPrice: number }[]> {
  const order = await prisma.order.findFirst({
    where: { conversationId: convId, orderStatus: 'draft', deletedAt: null },
  });
  if (!order) return [];
  const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
  return items.map((i: any) => ({ productName: i.productName, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice) }));
}

before(async () => {
  // llmGateway.generate is stubbed per-test via mockLLM() (replaces old global mockGenerate).
  OrderProto.detectDoneOrdering = () => false;
  await cleanup();
  await setupStore();
});

after(async () => {
  (llmGateway as any).generate = originalGenerate;
  OrderProto.detectDoneOrdering = originalDetectDone;
  await cleanup();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.conversationHistory.deleteMany({ where: { conversation: { storeId: STORE_ID } } }).catch(() => {});
  await prisma.conversationContext.deleteMany({ where: { conversation: { storeId: STORE_ID } } }).catch(() => {});
  await prisma.orderItem.deleteMany({ where: { order: { storeId: STORE_ID } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
  await prisma.conversation.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
});

const CONV = 'conv-p9';

test('P9 EXECUTE: klarifikasi → "iya" → OrderItem via CartAuthority (harga DB)', async () => {
  await createConv(CONV, 'cust-p9');
  await seedPending(CONV);
  mockLLM(EXEC_OUTPUT);

  const r2 = await processMsg(CONV, 'cust-p9', 'iya');
  // Migrated assertions (replace v1-lama reason==='resolver_no_llm').
  assert.equal(r2?.metadata?.engine, 'v2-active', 'harus lewat v2 active engine');
  assert.equal(r2?.metadata?.reason, 'modify_cart', 'derivedReason untuk ADD_TO_CART');
  assert.equal(r2?.metadata?.outcome, 'structured', 'outcome untuk ADD_TO_CART');
  assert.equal(r2?.metadata?.intent, 'add_to_cart');

  const items = await getOrderItems(CONV);
  const beras = items.find((i) => i.productName === 'beras');
  const woltel = items.find((i) => i.productName === 'woltel');

  assert.ok(beras, 'beras harus ada di OrderItem');
  assert.ok(woltel, 'woltel harus ada di OrderItem');
  assert.equal(beras!.quantity, 1);
  assert.equal(beras!.unitPrice, 12000, 'harga dari DB (bukan 99999 LLM)');
  assert.equal(woltel!.quantity, 2);
  assert.equal(woltel!.unitPrice, 10000, 'harga dari DB (bukan 99999 LLM)');
});

test('P9 EXECUTE: cart readback juga sinkron ke extractedEntities.confirmedItems', async () => {
  await createConv(CONV, 'cust-p9');
  await seedPending(CONV);
  mockLLM(EXEC_OUTPUT);

  const r2 = await processMsg(CONV, 'cust-p9', 'iya');
  assert.equal(r2?.metadata?.engine, 'v2-active', 'harus lewat v2 active engine');

  const ctx = await prisma.conversationContext.findUnique({ where: { conversationId: CONV } });
  const confirmed = (ctx as any)?.extractedEntities?.confirmedItems ?? [];
  const beras = confirmed.find((i: any) => i.product === 'beras');
  assert.ok(beras, 'beras harus ada di confirmedItems (synced oleh CartAuthority)');
  assert.equal(beras.price, 12000, 'confirmedItems harga dari DB');
});

test('P9 ROLLBACK: "ga jadi" → cart tidak berubah (no-op identik, snapshot v1 null)', async () => {
  await createConv(CONV, 'cust-p9');

  // cart awal via CartAuthority (brambang)
  await cartAuthority.executeOps(
    [{ type: 'add', product: 'brambang', qty: 1, price: 8000 }],
    STORE_ID,
    'cust-p9',
    CONV,
  );

  await seedPending(CONV);
  mockLLM(ROLLBACK_OUTPUT);

  const r2 = await processMsg(CONV, 'cust-p9', 'ga jadi');
  // Migrated assertion (replace v1-lama reason==='rollback' — a legacy-branch-only
  // string; active mode reports outcome=structured for the no-op).
  assert.equal(r2?.metadata?.engine, 'v2-active', 'harus lewat v2 active engine');
  assert.equal(r2?.metadata?.outcome, 'structured', 'ga jadi no-op -> outcome structured');
  assert.equal(r2?.metadata?.intent, 'modify_cart');

  const items = await getOrderItems(CONV);
  const brambang = items.find((i) => i.productName === 'brambang');
  const beras = items.find((i) => i.productName === 'beras');
  const woltel = items.find((i) => i.productName === 'woltel');

  assert.ok(brambang, 'brambang tetap ada (rollback tidak menghapus cart lama)');
  assert.equal(beras, undefined, 'beras TIDAK ditambah (rollback batal pilihan)');
  assert.equal(woltel, undefined, 'woltel TIDAK ditambah (rollback batal pilihan)');
});
