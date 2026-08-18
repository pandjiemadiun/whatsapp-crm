/**
 * P2 OPEN_CATALOG — Structured Action acceptance tests.
 *
 * Verifies the non-mutating catalog/discovery action against the owner-decided
 * semantics: OPEN_CATALOG opens the authoritative catalog flow by delegating
 * to the existing catalog authority (productService.getProductsByStore).
 *
 * Runner:
 *   npx tsx --env-file=../../.env --test --test-force-exit src/tests/structured-actions-p2.test.ts
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../infrastructure/prisma.js';
import {
  executeAction,
  actionRegistry,
  OpenCatalogRequestSchema,
  OpenCatalogResponseSchema,
} from '../business/action-registry.js';
import { productService } from '../business/product.service.js';
import { conversationService } from '../business/conversation.service.js';

const TEST_PREFIX = 'test-action-p2';

let storeId: string;
let storeIdOther: string;
let customerId: string;
let conversationId: string;
let productId: string;           // active, in requesting store
let inactiveId: string;         // inactive, in requesting store
let deletedId: string;          // soft-deleted, in requesting store
let otherStoreId: string;       // active, in OTHER store (cross-tenant leak sentinel)

function makeActionContext(overrides?: Partial<{ storeId: string; customerId: string; conversationId: string }>): any {
  return {
    storeId: overrides?.storeId || storeId,
    customerId: overrides?.customerId || customerId,
    conversationId: overrides?.conversationId || conversationId,
    channel: 'web',
    requestId: randomUUID(),
  };
}

function makeOpenCatalogRequest(opts: { omitActionId?: boolean; badType?: boolean; badActionId?: boolean } = {}): any {
  const req: any = {
    actionId: randomUUID(),
    type: 'OPEN_CATALOG',
    payload: {},
  };
  if (opts.omitActionId) delete req.actionId;
  if (opts.badActionId) req.actionId = 'not-a-uuid';
  if (opts.badType) req.type = 'SOMETHING_ELSE';
  return req;
}

async function cleanup() {
  await prisma.actionIdempotency.deleteMany({
    where: { storeId: { startsWith: TEST_PREFIX } },
  }).catch(() => {});
  await prisma.product.deleteMany({
    where: { storeId: { startsWith: TEST_PREFIX } },
  }).catch(() => {});
  await prisma.productCategory.deleteMany({
    where: { storeId: { startsWith: TEST_PREFIX } },
  }).catch(() => {});
  await prisma.conversationContext.deleteMany({
    where: { conversation: { storeId: { startsWith: TEST_PREFIX } } },
  }).catch(() => {});
  await prisma.conversation.deleteMany({
    where: { storeId: { startsWith: TEST_PREFIX } },
  }).catch(() => {});
  await prisma.customer.deleteMany({
    where: { storeId: { startsWith: TEST_PREFIX } },
  }).catch(() => {});
  await prisma.store.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  }).catch(() => {});
}

async function setupFixtures() {
  await cleanup();

  const store = await prisma.store.upsert({
    where: { id: `${TEST_PREFIX}-store` },
    update: {},
    create: {
      id: `${TEST_PREFIX}-store`,
      name: 'P2 Catalog Store',
      slug: `${TEST_PREFIX}-store`,
      email: 'p2@garuda.test',
    },
  });
  storeId = store.id;

  const storeOther = await prisma.store.upsert({
    where: { id: `${TEST_PREFIX}-other` },
    update: {},
    create: {
      id: `${TEST_PREFIX}-other`,
      name: 'P2 Other Store',
      slug: `${TEST_PREFIX}-other`,
      email: 'p2-other@garuda.test',
    },
  });
  storeIdOther = storeOther.id;

  const customer = await prisma.customer.create({
    data: {
      id: `cust-p2-${randomUUID()}`,
      storeId,
      webUid: `${TEST_PREFIX}-webuid`,
      name: 'P2 Customer',
    },
  });
  customerId = customer.id;

  const conv = await prisma.conversation.create({
    data: {
      id: `conv-p2-${randomUUID()}`,
      storeId,
      customerId,
      customerPhone: '+628123456790',
      channel: 'web',
    },
  });
  conversationId = conv.id;

  const cat = await prisma.productCategory.create({
    data: {
      id: `cat-${randomUUID()}`,
      storeId,
      name: 'Sayur',
      displayOrder: 0,
      isActive: true,
    },
  });

  const p1 = await prisma.product.create({
    data: { id: randomUUID(), storeId, categoryId: cat.id, name: 'Bawang Merah', price: 20000, currency: 'IDR', isActive: true },
  });
  productId = p1.id;

  const p2 = await prisma.product.create({
    data: { id: randomUUID(), storeId, categoryId: cat.id, name: 'Bawang Putih', price: 18000, currency: 'IDR', isActive: true },
  });

  inactiveId = (await prisma.product.create({
    data: { id: randomUUID(), storeId, categoryId: cat.id, name: 'Buncis', price: 12000, currency: 'IDR', isActive: false },
  })).id;

  deletedId = (await prisma.product.create({
    data: { id: randomUUID(), storeId, categoryId: cat.id, name: 'Wortel', price: 8000, currency: 'IDR', isActive: true, deletedAt: new Date() },
  })).id;

  otherStoreId = (await prisma.product.create({
    data: { id: randomUUID(), storeId: storeIdOther, categoryId: cat.id, name: 'Produk Toko Lain', price: 99999, currency: 'IDR', isActive: true },
  })).id;
}

before(async () => {
  await setupFixtures();
});

after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Ensure no ActionIdempotency pollution (read-only action must write zero rows).
  await prisma.actionIdempotency.deleteMany({
    where: { storeId, actionType: 'OPEN_CATALOG' },
  }).catch(() => {});
});

// ═════════════════════════════════════════════════════════════
// §P2 Test 1 — Valid request schema; empty payload accepted
// ═════════════════════════════════════════════════════════════
test('§P2.1: OPEN_CATALOG request schema accepts valid UUID actionId and empty payload', () => {
  const req = makeOpenCatalogRequest();
  const parsed = OpenCatalogRequestSchema.safeParse(req);
  assert.equal(parsed.success, true, parsed.error?.message);
  // Empty payload object is valid (no client-controlled filtering).
  assert.ok(parsed.data.payload === undefined || Object.keys(parsed.data.payload).length === 0);
});

// ═════════════════════════════════════════════════════════════
// §P2 Test 2 — Invalid request rejected before handler
// ═════════════════════════════════════════════════════════════
test('§P2.2: invalid request rejected before handler execution', async () => {
  // Missing actionId → schema parse fails in executeAction before authorize/handler
  await assert.rejects(
    async () => executeAction('OPEN_CATALOG', makeOpenCatalogRequest({ omitActionId: true }), makeActionContext()),
    (err: any) => err instanceof Error && /Invalid request/.test(err.message),
  );

  // Non-UUID actionId
  await assert.rejects(
    async () => executeAction('OPEN_CATALOG', makeOpenCatalogRequest({ badActionId: true }), makeActionContext()),
    (err: any) => err instanceof Error && /Invalid request/.test(err.message),
  );

  // Wrong type literal
  await assert.rejects(
    async () => executeAction('OPEN_CATALOG', makeOpenCatalogRequest({ badType: true }), makeActionContext()),
    (err: any) => err instanceof Error && /Invalid request/.test(err.message),
  );
});

// ═════════════════════════════════════════════════════════════
// §P2 Test 3 — handler uses server-derived context.storeId
// ═════════════════════════════════════════════════════════════
test('§P2.3: handler returns catalog scoped to server context.storeId (not client input)', async () => {
  const ctx = makeActionContext();
  const result = await executeAction('OPEN_CATALOG', makeOpenCatalogRequest(), ctx);
  assert.equal(result.success, true);

  const productIds = (result.data.result.products as any[]).map((p) => p.id);
  // Requesting store's active product present
  assert.ok(productIds.includes(productId), 'requesting store active product must appear');

  // Cross-store product MUST NOT leak
  assert.ok(!productIds.includes(otherStoreId), 'other-store product must NOT leak into catalog');
});

// ═════════════════════════════════════════════════════════════
// §P2 Test 4 — active products only
// ═════════════════════════════════════════════════════════════
test('§P2.4: inactive products (isActive=false) excluded from catalog', async () => {
  const result = await executeAction('OPEN_CATALOG', makeOpenCatalogRequest(), makeActionContext());
  const productIds = (result.data.result.products as any[]).map((p) => p.id);
  assert.ok(!productIds.includes(inactiveId), 'inactive product must not appear');
});

// ═════════════════════════════════════════════════════════════
// §P2 Test 5 — soft-deleted excluded
// ═════════════════════════════════════════════════════════════
test('§P2.5: soft-deleted products excluded from catalog', async () => {
  const result = await executeAction('OPEN_CATALOG', makeOpenCatalogRequest(), makeActionContext());
  const productIds = (result.data.result.products as any[]).map((p) => p.id);
  assert.ok(!productIds.includes(deletedId), 'soft-deleted product must not appear');
});

// ═════════════════════════════════════════════════════════════
// §P2 Test 6 — cross-store isolation
// ═════════════════════════════════════════════════════════════
test('§P2.6: catalog scoped to requesting store (cross-store isolation)', async () => {
  const result = await executeAction('OPEN_CATALOG', makeOpenCatalogRequest(), makeActionContext());
  const productIds = (result.data.result.products as any[]).map((p) => p.id);
  assert.ok(!productIds.includes(otherStoreId), 'other-store product must not appear');
});

// ═════════════════════════════════════════════════════════════
// §P2 Test 7 — deterministic response shape
// ═════════════════════════════════════════════════════════════
test('§P2.7: response has deterministic typed shape', async () => {
  const result = await executeAction('OPEN_CATALOG', makeOpenCatalogRequest(), makeActionContext());
  assert.equal(result.success, true);
  assert.equal(result.status, 'applied');
  assert.equal(result.data.type, 'OPEN_CATALOG');
  assert.equal(result.data.status, 'applied');
  assert.equal(typeof result.data.actionId, 'string');

  const products = result.data.result.products as any[];
  assert.ok(Array.isArray(products));
  for (const p of products) {
    assert.equal(typeof p.id, 'string');
    assert.equal(typeof p.name, 'string');
    assert.equal(typeof p.price, 'number');
    assert.ok('stock' in p);
    assert.ok('imageUrl' in p);
  }
  assert.equal(typeof result.data.result.total, 'number');
  assert.equal(result.data.result.total, products.length);
});

// ═════════════════════════════════════════════════════════════
// §P2 Test 8 — response validates against the response schema
// ═════════════════════════════════════════════════════════════
test('§P2.8: response body validates against OpenCatalogResponseSchema', async () => {
  const result = await executeAction('OPEN_CATALOG', makeOpenCatalogRequest(), makeActionContext());
  const parsed = OpenCatalogResponseSchema.safeParse(result.data);
  assert.equal(parsed.success, true, parsed.error?.message);
});

// ═════════════════════════════════════════════════════════════
// §P2 Test 9 — read-only: zero ActionIdempotency rows
// ═════════════════════════════════════════════════════════════
test('§P2.9: read-only action creates NO ActionIdempotency row', async () => {
  const before = await prisma.actionIdempotency.count({
    where: { storeId, actionType: 'OPEN_CATALOG' },
  });
  assert.equal(before, 0);

  await executeAction('OPEN_CATALOG', makeOpenCatalogRequest(), makeActionContext());

  const after = await prisma.actionIdempotency.count({
    where: { storeId, actionType: 'OPEN_CATALOG' },
  });
  assert.equal(after, 0, 'OPEN_CATALOG must not create ActionIdempotency rows (no lease/claim)');
});

// ═════════════════════════════════════════════════════════════
// §P2 Test 10 — no ConversationEngine / LLM
// ═════════════════════════════════════════════════════════════
test('§P2.10: does NOT invoke ConversationEngine.processCustomerMessage (no LLM)', async () => {
  let called = false;
  const orig = conversationService.processCustomerMessage;
  (conversationService as any).processCustomerMessage = async () => { called = true; return null as any; };
  try {
    await executeAction('OPEN_CATALOG', makeOpenCatalogRequest(), makeActionContext());
  } finally {
    (conversationService as any).processCustomerMessage = orig;
  }
  assert.equal(called, false, 'OPEN_CATALOG must NOT call processCustomerMessage (LLM/Engine)');
});

// ═════════════════════════════════════════════════════════════
// §P2 Test 11 — registered in Action Registry
// ═════════════════════════════════════════════════════════════
test('§P2.11: OPEN_CATALOG registered in the action registry', () => {
  assert.ok(actionRegistry['OPEN_CATALOG'], 'OPEN_CATALOG must be registered');
  assert.equal(actionRegistry['OPEN_CATALOG'].type, 'OPEN_CATALOG');
  assert.equal(typeof actionRegistry['OPEN_CATALOG'].handler, 'function');
  assert.equal(typeof actionRegistry['OPEN_CATALOG'].authorize, 'function');
  assert.equal(typeof actionRegistry['OPEN_CATALOG'].requestSchema, 'object');
  assert.equal(typeof actionRegistry['OPEN_CATALOG'].responseSchema, 'object');
});

// ═════════════════════════════════════════════════════════════
// §P2 Test 16 — direct productService.getProductsByStore unit
// (mirrors P1.16 direct-service test)
// ═════════════════════════════════════════════════════════════
describe('§P2.16: productService.getProductsByStore (catalog authority)', () => {
  test('returns active non-deleted products for the store', async () => {
    const { products, total } = await productService.getProductsByStore(storeId, {});
    const ids = products.map((p) => p.id);
    assert.ok(ids.includes(productId), 'active product must be listed');
    assert.ok(!ids.includes(inactiveId), 'inactive product must be excluded');
    assert.ok(!ids.includes(deletedId), 'deleted product must be excluded');
    assert.ok(!ids.includes(otherStoreId), 'other-store product must be excluded');
    assert.equal(total, products.length, 'total must equal returned count');
  });
});

// ═════════════════════════════════════════════════════════════
// §P2 Test 12 — P0 ADD_TO_CART registry remains present & unchanged
// ═════════════════════════════════════════════════════════════
test('§P2.12: P0 ADD_TO_CART registry entry remains present and unchanged', () => {
  assert.ok(actionRegistry['ADD_TO_CART'], 'ADD_TO_CART must still be registered');
  assert.equal(actionRegistry['ADD_TO_CART'].type, 'ADD_TO_CART');
  assert.equal(typeof actionRegistry['ADD_TO_CART'].handler, 'function');
});

// ═════════════════════════════════════════════════════════════
// §P2 Test 13 — P1 SHOW_RELATED_PRODUCTS registry remains present & unchanged
// ═════════════════════════════════════════════════════════════
test('§P2.13: P1 SHOW_RELATED_PRODUCTS registry entry remains present and unchanged', () => {
  assert.ok(actionRegistry['SHOW_RELATED_PRODUCTS'], 'SHOW_RELATED_PRODUCTS must still be registered');
  assert.equal(actionRegistry['SHOW_RELATED_PRODUCTS'].type, 'SHOW_RELATED_PRODUCTS');
  assert.equal(typeof actionRegistry['SHOW_RELATED_PRODUCTS'].handler, 'function');
});

// ═════════════════════════════════════════════════════════════
// §P2 Test 14 — OPEN_CATALOG does not enter mutation lease flow
// (executeAddClaimedAction/claimAction are ADD_TO_CART-only)
// ═════════════════════════════════════════════════════════════
test('§P2.14: OPEN_CATALOG handler is read-only (no claimAction/lease)', async () => {
  // executeAction for OPEN_CATALOG runs requestSchema → authorize → handler.
  // The handler delegates directly to productService.getProductsByStore and
  // returns ActionResult{status:'applied'}. No claimAction is invoked.
  const idempotencyBefore = await prisma.actionIdempotency.count({ where: { storeId, actionType: 'OPEN_CATALOG' } });
  const result = await executeAction('OPEN_CATALOG', makeOpenCatalogRequest(), makeActionContext());
  const idempotencyAfter = await prisma.actionIdempotency.count({ where: { storeId, actionType: 'OPEN_CATALOG' } });

  assert.equal(result.success, true);
  assert.equal(result.status, 'applied');
  assert.equal(idempotencyBefore, 0);
  assert.equal(idempotencyAfter, 0, 'OPEN_CATALOG must bypass the ActionIdempotency lease state machine');
});

// ═════════════════════════════════════════════════════════════
// §P2 Test 15 — total reflects ONLY active non-deleted products
// ═════════════════════════════════════════════════════════════
test('§P2.15: total count excludes inactive and deleted products', async () => {
  const result = await executeAction('OPEN_CATALOG', makeOpenCatalogRequest(), makeActionContext());
  const products = result.data.result.products as any[];
  assert.equal(result.data.result.total, products.length);
  const ids = products.map((p) => p.id);
  assert.ok(!ids.includes(inactiveId));
  assert.ok(!ids.includes(deletedId));
  assert.ok(!ids.includes(otherStoreId));
});
