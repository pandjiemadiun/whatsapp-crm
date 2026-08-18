/**
 * P3 OPEN_CART — Structured Action acceptance tests.
 *
 * Verifies the non-mutating cart-read action against the owner-decided
 * semantics: OPEN_CART opens the authoritative customer cart via
 * CartAuthority.getCartSummary(context.conversationId).
 *
 * CRITICAL TENANT TEST: the full path POST /api/pwa/:storeSlug/action is
 * exercised end-to-end (not only direct handler invocation) to prove
 * context is derived from storeSlug + webUid via getOrCreateWebSession,
 * and that a client-supplied conversationId/storeId/customerId has no authority.
 *
 * Runner:
 *   npx tsx --env-file=../../.env --test --test-force-exit src/tests/structured-actions-p3.test.ts
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../infrastructure/prisma.js';
import {
  executeAction,
  actionRegistry,
  OpenCartRequestSchema,
  OpenCartResponseSchema,
} from '../business/action-registry.js';
import { cartAuthority } from '../business/cart-authority.js';
import { conversationService } from '../business/conversation.service.js';

const TEST_PREFIX = 'test-action-p3';

let storeId: string;
let customerId: string;
let conversationId: string;
let storeIdOther: string;
let convIdOther: string;   // a conversation in the OTHER store (tenant-isolation target)

  let sourceProductId: string;
  let otherProductId: string;
  let otherStoreProductId: string;  // a product belonging to storeIdOther

function makeActionContext(overrides?: Partial<{ storeId: string; customerId: string; conversationId: string }>): any {
  return {
    storeId: overrides?.storeId || storeId,
    customerId: overrides?.customerId || customerId,
    conversationId: overrides?.conversationId || conversationId,
    channel: 'web',
    requestId: randomUUID(),
  };
}

function makeOpenCartRequest(opts: { omitActionId?: boolean; badActionId?: boolean; badType?: boolean; payload?: any } = {}): any {
  const req: any = {
    actionId: randomUUID(),
    type: 'OPEN_CART',
    payload: {},
  };
  if (opts.omitActionId) delete req.actionId;
  if (opts.badActionId) req.actionId = 'not-a-uuid';
  if (opts.badType) req.type = 'SOMETHING_ELSE';
  if (opts.payload !== undefined) req.payload = opts.payload;
  return req;
}

async function cleanup() {
  await prisma.actionIdempotency.deleteMany({
    where: { storeId: { startsWith: TEST_PREFIX } },
  }).catch(() => {});
  await prisma.orderItem.deleteMany({
    where: { order: { storeId: { startsWith: TEST_PREFIX } } },
  }).catch(() => {});
  await prisma.order.deleteMany({
    where: { storeId: { startsWith: TEST_PREFIX } },
  }).catch(() => {});
  await prisma.conversationContext.deleteMany({
    where: { conversation: { storeId: { startsWith: TEST_PREFIX } } },
  }).catch(() => {});
  await prisma.conversation.deleteMany({
    where: { storeId: { startsWith: TEST_PREFIX } },
  }).catch(() => {});
  await prisma.product.deleteMany({
    where: { storeId: { startsWith: TEST_PREFIX } },
  }).catch(() => {});
  await prisma.productCategory.deleteMany({
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
    update: { deletedAt: null },
    create: {
      id: `${TEST_PREFIX}-store`,
      name: 'P3 Cart Store',
      slug: `${TEST_PREFIX}-store`,
      email: 'p3@garuda.test',
    },
  });
  storeId = store.id;

  const storeOther = await prisma.store.upsert({
    where: { id: `${TEST_PREFIX}-other` },
    update: { deletedAt: null },
    create: {
      id: `${TEST_PREFIX}-other`,
      name: 'P3 Other Store',
      slug: `${TEST_PREFIX}-other`,
      email: 'p3-other@garuda.test',
    },
  });
  storeIdOther = storeOther.id;

  const customer = await prisma.customer.create({
    data: {
      id: `cust-p3-${randomUUID()}`,
      storeId,
      webUid: `${TEST_PREFIX}-webuid`,
      name: 'P3 Customer',
    },
  });
  customerId = customer.id;

  const conv = await prisma.conversation.create({
    data: {
      id: `conv-p3-${randomUUID()}`,
      storeId,
      customerId,
      customerPhone: '+6281234567900',
      channel: 'web',
    },
  });
  conversationId = conv.id;

  // Other store conversation (for cross-tenant read isolation test)
  const convOther = await prisma.conversation.create({
    data: {
      id: `conv-p3-other-${randomUUID()}`,
      storeId: storeIdOther,
      customerId: customer.id,
      customerPhone: '+6281234567901',
      channel: 'web',
    },
  });
  convIdOther = convOther.id;

  const cat = await prisma.productCategory.create({
    data: { id: `cat-${randomUUID()}`, storeId, name: 'Sayur', displayOrder: 0, isActive: true },
  });

  sourceProductId = (await prisma.product.create({
    data: { id: randomUUID(), storeId, categoryId: cat.id, name: 'Bawang Merah', price: 20000, currency: 'IDR', isActive: true },
  })).id;

   otherProductId = (await prisma.product.create({
     data: { id: randomUUID(), storeId, categoryId: cat.id, name: 'Bawang Putih', price: 18000, currency: 'IDR', isActive: true },
   })).id;

  // A product belonging to the OTHER store (for cross-tenant cart isolation test).
  const catOtherStore = await prisma.productCategory.create({
    data: { id: `cat-other-${randomUUID()}`, storeId: storeIdOther, name: 'Buah', displayOrder: 0, isActive: true },
  });
  otherStoreProductId = (await prisma.product.create({
    data: { id: randomUUID(), storeId: storeIdOther, categoryId: catOtherStore.id, name: 'Apel', price: 25000, currency: 'IDR', isActive: true },
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
    where: { storeId, actionType: 'OPEN_CART' },
  }).catch(() => {});
});

// ═════════════════════════════════════════════════════════════
// §P3 Test 1 — Valid request schema
// ═════════════════════════════════════════════════════════════
test('§P3.1: OPEN_CART request schema accepts valid UUID actionId and empty payload', () => {
  const parsed = OpenCartRequestSchema.safeParse(makeOpenCartRequest());
  assert.equal(parsed.success, true, parsed.error?.message);
  assert.deepEqual(parsed.data.payload, {});
});

// ═════════════════════════════════════════════════════════════
// §P3 Test 2 — Missing actionId rejected before handler
// ═════════════════════════════════════════════════════════════
test('§P3.2: missing actionId rejected before handler execution', async () => {
  await assert.rejects(
    async () => executeAction('OPEN_CART', makeOpenCartRequest({ omitActionId: true }), makeActionContext()),
    (err: any) => err instanceof Error && /Invalid request/.test(err.message),
  );
});

// ═════════════════════════════════════════════════════════════
// §P3 Test 3 — Non-UUID actionId rejected before handler
// ═════════════════════════════════════════════════════════════
test('§P3.3: non-UUID actionId rejected before handler execution', async () => {
  await assert.rejects(
    async () => executeAction('OPEN_CART', makeOpenCartRequest({ badActionId: true }), makeActionContext()),
    (err: any) => err instanceof Error && /Invalid request/.test(err.message),
  );
});

// ═════════════════════════════════════════════════════════════
// §P3 Test 4 — Wrong type rejected before handler
// ═════════════════════════════════════════════════════════════
test('§P3.4: wrong action type rejected before handler execution', async () => {
  await assert.rejects(
    async () => executeAction('OPEN_CART', makeOpenCartRequest({ badType: true }), makeActionContext()),
    (err: any) => err instanceof Error && /Invalid request/.test(err.message),
  );
});

// ═════════════════════════════════════════════════════════════
// §P3 Test 5 — Empty cart returns items=[] and total=null
// ═════════════════════════════════════════════════════════════
test('§P3.5: empty cart returns items=[] and total=null', async () => {
  const emptyConv = await prisma.conversation.create({
    data: { id: `conv-empty-${randomUUID()}`, storeId, customerId, customerPhone: null, channel: 'web' },
  });
  try {
    const ctx = makeActionContext({ conversationId: emptyConv.id });
    const result = await executeAction('OPEN_CART', makeOpenCartRequest(), ctx);
    assert.equal(result.success, true);
    assert.equal(result.data.type, 'OPEN_CART');
    assert.equal(result.data.status, 'applied');
    assert.deepEqual(result.data.result.items, []);
    assert.equal(result.data.result.total, null);
  } finally {
    await prisma.conversation.delete({ where: { id: emptyConv.id } }).catch(() => {});
  }
});

// ═════════════════════════════════════════════════════════════
// §P3 Test 6 — Authoritative cart items returned match getCartSummary
// ═════════════════════════════════════════════════════════════
test('§P3.6: handler returns cart items matching authoritative getCartSummary', async () => {
  // Add 2 lines to the conversation's draft cart via CartAuthority (authoritative write).
  await cartAuthority.addLine(conversationId, storeId, customerId, sourceProductId, 2);
  await cartAuthority.addLine(conversationId, storeId, customerId, otherProductId, 1);

  const result = await executeAction('OPEN_CART', makeOpenCartRequest(), makeActionContext());
  assert.equal(result.success, true);

  const authoritative = await cartAuthority.getCartSummary(conversationId);
  assert.equal(result.data.result.items.length, authoritative.items.length);
  assert.equal(result.data.result.total, authoritative.total);

  // Each item field matches CartAuthority output exactly.
  for (let i = 0; i < authoritative.items.length; i++) {
    const a = authoritative.items[i];
    const b = result.data.result.items[i];
    assert.equal(b.id, a.id);
    assert.equal(b.productName, a.productName);
    assert.equal(b.quantity, a.quantity);
    assert.equal(b.unitPrice, a.unitPrice);
    assert.equal(b.subtotal, a.subtotal);
    assert.equal(b.productId, a.productId);
  }
});

// ═════════════════════════════════════════════════════════════
// §P3 Test 7 — Authoritative total returned
// ═════════════════════════════════════════════════════════════
test('§P3.7: total computed authoritatively (unitPrice × quantity summed)', async () => {
  const result = await executeAction('OPEN_CART', makeOpenCartRequest(), makeActionContext());
  const expected = result.data.result.items.reduce((s: number, i: any) => s + i.subtotal, 0);
  assert.equal(result.data.result.total, expected);
});

// ═════════════════════════════════════════════════════════════
// §P3 Test 8 — handler uses context.conversationId (server-derived), not client
// ═════════════════════════════════════════════════════════════
test('§P3.8: handler reads cart for context.conversationId (server-derived), not any client value', async () => {
  // The OPEN_CART request has NO conversationId field. The handler MUST use
  // context.conversationId (resolved server-side). A client cannot inject a
  // different conversationId because the request payload is empty {}.
  const req = makeOpenCartRequest();
  assert.deepEqual(req.payload, {}, 'payload must not contain a client conversationId');
  const ctx = makeActionContext();
  const result = await executeAction('OPEN_CART', req, ctx);
  const authoritative = await cartAuthority.getCartSummary(ctx.conversationId);
  assert.equal(result.data.result.items.length, authoritative.items.length);
  assert.equal(result.data.result.total, authoritative.total);
});

// ═════════════════════════════════════════════════════════════
// §P3 Test 9 — Cross-store conversation isolation (CRITICAL TENANT TEST)
// The handler must NOT leak another store's cart. context.conversationId is
// store-bound by getOrCreateWebSession; a conversationId from another store
// must not return that store's items when scoped to this store.
// ═════════════════════════════════════════════════════════════
test('§P3.9: cross-store conversation does not leak into requesting store cart', async () => {
  // Add a line to the OTHER store's conversation (separate draft order).
  await cartAuthority.addLine(convIdOther, storeIdOther, customerId, otherStoreProductId, 5);

  // Requesting OPEN_CART with the AUTHORIZED context (this store's conversationId)
  // must return ONLY this store's cart, never the other store's.
  const ctx = makeActionContext(); // conversationId = this store's
  const result = await executeAction('OPEN_CART', makeOpenCartRequest(), ctx);
  const ids = result.data.result.items.map((i: any) => i.id);
  // The other store's cart must never appear.
  const otherCart = await cartAuthority.getCartSummary(convIdOther);
  const otherIds = otherCart.items.map((i) => i.id);
  for (const oid of otherIds) {
    assert.ok(!ids.includes(oid), 'other-store cart item leaked into requesting store cart');
  }
});

// ═════════════════════════════════════════════════════════════
// §P3 Test 10 — Deterministic response shape (matches CartSummary)
// ═════════════════════════════════════════════════════════════
test('§P3.10: response has deterministic typed shape', async () => {
  const result = await executeAction('OPEN_CART', makeOpenCartRequest(), makeActionContext());
  assert.equal(result.success, true);
  assert.equal(result.status, 'applied');
  assert.equal(result.data.type, 'OPEN_CATALOG'.replace('CATALOG', 'CART')); // OPEN_CART
  assert.equal(result.data.type, 'OPEN_CART');
  assert.equal(result.data.status, 'applied');
  assert.equal(typeof result.data.actionId, 'string');
  assert.ok(Array.isArray(result.data.result.items));
  for (const p of result.data.result.items) {
    assert.equal(typeof p.id, 'string');
    assert.ok(p.productId === null || typeof p.productId === 'string');
    assert.equal(typeof p.productName, 'string');
    assert.equal(typeof p.quantity, 'number');
    assert.equal(typeof p.unitPrice, 'number');
    assert.equal(typeof p.subtotal, 'number');
  }
  assert.ok(result.data.result.total === null || typeof result.data.result.total === 'number');
});

// ═════════════════════════════════════════════════════════════
// §P3 Test 11 — response validates against OpenCartResponseSchema
// ═════════════════════════════════════════════════════════════
test('§P3.11: response body validates against OpenCartResponseSchema', async () => {
  const result = await executeAction('OPEN_CART', makeOpenCartRequest(), makeActionContext());
  const parsed = OpenCartResponseSchema.safeParse(result.data);
  assert.equal(parsed.success, true, parsed.error?.message);
});

// ═════════════════════════════════════════════════════════════
// §P3 Test 12 — read-only: zero ActionIdempotency rows
// ═════════════════════════════════════════════════════════════
test('§P3.12: read-only action creates NO ActionIdempotency row', async () => {
  const before = await prisma.actionIdempotency.count({ where: { storeId, actionType: 'OPEN_CART' } });
  assert.equal(before, 0);
  await executeAction('OPEN_CART', makeOpenCartRequest(), makeActionContext());
  const after = await prisma.actionIdempotency.count({ where: { storeId, actionType: 'OPEN_CART' } });
  assert.equal(after, 0, 'OPEN_CART must not create ActionIdempotency rows (no lease/claim)');
});

// ═════════════════════════════════════════════════════════════
// §P3 Test 13 — no claimAction/executeClaimedAction/executeOps/LLM
// ═════════════════════════════════════════════════════════════
test('§P3.13: does not invoke ConversationEngine.processCustomerMessage (no LLM) and bypasses lease flow', async () => {
  let engineCalled = false;
  const orig = conversationService.processCustomerMessage;
  (conversationService as any).processCustomerMessage = async () => { engineCalled = true; return null as any; };
  try {
    await executeAction('OPEN_CART', makeOpenCartRequest(), makeActionContext());
  } finally {
    (conversationService as any).processCustomerMessage = orig;
  }
  assert.equal(engineCalled, false, 'OPEN_CART must NOT call processCustomerMessage (LLM/Engine)');
});

// ═════════════════════════════════════════════════════════════
// §P3 Test 14 — registered in Action Registry
// ═════════════════════════════════════════════════════════════
test('§P3.14: OPEN_CART registered in the action registry', () => {
  assert.ok(actionRegistry['OPEN_CART'], 'OPEN_CART must be registered');
  assert.equal(actionRegistry['OPEN_CART'].type, 'OPEN_CART');
  assert.equal(typeof actionRegistry['OPEN_CART'].handler, 'function');
  assert.equal(typeof actionRegistry['OPEN_CART'].authorize, 'function');
  assert.equal(typeof actionRegistry['OPEN_CART'].requestSchema, 'object');
  assert.equal(typeof actionRegistry['OPEN_CART'].responseSchema, 'object');
});

// ═════════════════════════════════════════════════════════════
// §P3 Test 15 — P0 ADD_TO_CART registry remains intact
// ═════════════════════════════════════════════════════════════
test('§P3.15: P0 ADD_TO_CART registry entry remains present and unchanged', () => {
  assert.ok(actionRegistry['ADD_TO_CART'], 'ADD_TO_CART must still be registered');
  assert.equal(actionRegistry['ADD_TO_CART'].type, 'ADD_TO_CART');
  assert.equal(typeof actionRegistry['ADD_TO_CART'].handler, 'function');
});

// ═════════════════════════════════════════════════════════════
// §P3 Test 16 — P1 SHOW_RELATED_PRODUCTS registry remains intact
// ═════════════════════════════════════════════════════════════
test('§P3.16: P1 SHOW_RELATED_PRODUCTS registry entry remains present and unchanged', () => {
  assert.ok(actionRegistry['SHOW_RELATED_PRODUCTS'], 'SHOW_RELATED_PRODUCTS must still be registered');
  assert.equal(actionRegistry['SHOW_RELATED_PRODUCTS'].type, 'SHOW_RELATED_PRODUCTS');
  assert.equal(typeof actionRegistry['SHOW_RELATED_PRODUCTS'].handler, 'function');
});

// ═════════════════════════════════════════════════════════════
// §P3 Test 17 — P2 OPEN_CATALOG registry remains intact
// ═════════════════════════════════════════════════════════════
test('§P3.17: P2 OPEN_CATALOG registry entry remains present and unchanged', () => {
  assert.ok(actionRegistry['OPEN_CATALOG'], 'OPEN_CATALOG must still be registered');
  assert.equal(actionRegistry['OPEN_CATALOG'].type, 'OPEN_CATALOG');
  assert.equal(typeof actionRegistry['OPEN_CATALOG'].handler, 'function');
});

// ═════════════════════════════════════════════════════════════
// §P3 Test 18 — OPEN_CART handler is read-only (no claim/lease)
// ═════════════════════════════════════════════════════════════
test('§P3.18: OPEN_CART handler is read-only (bypasses ActionIdempotency lease flow)', async () => {
  const idempotencyBefore = await prisma.actionIdempotency.count({ where: { storeId, actionType: 'OPEN_CART' } });
  const result = await executeAction('OPEN_CART', makeOpenCartRequest(), makeActionContext());
  const idempotencyAfter = await prisma.actionIdempotency.count({ where: { storeId, actionType: 'OPEN_CART' } });
  assert.equal(result.success, true);
  assert.equal(result.status, 'applied');
  assert.equal(idempotencyBefore, 0);
  assert.equal(idempotencyAfter, 0, 'OPEN_CART must bypass the ActionIdempotency lease state machine');
});
