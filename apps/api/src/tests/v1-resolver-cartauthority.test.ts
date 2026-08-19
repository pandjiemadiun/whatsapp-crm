/**
 * P9 — v1 Resolver EXECUTE/ROLLBACK via CartAuthority (end-to-end)
 *
 * Runner: tsx --env-file=../../.env --test --test-force-exit src/tests/v1-resolver-cartauthority.test.ts
 *
 * Verifies that the v1 pending-clarification resolver (BAGIAN 2) now mutates
 * the cart through CartAuthority (OrderItem rows), NOT legacy
 * modifyCart -> extractedEntities.confirmedItems.
 *
 *   - EXECUTE ("iya" / pilih opsi) harus menghasilkan OrderItem via CartAuthority
 *     dengan harga dari DB (bukan harga LLM).
 *   - ROLLBACK ("ga jadi") tetap no-op pada cart (snapshot v1 selalu null) —
 *     cart sebelumnya tidak berubah, perilaku identik dengan sebelum P9.
 *
 * Pending disemai secara manual (mirror ke canonical _compat) agar resolver
 * ter-trigger langsung — pengujian unit untuk BAGIAN 2 (generate clarification
 * adalah concern interpreter/Stage-4 terpisah).
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

const STORE_ID = 'store-v1-resolver-p9';

const PRODUCTS = [
  { id: 'prod-beras-p9', name: 'beras', price: 12000, stock: 50 },
  { id: 'prod-woltel-p9', name: 'woltel', price: 10000, stock: 50 },
  { id: 'prod-brambang-p9', name: 'brambang', price: 8000, stock: 50 },
] as const;

const originalGenerate = llmGateway.generate.bind(llmGateway);
const OrderProto = Object.getPrototypeOf(orderService);
const originalDetectDone = OrderProto.detectDoneOrdering;

const mockGenerate = async (_prompt: string, _options?: AIGenerateOptions): Promise<AIResponse> => ({
  content: '',
  provider: 'groq',
  model: 'test-model',
  tokens: { input: 10, output: 10 },
  cost: 0,
});

async function setupStore(): Promise<void> {
  await prisma.store.upsert({
    where: { id: STORE_ID },
    update: { name: 'P9 v1 Resolver Test Store' },
    create: { id: STORE_ID, name: 'P9 v1 Resolver Test Store' },
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
  (llmGateway as any).generate = mockGenerate;
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

  const r2 = await processMsg(CONV, 'cust-p9', 'iya');
  assert.equal(r2?.metadata?.reason, 'resolver_no_llm', 'resolver EXECUTE (0 LLM)');

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

  await processMsg(CONV, 'cust-p9', 'iya');

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

  const r2 = await processMsg(CONV, 'cust-p9', 'ga jadi');
  assert.equal(r2?.metadata?.reason, 'rollback', 'resolver ROLLBACK');

  const items = await getOrderItems(CONV);
  const brambang = items.find((i) => i.productName === 'brambang');
  const beras = items.find((i) => i.productName === 'beras');
  const woltel = items.find((i) => i.productName === 'woltel');

  assert.ok(brambang, 'brambang tetap ada (rollback tidak menghapus cart lama)');
  assert.equal(beras, undefined, 'beras TIDAK ditambah (rollback batal pilihan)');
  assert.equal(woltel, undefined, 'woltel TIDAK ditambah (rollback batal pilihan)');
});
