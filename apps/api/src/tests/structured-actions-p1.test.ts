/**
 * P1 SHOW_RELATED_PRODUCTS — Structured Action acceptance tests.
 *
 * Verifies the non-mutating discovery action against the owner-decided
 * semantics: "active, non-deleted products in the SAME category as the source
 * product, same store, excluding the source product."
 *
 * Runner:
 *   npx tsx --env-file=../../.env --test --test-force-exit src/tests/structured-actions-p1.test.ts
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../infrastructure/prisma.js';
import {
  executeAction,
  actionRegistry,
  ShowRelatedProductsRequestSchema,
} from '../business/action-registry.js';
import { ApiError } from '../errors/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import { productService } from '../business/product.service.js';
import { conversationService } from '../business/conversation.service.js';

const TEST_PREFIX = 'test-action-p1';

let storeId: string;
let storeIdOther: string;
let customerId: string;
let conversationId: string;
let categoryId: string | null = null;
let productId: string;          // source product, in a category
let relatedA: string;           // same category, same store, active
let relatedB: string;           // same category, same store, active
let inactiveRelated: string;    // same category, same store, inactive
let deletedRelated: string;     // same category, same store, soft-deleted
let otherCategoryProduct: string; // different category, same store
let productIdOtherStore: string; // cross-tenant

function makeActionContext(overrides?: Partial<{ storeId: string; customerId: string; conversationId: string }>): any {
  return {
    storeId: overrides?.storeId || storeId,
    customerId: overrides?.customerId || customerId,
    conversationId: overrides?.conversationId || conversationId,
    channel: 'web',
    requestId: randomUUID(),
  };
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
      name: 'P1 Related Store',
      slug: `${TEST_PREFIX}-store`,
      email: 'p1@garuda.test',
    },
  });
  storeId = store.id;

  const storeOther = await prisma.store.upsert({
    where: { id: `${TEST_PREFIX}-other` },
    update: {},
    create: {
      id: `${TEST_PREFIX}-other`,
      name: 'P1 Other Store',
      slug: `${TEST_PREFIX}-other`,
      email: 'p1-other@garuda.test',
    },
  });
  storeIdOther = storeOther.id;

  const customer = await prisma.customer.create({
    data: {
      id: `cust-p1-${randomUUID()}`,
      storeId,
      webUid: `${TEST_PREFIX}-webuid`,
      name: 'P1 Customer',
    },
  });
  customerId = customer.id;

  const conv = await prisma.conversation.create({
    data: {
      id: `conv-p1-${randomUUID()}`,
      storeId,
      customerId,
      customerPhone: '+62812345679',
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
  categoryId = cat.id;

  const catOther = await prisma.productCategory.create({
    data: {
      id: `cat-other-${randomUUID()}`,
      storeId,
      name: 'Buah',
      displayOrder: 1,
      isActive: true,
    },
  });

  const src = await prisma.product.create({
    data: {
      id: randomUUID(),
      storeId,
      categoryId: cat.id,
      name: 'Bawang Merah',
      price: 20000,
      currency: 'IDR',
      isActive: true,
    },
  });
  productId = src.id;

  const rA = await prisma.product.create({
    data: {
      id: randomUUID(),
      storeId,
      categoryId: cat.id,
      name: 'Bawang Putih',
      price: 18000,
      currency: 'IDR',
      isActive: true,
    },
  });
  relatedA = rA.id;

  const rB = await prisma.product.create({
    data: {
      id: randomUUID(),
      storeId,
      categoryId: cat.id,
      name: 'Kunyit',
      price: 15000,
      currency: 'IDR',
      isActive: true,
    },
  });
  relatedB = rB.id;

  const inactive = await prisma.product.create({
    data: {
      id: randomUUID(),
      storeId,
      categoryId: cat.id,
      name: 'Buncis',
      price: 12000,
      currency: 'IDR',
      isActive: false,
    },
  });
  inactiveRelated = inactive.id;

  const deleted = await prisma.product.create({
    data: {
      id: randomUUID(),
      storeId,
      categoryId: cat.id,
      name: 'Wortel',
      price: 8000,
      currency: 'IDR',
      isActive: true,
      deletedAt: new Date(),
    },
  });
  deletedRelated = deleted.id;

  const otherCat = await prisma.product.create({
    data: {
      id: randomUUID(),
      storeId,
      categoryId: catOther.id,
      name: 'Apel',
      price: 25000,
      currency: 'IDR',
      isActive: true,
    },
  });
  otherCategoryProduct = otherCat.id;

  const prodOther = await prisma.product.create({
    data: {
      id: randomUUID(),
      storeId: storeIdOther,
      categoryId: catOther.id,
      name: 'Produk Toko Lain',
      price: 99999,
      currency: 'IDR',
      isActive: true,
    },
  });
  productIdOtherStore = prodOther.id;
}

before(async () => {
  await setupFixtures();
});

after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Ensure no ActionIdempotency pollution from P0 runs.
  await prisma.actionIdempotency.deleteMany({
    where: { storeId, actionType: 'SHOW_RELATED_PRODUCTS' },
  }).catch(() => {});
});

function makeShowRelatedRequest(productIdVal?: string, opts: { omitProductId?: boolean } = {}): any {
  if (opts.omitProductId) {
    return { actionId: randomUUID(), type: 'SHOW_RELATED_PRODUCTS', payload: {} };
  }
  return {
    actionId: randomUUID(),
    type: 'SHOW_RELATED_PRODUCTS',
    payload: { productId: productIdVal || productId },
  };
}

// ═════════════════════════════════════════════════════════════
// §P1 Test 1 — Request schema accepts valid UUID productId
// ═════════════════════════════════════════════════════════════
test('§P1.1: SHOW_RELATED_PRODUCTS request schema accepts valid UUID productId', () => {
  const req = makeShowRelatedRequest();
  const parsed = ShowRelatedProductsRequestSchema.safeParse(req);
  assert.equal(parsed.success, true, parsed.error?.message);
});

// ═════════════════════════════════════════════════════════════
// §P1 Test 2 — Invalid payload rejected before domain execution
// ═════════════════════════════════════════════════════════════
test('§P1.2: non-UUID productId rejected by schema before execution', () => {
  const bad = { actionId: randomUUID(), type: 'SHOW_RELATED_PRODUCTS', payload: { productId: 'not-a-uuid' } };
  const parsed = ShowRelatedProductsRequestSchema.safeParse(bad);
  assert.equal(parsed.success, false);
});

test('§P1.2b: missing payload.productId rejected by schema', () => {
  const bad = makeShowRelatedRequest(undefined, { omitProductId: true });
  const parsed = ShowRelatedProductsRequestSchema.safeParse(bad);
  assert.equal(parsed.success, false);
});

// ═════════════════════════════════════════════════════════════
// §P1 Test 3 — Same-category products returned
// ═════════════════════════════════════════════════════════════
test('§P1.3: returns active products in the same category as source', async () => {
  const result = await executeAction('SHOW_RELATED_PRODUCTS', makeShowRelatedRequest(), makeActionContext());
  assert.equal(result.success, true);
  const ids = (result.data.result.products as any[]).map((p) => p.id);
  assert.ok(ids.includes(relatedA), 'relatedA should be in results');
  assert.ok(ids.includes(relatedB), 'relatedB should be in results');
});

// ═════════════════════════════════════════════════════════════
// §P1 Test 4 — Source product excluded
// ═════════════════════════════════════════════════════════════
test('§P1.4: source product excluded from results', async () => {
  const result = await executeAction('SHOW_RELATED_PRODUCTS', makeShowRelatedRequest(), makeActionContext());
  const ids = (result.data.result.products as any[]).map((p) => p.id);
  assert.ok(!ids.includes(productId), 'source product must not appear in results');
});

// ═════════════════════════════════════════════════════════════
// §P1 Test 5 — Inactive products excluded
// ═════════════════════════════════════════════════════════════
test('§P1.5: inactive (isActive=false) products excluded', async () => {
  const result = await executeAction('SHOW_RELATED_PRODUCTS', makeShowRelatedRequest(), makeActionContext());
  const ids = (result.data.result.products as any[]).map((p) => p.id);
  assert.ok(!ids.includes(inactiveRelated), 'inactive product must not appear');
});

// ═════════════════════════════════════════════════════════════
// §P1 Test 6 — Deleted products excluded
// ═════════════════════════════════════════════════════════════
test('§P1.6: soft-deleted products excluded', async () => {
  const result = await executeAction('SHOW_RELATED_PRODUCTS', makeShowRelatedRequest(), makeActionContext());
  const ids = (result.data.result.products as any[]).map((p) => p.id);
  assert.ok(!ids.includes(deletedRelated), 'deleted product must not appear');
});

// ═════════════════════════════════════════════════════════════
// §P1 Test 7 — Other-category products excluded
// ═════════════════════════════════════════════════════════════
test('§P1.7: products from a different category excluded', async () => {
  const result = await executeAction('SHOW_RELATED_PRODUCTS', makeShowRelatedRequest(), makeActionContext());
  const ids = (result.data.result.products as any[]).map((p) => p.id);
  assert.ok(!ids.includes(otherCategoryProduct), 'different-category product must not appear');
});

// ═════════════════════════════════════════════════════════════
// §P1 Test 8 — Cross-tenant product rejected
// ═════════════════════════════════════════════════════════════
test('§P1.8: cross-tenant productId rejected (tenant isolation)', async () => {
  const badReq = makeShowRelatedRequest(productIdOtherStore);
  await assert.rejects(
    async () => executeAction('SHOW_RELATED_PRODUCTS', badReq, makeActionContext()),
    (err: any) => {
      assert.equal(err instanceof ApiError, true);
      assert.equal(err.code, ErrorCodes.ERR_AUTH_FORBIDDEN);
      return true;
    },
  );
});

// ═════════════════════════════════════════════════════════════
// §P1 Test 9 — Same-store isolation (only requesting store's products)
// ═════════════════════════════════════════════════════════════
test('§P1.9: results scoped to the requesting store only', async () => {
  const result = await executeAction('SHOW_RELATED_PRODUCTS', makeShowRelatedRequest(), makeActionContext());
  const ids = (result.data.result.products as any[]).map((p) => p.id);
  assert.ok(!ids.includes(productIdOtherStore), 'other-store product must not leak');
});

// ═════════════════════════════════════════════════════════════
// §P1 Test 10 — No ActionIdempotency row created (read-only)
// ═════════════════════════════════════════════════════════════
test('§P1.10: no ActionIdempotency record created for read-only action', async () => {
  const before = await prisma.actionIdempotency.count({
    where: { storeId, actionType: 'SHOW_RELATED_PRODUCTS' },
  });
  assert.equal(before, 0);
  await executeAction('SHOW_RELATED_PRODUCTS', makeShowRelatedRequest(), makeActionContext());
  const after = await prisma.actionIdempotency.count({
    where: { storeId, actionType: 'SHOW_RELATED_PRODUCTS' },
  });
  assert.equal(after, 0, 'read-only action must not create ActionIdempotency rows');
});

// ═════════════════════════════════════════════════════════════
// §P1 Test 11 — No LLM / ConversationEngine call
// ═════════════════════════════════════════════════════════════
test('§P1.11: does not invoke ConversationEngine.processCustomerMessage', async () => {
  let called = false;
  const orig = conversationService.processCustomerMessage;
  (conversationService as any).processCustomerMessage = async () => { called = true; return null as any; };
  try {
    await executeAction('SHOW_RELATED_PRODUCTS', makeShowRelatedRequest(), makeActionContext());
  } finally {
    (conversationService as any).processCustomerMessage = orig;
  }
  assert.equal(called, false, 'SHOW_RELATED_PRODUCTS must NOT call processCustomerMessage (LLM/Engine)');
});

// ═════════════════════════════════════════════════════════════
// §P1 Test 12 — Deterministic response shape
// ═════════════════════════════════════════════════════════════
test('§P1.12: response has deterministic typed shape', async () => {
  const result = await executeAction('SHOW_RELATED_PRODUCTS', makeShowRelatedRequest(), makeActionContext());
  assert.equal(result.success, true);
  assert.equal(result.status, 'applied');
  assert.equal(result.data.type, 'SHOW_RELATED_PRODUCTS');
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
});

// ═════════════════════════════════════════════════════════════
// §P1 Test 13 — Empty related result (source has no category)
// ═════════════════════════════════════════════════════════════
test('§P1.13: empty result when source product has no category', async () => {
  const uncategorized = await prisma.product.create({
    data: {
      id: randomUUID(),
      storeId,
      categoryId: null,
      name: 'Produk Tanpa Kategori',
      price: 5000,
      currency: 'IDR',
      isActive: true,
    },
  });
  try {
    const result = await executeAction('SHOW_RELATED_PRODUCTS', makeShowRelatedRequest(uncategorized.id), makeActionContext());
    assert.equal(result.success, true);
    assert.equal(result.data.result.products.length, 0, 'no related products for uncategorized source');
  } finally {
    await prisma.product.delete({ where: { id: uncategorized.id } }).catch(() => {});
  }
});

// ═════════════════════════════════════════════════════════════
// §P1 Test 14 — Empty related result when no siblings exist
// ═════════════════════════════════════════════════════════════
test('§P1.14: empty result when source is the only product in its category', async () => {
  const loneCat = await prisma.productCategory.create({
    data: { id: `lone-${randomUUID()}`, storeId, name: 'LoneCat', displayOrder: 9, isActive: true },
  });
  const lone = await prisma.product.create({
    data: { id: randomUUID(), storeId, categoryId: loneCat.id, name: 'Sendirian', price: 3000, currency: 'IDR', isActive: true },
  });
  try {
    const result = await executeAction('SHOW_RELATED_PRODUCTS', makeShowRelatedRequest(lone.id), makeActionContext());
    assert.equal(result.success, true);
    assert.equal(result.data.result.products.length, 0);
  } finally {
    await prisma.product.delete({ where: { id: lone.id } }).catch(() => {});
    await prisma.productCategory.delete({ where: { id: loneCat.id } }).catch(() => {});
  }
});

// ═════════════════════════════════════════════════════════════
// §P1 Test 15 — Registered in the Action Registry
// ═════════════════════════════════════════════════════════════
test('§P1.15: SHOW_RELATED_PRODUCTS is registered in the action registry', () => {
  assert.ok(actionRegistry['SHOW_RELATED_PRODUCTS'], 'SHOW_RELATED_PRODUCTS must be registered');
  assert.equal(actionRegistry['SHOW_RELATED_PRODUCTS'].type, 'SHOW_RELATED_PRODUCTS');
});

// ═════════════════════════════════════════════════════════════
// §P1 Test 16 — Direct productService.getRelatedProducts unit
// ═════════════════════════════════════════════════════════════
describe('§P1.16: productService.getRelatedProducts', () => {
  test('returns same-category active non-deleted products excluding source', async () => {
    const prods = await productService.getRelatedProducts(productId, { storeId });
    const ids = prods.map((p) => p.id);
    assert.ok(ids.includes(relatedA));
    assert.ok(ids.includes(relatedB));
    assert.ok(!ids.includes(productId));
    assert.ok(!ids.includes(inactiveRelated));
    assert.ok(!ids.includes(deletedRelated));
    assert.ok(!ids.includes(otherCategoryProduct));
  });

  test('throws NOT_FOUND for cross-tenant productId', async () => {
    await assert.rejects(
      async () => productService.getRelatedProducts(productIdOtherStore, { storeId }),
      (err: any) => err instanceof ApiError && err.code === ErrorCodes.ERR_NOT_FOUND,
    );
  });
});

// ═════════════════════════════════════════════════════════════
// §P1 Test 17 — ActionIdempotency schema untouched (P0 lock)
// ═════════════════════════════════════════════════════════════
test('§P1.17: ADD_TO_CART registry entry unchanged and still present', () => {
  assert.ok(actionRegistry['ADD_TO_CART'], 'P0 ADD_TO_CART must remain registered');
  assert.equal(actionRegistry['ADD_TO_CART'].type, 'ADD_TO_CART');
});
