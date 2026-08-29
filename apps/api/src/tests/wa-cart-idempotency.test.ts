/**
 * P7 — WA cart mutation idempotency contract (Gap 2, §8).
 *
 * Proves that redelivering the SAME WA messageId (after the 300s Redis dedup TTL
 * has elapsed / been bypassed — i.e. reaching the executor directly) does NOT
 * double-apply the cart mutation, because executeWaCartMutation reuses the
 * existing claimAction / executeClaimedAction (FOR UPDATE + re-check) machinery
 * keyed on actionId = `wa:${conversationId}:${messageId}`.
 *
 * Two layers are covered:
 *   1. Adapter-level (direct): the convergence point used by BOTH v1 and v2 call
 *      sites. ops shaped like a v1 LLM result (single add) vs a v2 plannedActs
 *      batch (multi-op) — both must be idempotent at the MESSAGE level.
 *   2. Engine-level wiring (v1 resolver): processCustomerMessage now threads
 *      messageId into the adapter, creating a WA_CART_MUTATION claim row; a
 *      redeliver of the same messageId is blocked by the claim (no double apply).
 *
 * Runner:
 *   npx tsx --env-file=../../.env --test --test-force-exit src/tests/wa-cart-idempotency.test.ts
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../infrastructure/prisma.js';
import { executeWaCartMutation } from '../business/action-registry.js';
import { conversationService } from '../business/conversation.service.js';
import { conversationContextService } from '../business/conversation-context.service.js';
import { llmGateway } from '../adapters/ai/llm-gateway.js';

const STORE_ID = 'store-wa-idem-p7';
const PREFIX = STORE_ID;

const PRODUCTS = [
  { id: 'prod-wa-ayam', name: 'ayam', price: 10000, stock: 100 },
  { id: 'prod-wa-telur', name: 'telur', price: 5000, stock: 100 },
] as const;

const originalGenerate = llmGateway.generate.bind(llmGateway);
const mockGenerate = async (_prompt: string, _opts?: any) => ({
  content: '',
  provider: 'groq',
  model: 'test-model',
  tokens: { input: 1, output: 1 },
  cost: 0,
});

let customerId: string;
let conversationId: string;

async function cleanup(): Promise<void> {
  await prisma.actionIdempotency.deleteMany({ where: { storeId: { startsWith: PREFIX } } }).catch(() => {});
  await prisma.conversationHistory.deleteMany({ where: { conversation: { storeId: { startsWith: PREFIX } } } }).catch(() => {});
  await prisma.conversationContext.deleteMany({ where: { conversation: { storeId: { startsWith: PREFIX } } } }).catch(() => {});
  await prisma.orderItem.deleteMany({ where: { order: { storeId: { startsWith: PREFIX } } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { storeId: { startsWith: PREFIX } } }).catch(() => {});
  await prisma.product.deleteMany({ where: { storeId: { startsWith: PREFIX } } }).catch(() => {});
  await prisma.conversation.deleteMany({ where: { storeId: { startsWith: PREFIX } } }).catch(() => {});
  await prisma.customer.deleteMany({ where: { storeId: { startsWith: PREFIX } } }).catch(() => {});
  await prisma.store.deleteMany({ where: { id: { startsWith: PREFIX } } }).catch(() => {});
}

async function setupStore(): Promise<void> {
  await prisma.store.upsert({
    where: { id: STORE_ID },
    update: {},
    create: {
      id: STORE_ID,
      name: 'P7 WA Idempotency Store',
      slug: STORE_ID,
      email: 'wa-idem@garuda.test',
      phoneNumber: '+6281200000096',
      address: 'Jl. WA Idem No. 1',
      originProvinceId: 'prov-wa-1',
      originProvinceName: 'Jawa Barat',
      originCityId: 'city-wa-1',
      originCityName: 'Bandung',
      originSubdistrictId: 'sub-wa-1',
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
  customerId = `cust-wa-${randomUUID()}`;
  await prisma.customer.create({
    data: { id: customerId, storeId: STORE_ID, webUid: `${PREFIX}-webuid`, name: 'P7 WA Customer' },
  });
}

// Fresh conversation + context per test (mirrors P9 harness) so the v1 resolver
// pending state is always clean and correctly mirrored to canonical.
async function createConv(): Promise<void> {
  conversationId = `conv-wa-${randomUUID()}`;
  await prisma.conversation.create({
    data: { id: conversationId, storeId: STORE_ID, customerId, customerPhone: customerId, channel: 'whatsapp' },
  });
  await conversationContextService.initializeContext({ storeId: STORE_ID, customerId, conversationId });
}

async function getOrderItems(): Promise<{ productName: string; quantity: number }[]> {
  const order = await prisma.order.findFirst({
    where: { conversationId, orderStatus: 'draft', deletedAt: null },
  });
  if (!order) return [];
  const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
  return items.map((i: any) => ({ productName: i.productName, quantity: Number(i.quantity) }));
}

async function countClaims(actionId: string): Promise<number> {
  return prisma.actionIdempotency.count({
    where: { storeId: STORE_ID, actionType: 'WA_CART_MUTATION', actionId },
  });
}

const V1_OPS = (): any => [{ type: 'add', product: 'ayam', qty: 2, price: 10000 }];
const V2_OPS = (): any => [
  { type: 'add', product: 'ayam', qty: 1, price: 10000 },
  { type: 'add', product: 'telur', qty: 3, price: 5000 },
];

before(async () => {
  (llmGateway as any).generate = mockGenerate;
  await cleanup();
  await setupStore();
});

after(async () => {
  (llmGateway as any).generate = originalGenerate;
  await cleanup();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.actionIdempotency.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
  await prisma.conversationHistory.deleteMany({ where: { conversation: { storeId: STORE_ID } } }).catch(() => {});
  await prisma.conversationContext.deleteMany({ where: { conversation: { storeId: STORE_ID } } }).catch(() => {});
  await prisma.orderItem.deleteMany({ where: { order: { storeId: STORE_ID } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
  await createConv();
});

describe('P7 — WA cart idempotency (Gap 2): adapter level', () => {
  test('v1 (single-op LLM result): redeliver SAME messageId → 1 OrderItem (not 2)', async () => {
    const msgId = 'MSG-V1-SAME-1';
    await executeWaCartMutation(V1_OPS(), STORE_ID, customerId, conversationId, msgId);
    // Simulate Redis-dedup-expired / bypassed redeliver — executor sees same messageId again.
    await executeWaCartMutation(V1_OPS(), STORE_ID, customerId, conversationId, msgId);

    const items = await getOrderItems();
    const ayam = items.find((i) => i.productName === 'ayam');
    assert.ok(ayam, 'ayam must be present');
    assert.equal(ayam!.quantity, 2, 'redeliver must NOT double quantity (expected 2, got ' + ayam!.quantity + ')');
    assert.equal(items.length, 1, 'exactly one OrderItem expected, got ' + items.length);

    // Exactly one COMPLETED claim row for this message-level actionId.
    assert.equal(await countClaims(`wa:${conversationId}:${msgId}`), 1);
  });

  test('v1 (single-op LLM result): DIFFERENT messageId, same content → 2 OrderItems (not over-deduplicated)', async () => {
    await executeWaCartMutation(V1_OPS(), STORE_ID, customerId, conversationId, 'MSG-V1-A');
    await executeWaCartMutation(V1_OPS(), STORE_ID, customerId, conversationId, 'MSG-V1-B');

    const items = await getOrderItems();
    const ayam = items.find((i) => i.productName === 'ayam');
    assert.ok(ayam, 'ayam must be present');
    assert.equal(ayam!.quantity, 4, 'two distinct messages must add (expected 4, got ' + ayam!.quantity + ')');
    assert.equal(items.length, 1, 'still one product row, but quantity reflects 2 adds');

    assert.equal(await countClaims(`wa:${conversationId}:MSG-V1-A`), 1);
    assert.equal(await countClaims(`wa:${conversationId}:MSG-V1-B`), 1);
  });

  test('v2 (plannedActs batch): redeliver SAME messageId → 1 batch, quantities not doubled', async () => {
    const msgId = 'MSG-V2-SAME-1';
    await executeWaCartMutation(V2_OPS(), STORE_ID, customerId, conversationId, msgId);
    await executeWaCartMutation(V2_OPS(), STORE_ID, customerId, conversationId, msgId);

    const items = await getOrderItems();
    const ayam = items.find((i) => i.productName === 'ayam');
    const telur = items.find((i) => i.productName === 'telur');
    assert.ok(ayam, 'ayam must be present');
    assert.ok(telur, 'telur must be present');
    assert.equal(ayam!.quantity, 1, 'redeliver must NOT double ayam (expected 1, got ' + ayam!.quantity + ')');
    assert.equal(telur!.quantity, 3, 'redeliver must NOT double telur (expected 3, got ' + telur!.quantity + ')');
    assert.equal(items.length, 2, 'exactly two OrderItems expected, got ' + items.length);

    assert.equal(await countClaims(`wa:${conversationId}:${msgId}`), 1);
  });

  test('v2 (plannedActs batch): DIFFERENT messageId → 2 batches applied', async () => {
    await executeWaCartMutation(V2_OPS(), STORE_ID, customerId, conversationId, 'MSG-V2-A');
    await executeWaCartMutation(V2_OPS(), STORE_ID, customerId, conversationId, 'MSG-V2-B');

    const items = await getOrderItems();
    const ayam = items.find((i) => i.productName === 'ayam');
    const telur = items.find((i) => i.productName === 'telur');
    assert.ok(ayam && telur);
    assert.equal(ayam!.quantity, 2, 'two distinct batches must add ayam (expected 2, got ' + ayam!.quantity + ')');
    assert.equal(telur!.quantity, 6, 'two distinct batches must add telur (expected 6, got ' + telur!.quantity + ')');
    assert.equal(items.length, 2, 'two product rows expected, got ' + items.length);
  });
});

describe('P7 — WA cart idempotency: engine wiring (v1 resolver)', () => {
  test('v1 resolver EXECUTE threads messageId → WA_CART_MUTATION claim row (correct actionId)', async () => {
    await conversationContextService.setPendingClarification(conversationId, {
      question: 'Mau yang mana Kak?',
      expected_type: 'choice',
      options: [{ id: '1', label: 'ayam', cartOps: [{ type: 'add', product: 'ayam', qty: 1, price: 99999 }] }],
    });

    await conversationService.processCustomerMessage(STORE_ID, customerId, conversationId, 'iya', 'whatsapp', 'MSG-ENG-1');

    const items = await getOrderItems();
    const ayam = items.find((i) => i.productName === 'ayam');
    assert.ok(ayam, 'ayam must be added via resolver');
    assert.equal(ayam!.quantity, 1);

    // Engine fed messageId into the adapter → exactly one claim for this message.
    const claim = await prisma.actionIdempotency.findFirst({
      where: { storeId: STORE_ID, actionType: 'WA_CART_MUTATION', actionId: `wa:${conversationId}:MSG-ENG-1` },
    });
    assert.ok(claim, 'WA_CART_MUTATION claim row must exist with actionId derived from messageId');
    assert.equal(claim!.status, 'COMPLETED');
  });

  test('v1 resolver: redeliver SAME messageId → no double mutation (already_applied)', async () => {
    // First delivery.
    await conversationContextService.setPendingClarification(conversationId, {
      question: 'Mau yang mana Kak?',
      expected_type: 'choice',
      options: [{ id: '1', label: 'ayam', cartOps: [{ type: 'add', product: 'ayam', qty: 1, price: 99999 }] }],
    });
    await conversationService.processCustomerMessage(STORE_ID, customerId, conversationId, 'iya', 'whatsapp', 'MSG-ENG-SAME');

    // Re-present the same pending (as a redelivered confirmation would) and redeliver
    // the SAME messageId — executor reaches executeWaCartMutation again, claim blocks it.
    await conversationContextService.setPendingClarification(conversationId, {
      question: 'Mau yang mana Kak?',
      expected_type: 'choice',
      options: [{ id: '1', label: 'ayam', cartOps: [{ type: 'add', product: 'ayam', qty: 1, price: 99999 }] }],
    });
    await conversationService.processCustomerMessage(STORE_ID, customerId, conversationId, 'iya', 'whatsapp', 'MSG-ENG-SAME');

    const items = await getOrderItems();
    const ayam = items.find((i) => i.productName === 'ayam');
    assert.ok(ayam, 'ayam must be present');
    assert.equal(ayam!.quantity, 1, 'redeliver of same messageId must NOT double-apply (expected 1, got ' + ayam!.quantity + ')');
    assert.equal(items.length, 1, 'exactly one OrderItem expected, got ' + items.length);
    assert.equal(await countClaims(`wa:${conversationId}:MSG-ENG-SAME`), 1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PV-P2: VARIANT_REQUIRED via WA path (executeWaCartMutation)
// ════════════════════════════════════════════════════════════════════════════

describe('PV-P2: VARIANT_REQUIRED via WA path (executeWaCartMutation)', () => {
  const WA_STORE = 'store-wa-variant-p2';
  const WA_PREFIX = WA_STORE;
  let waCustomerId: string;
  let waConvId: string;
  let variantProdId: string;
  let validVariantId: string;
  let noVariantProdId: string;

  async function waCleanup(): Promise<void> {
    await prisma.actionIdempotency.deleteMany({ where: { storeId: { startsWith: WA_PREFIX } } }).catch(() => {});
    await prisma.orderItem.deleteMany({ where: { order: { storeId: { startsWith: WA_PREFIX } } } }).catch(() => {});
    await prisma.order.deleteMany({ where: { storeId: { startsWith: WA_PREFIX } } }).catch(() => {});
    await prisma.productVariant.deleteMany({ where: { storeId: { startsWith: WA_PREFIX } } }).catch(() => {});
    await prisma.product.deleteMany({ where: { storeId: { startsWith: WA_PREFIX } } }).catch(() => {});
    await prisma.conversationContext.deleteMany({ where: { conversation: { storeId: { startsWith: WA_PREFIX } } } }).catch(() => {});
    await prisma.conversation.deleteMany({ where: { storeId: { startsWith: WA_PREFIX } } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { storeId: { startsWith: WA_PREFIX } } }).catch(() => {});
    await prisma.store.deleteMany({ where: { id: { startsWith: WA_PREFIX } } }).catch(() => {});
  }

  async function waSetupStore(): Promise<void> {
    await prisma.store.upsert({
      where: { id: WA_STORE },
      update: {},
      create: {
        id: WA_STORE,
        name: 'P2 WA Variant Store',
        slug: WA_STORE,
        email: 'wa-variant-p2@garuda.test',
        phoneNumber: '+6281200000097',
        address: 'Jl. WA Variant No. 1',
        originProvinceId: 'prov-wa-2',
        originProvinceName: 'Jawa Barat',
        originCityId: 'city-wa-2',
        originCityName: 'Bandung',
        originSubdistrictId: 'sub-wa-2',
        originSubdistrictName: 'Coblong',
      },
    });

    // Product WITH variants
    const vp = await prisma.product.create({
      data: {
        id: 'prod-wa-sosis',
        storeId: WA_STORE,
        name: 'Sosis',
        price: 30000,
        currency: 'IDR',
        isActive: true,
        hasVariants: true,
      },
    });
    variantProdId = vp.id;

    const variant = await prisma.productVariant.create({
      data: {
        productId: variantProdId,
        storeId: WA_STORE,
        price: 35000,
        stock: 50,
        sku: 'SOSIS-500G',
        attributes: { weight: '500g' },
        isActive: true,
      },
    });
    validVariantId = variant.id;

    // Product WITHOUT variants
    const nvp = await prisma.product.create({
      data: {
        id: 'prod-wa-beras',
        storeId: WA_STORE,
        name: 'Beras',
        price: 75000,
        currency: 'IDR',
        isActive: true,
        hasVariants: false,
      },
    });
    noVariantProdId = nvp.id;

    waCustomerId = `cust-wa-${randomUUID()}`;
    await prisma.customer.create({
      data: { id: waCustomerId, storeId: WA_STORE, webUid: `${WA_PREFIX}-webuid`, name: 'P2 WA Customer' },
    });
  }

  async function waCreateConv(): Promise<void> {
    waConvId = `conv-wa-${randomUUID()}`;
    await prisma.conversation.create({
      data: { id: waConvId, storeId: WA_STORE, customerId: waCustomerId, customerPhone: waCustomerId, channel: 'whatsapp' },
    });
    await conversationContextService.initializeContext({ storeId: WA_STORE, customerId: waCustomerId, conversationId: waConvId });
  }

  before(async () => {
    (llmGateway as any).generate = mockGenerate;
    await waCleanup();
    await waSetupStore();
  });

  after(async () => {
    await waCleanup();
  });

  beforeEach(async () => {
    await prisma.orderItem.deleteMany({ where: { order: { storeId: { startsWith: WA_PREFIX } } } }).catch(() => {});
    await prisma.order.deleteMany({ where: { storeId: { startsWith: WA_PREFIX } } }).catch(() => {});
    await prisma.conversationContext.deleteMany({ where: { conversation: { storeId: { startsWith: WA_PREFIX } } } }).catch(() => {});
    await prisma.conversation.deleteMany({ where: { storeId: { startsWith: WA_PREFIX } } }).catch(() => {});
  });

  // ── 4c: WA path — hasVariants=true + variantId=null → MUST FAIL ──

  test('4c: WA path — hasVariants=true + variantId=null → executeWaCartMutation returns "error"', async () => {
    await waCreateConv();
    const msgId = `MSG-VARIANT-REQUIRED-${randomUUID()}`;
    const status = await executeWaCartMutation(
      [{ type: 'add', product: 'Sosis', qty: 1 } as CartOp],
      WA_STORE, waCustomerId, waConvId, msgId,
    );
    assert.equal(status, 'error', 'executeWaCartMutation must return "error" for hasVariants=true + variantId=null');
  });

  test('4c: WA path — hasVariants=true + variantId=null → NO OrderItem created', async () => {
    await waCreateConv();
    const msgId = `MSG-VARIANT-NOITEM-${randomUUID()}`;
    await executeWaCartMutation(
      [{ type: 'add', product: 'Sosis', qty: 1 } as CartOp],
      WA_STORE, waCustomerId, waConvId, msgId,
    );
    const orderItems = await prisma.orderItem.findMany({ where: { productId: variantProdId } });
    assert.equal(orderItems.length, 0, 'no OrderItem should be created when VARIANT_REQUIRED fires');
  });

  test('4c: WA path — hasVariants=true + variantId=null → ActionIdempotency = FAILED', async () => {
    await waCreateConv();
    const msgId = `MSG-VARIANT-FAILED-${randomUUID()}`;
    await executeWaCartMutation(
      [{ type: 'add', product: 'Sosis', qty: 1 } as CartOp],
      WA_STORE, waCustomerId, waConvId, msgId,
    );
    const claim = await prisma.actionIdempotency.findFirst({
      where: { storeId: WA_STORE, actionType: 'WA_CART_MUTATION', actionId: `wa:${waConvId}:${msgId}` },
    });
    assert.ok(claim, 'ActionIdempotency claim row must exist');
    assert.equal(claim!.status, 'FAILED', 'claim status must be FAILED (per §6A.9)');
  });

  test('4c: WA path — hasVariants=true + VALID variantId → executeWaCartMutation returns "applied"', async () => {
    await waCreateConv();
    const msgId = `MSG-VARIANT-OK-${randomUUID()}`;
    const status = await executeWaCartMutation(
      [{ type: 'add', product: 'Sosis', qty: 2, variantId: validVariantId } as CartOp],
      WA_STORE, waCustomerId, waConvId, msgId,
    );
    assert.equal(status, 'applied', 'executeWaCartMutation must return "applied" for hasVariants=true + valid variantId');
  });

  // ── 4d: WA path — hasVariants=false → SUCCESS ──

  test('4d: WA path — hasVariants=false → executeWaCartMutation returns "applied"', async () => {
    await waCreateConv();
    const msgId = `MSG-NOVARIANT-OK-${randomUUID()}`;
    const status = await executeWaCartMutation(
      [{ type: 'add', product: 'Beras', qty: 3 } as CartOp],
      WA_STORE, waCustomerId, waConvId, msgId,
    );
    assert.equal(status, 'applied', 'executeWaCartMutation must return "applied" for hasVariants=false');
  });

  test('4d: WA path — hasVariants=false → OrderItem created with correct price', async () => {
    await waCreateConv();
    const msgId = `MSG-NOVARIANT-ITEM-${randomUUID()}`;
    await executeWaCartMutation(
      [{ type: 'add', product: 'Beras', qty: 1 } as CartOp],
      WA_STORE, waCustomerId, waConvId, msgId,
    );
    const orderItems = await prisma.orderItem.findMany({ where: { productId: noVariantProdId } });
    assert.equal(orderItems.length, 1, 'exactly one OrderItem should be created');
    assert.equal(orderItems[0].unitPrice, 75000, 'unitPrice must match DB price');
    assert.equal(orderItems[0].variantId, null, 'variantId must be null for hasVariants=false');
  });
});
