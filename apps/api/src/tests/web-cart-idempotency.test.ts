/**
 * P7 — PWA (web) cart mutation idempotency via the SAME claimAction/executeClaimedAction
 * (FOR UPDATE + re-check) path WA uses (UNIT6-PREP-2 §F).
 *
 * Prior state (Gap 1): PWA /message free-text called
 * `executeWaCartMutation(..., messageId=undefined)` → the `!messageId` branch →
 * `cartAuthority.executeOps()` DIRECTLY, bypassing claimAction/FOR UPDATE/re-check.
 * Only protection was an in-process mutex (messageQueueService.acquireLock) — no
 * DB-backed idempotency, no multi-instance safety.
 *
 * Fix: thread `req.requestId` (x-request-id via requestIdMiddleware) as the web
 * `messageId` + channel='web' → actionId `web:${conversationId}:${requestId}` →
 * the claimed path. WA flow is byte-for-byte unchanged (5-arg calls default
 * channel='whatsapp' → `wa:` prefix).
 *
 * Runner:
 *   npx tsx --env-file=../../.env --test --test-force-exit src/tests/web-cart-idempotency.test.ts
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../infrastructure/prisma.js';
import { executeWaCartMutation } from '../business/action-registry.js';

const STORE_ID = 'store-web-idem';
const PREFIX = STORE_ID;

const PRODUCTS = [
  { id: 'prod-web-ayam', name: 'ayam', price: 10000, stock: 100 },
  { id: 'prod-web-telur', name: 'telur', price: 5000, stock: 100 },
] as const;

let customerId: string;
let conversationId: string;

async function cleanup(): Promise<void> {
  await prisma.actionIdempotency.deleteMany({ where: { storeId: { startsWith: PREFIX } } }).catch(() => {});
  await prisma.conversationHistory.deleteMany({ where: { conversation: { storeId: { startsWith: PREFIX } } } }).catch(() => {});
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
      name: 'P7 Web Idempotency Store',
      slug: STORE_ID,
      email: 'web-idem@garuda.test',
      phoneNumber: '+6281200000097',
      address: 'Jl. Web Idem No. 1',
      originProvinceId: 'prov-web-1',
      originProvinceName: 'Jawa Barat',
      originCityId: 'city-web-1',
      originCityName: 'Bandung',
      originSubdistrictId: 'sub-web-1',
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
  customerId = `cust-web-${randomUUID()}`;
  await prisma.customer.create({
    data: { id: customerId, storeId: STORE_ID, webUid: `${PREFIX}-webuid`, name: 'P7 Web Customer' },
  });
}

async function createConv(): Promise<void> {
  conversationId = `conv-web-${randomUUID()}`;
  await prisma.conversation.create({
    data: {
      id: conversationId,
      storeId: STORE_ID,
      customerId,
      customerPhone: null,
      channel: 'web',
    },
  });
}

async function getOrderItems(): Promise<{ productName: string; quantity: number }[]> {
  const order = await prisma.order.findFirst({
    where: { conversationId, orderStatus: 'draft', deletedAt: null },
  });
  if (!order) return [];
  const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
  return items.map((i: any) => ({ productName: i.productName, quantity: Number(i.quantity) }));
}

async function countWebClaims(actionId: string): Promise<number> {
  return prisma.actionIdempotency.count({
    where: { storeId: STORE_ID, actionType: 'WA_CART_MUTATION', actionId },
  });
}

const V1_OPS = (): any => [{ type: 'add', product: 'ayam', qty: 2, price: 10000 }];

before(async () => {
  await cleanup();
  await setupStore();
});

after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.actionIdempotency.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
  await prisma.conversationHistory.deleteMany({ where: { conversation: { storeId: STORE_ID } } }).catch(() => {});
  await prisma.orderItem.deleteMany({ where: { order: { storeId: STORE_ID } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
  await createConv();
});

describe('P7 — PWA (web) cart idempotency via claim path (UNIT6-PREP-2 §F)', () => {
  test('F-t1: redeliver SAME web request id twice → 2nd already_applied, mutated exactly once', async () => {
    const requestId = 'WEB-STABLE-1';
    const s1 = await executeWaCartMutation(V1_OPS(), STORE_ID, customerId, conversationId, requestId, 'web');
    assert.equal(s1.status, 'applied', 'first web message applied');
    const s2 = await executeWaCartMutation(V1_OPS(), STORE_ID, customerId, conversationId, requestId, 'web');
    assert.equal(s2.status, 'already_applied', 'redeliver must resolve to already_applied (idempotent)');
    const items = await getOrderItems();
    const ayam = items.find((i) => i.productName === 'ayam');
    assert.ok(ayam, 'ayam must be in cart');
    assert.equal(ayam.quantity, 2, 'qty added exactly once (2), not doubled to 4');
  });

  test('F-t2: two DIFFERENT web request ids, same conversation → both applied (no over-dedup)', async () => {
    const s1 = await executeWaCartMutation(V1_OPS(), STORE_ID, customerId, conversationId, 'WEB-A', 'web');
    const s2 = await executeWaCartMutation(V1_OPS(), STORE_ID, customerId, conversationId, 'WEB-B', 'web');
    assert.equal(s1.status, 'applied');
    assert.equal(s2.status, 'applied');
    const items = await getOrderItems();
    const ayam = items.find((i) => i.productName === 'ayam');
    assert.equal(ayam.quantity, 4, 'both distinct messages apply: 2 + 2 = 4');
  });

  test('F-t3: web path takes the CLAIMED path (actionIdempotency row exists), not the !messageId direct branch', async () => {
    const requestId = 'WEB-CLAIM-1';
    await executeWaCartMutation(V1_OPS(), STORE_ID, customerId, conversationId, requestId, 'web');
    const actionId = `web:${conversationId}:${requestId}`;
    const claims = await countWebClaims(actionId);
    assert.equal(
      claims,
      1,
      'web mutation must leave exactly one WA_CART_MUTATION claim row with actionId `web:...` ' +
        '(proves the claimed path was taken, NOT the !messageId direct-executeOps branch which leaves no claim)',
    );
  });

  test('F-t4 (regression): WA channel 5-arg call still uses `wa:` prefix + claim path, unchanged', async () => {
    // WA callers pass no channel → default 'whatsapp' → `wa:` prefix (must be untouched).
    const s1 = await executeWaCartMutation(V1_OPS(), STORE_ID, customerId, conversationId, 'WA-SAME-1'); // 5-arg
    assert.equal(s1.status, 'applied');
    const actionId = `wa:${conversationId}:WA-SAME-1`;
    assert.equal(await countWebClaims(actionId), 1, 'WA 5-arg call must leave a `wa:` claim row');
  });
});
