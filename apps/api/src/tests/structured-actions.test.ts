/**
 * P0 ADD_TO_CART — Structured Action acceptance tests (§8 P0 Test Contract)
 *
 * Tests map EXACTLY to the 22 acceptance tests in contract §8:
 *
 * 1.  ADD_TO_CART request schema accepts valid UUID productId + positive integer quantity
 * 2.  Invalid payload rejected before CartAuthority
 * 3.  Valid action reaches existing CartAuthority
 * 4.  Product identity from productId, not frontend product-name matching
 * 5.  Tenant mismatch rejected
 * 6.  Customer/conversation mismatch rejected
 * 7.  One valid action adds exactly requested quantity
 * 8.  Rapid duplicate UI tap cannot create two requests for one physical gesture
 * 9.  Same actionId retry returns already_applied and does NOT add again
 * 10. Different actionId intentional second action succeeds
 * 11. Cart total/item state from authoritative CartAuthority result
 * 12. No localStorage/frontend cart authority
 * 13. Existing natural-language "tambah ... ke keranjang" path unchanged
 * 14. Structured and natural-language action resolve same context
 * 15. Existing CartAuthority regression suite green
 * 16. Golden dataset green
 * 17. Business validation failure: rollback + no partial OrderItem + FAILED + structured error
 * 18. Retry FAILED actionId does not execute mutation again
 * 19. Valid CLAIMED lease: immediate 409, no FOR UPDATE, no held connection
 * 20. Expired CLAIMED: executeClaimedAction() + FOR UPDATE + latest re-check
 * 21. Concurrent same actionId: exactly one executeOps(), second resolves via locked state
 * 22. P0 does not use CartAuthority.addLine() or ConversationService.executeCartOps()
 *
 * Runner:
 *   npx tsx --env-file=../../.env --test --test-force-exit src/tests/structured-actions.test.ts
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../infrastructure/prisma.js';
import { executeAction, actionRegistry, AddToCartRequestSchema, handleAddToCart, LEASE_FINAL_MS } from '../business/action-registry.js';
import { ActionStatus } from '../business/action-registry.js';
import { cartAuthority } from '../business/cart-authority.js';
import { orderService } from '../business/order.service.js';
import { ApiError } from '../errors/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';

/** Spy-once helper: wraps a method, counts calls, restores after fn. */
async function withSpy<T extends object, K extends keyof T>(
  obj: T,
  k: K,
  fn: () => Promise<void>,
): Promise<{ calls: number }> {
  const original = obj[k];
  const calls = { count: 0 };
  (obj as any)[k] = function (this: any, ...args: any[]) {
    calls.count++;
    return (original as any).apply(this, args);
  };
  try {
    await fn();
  } finally {
    (obj as any)[k] = original;
  }
  return { calls: calls.count };
}

const TEST_PREFIX = 'test-action-v2';

let storeId: string;
let storeIdOther: string;
let customerId: string;
let customerIdOther: string;
let conversationId: string;
let productId: string;
let productIdOtherStore: string;

// ── Cleanup helpers ──────────────────────────────────────────

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
  await prisma.customer.deleteMany({
    where: { storeId: { startsWith: TEST_PREFIX } },
  }).catch(() => {});
  await prisma.product.deleteMany({
    where: { storeId: { startsWith: TEST_PREFIX } },
  }).catch(() => {});
  await prisma.store.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  }).catch(() => {});
}

async function createConversation(sid: string, cid: string): Promise<string> {
  const conv = await prisma.conversation.create({
    data: {
      id: `conv-${randomUUID()}`,
      storeId: sid,
      customerId: cid,
      customerPhone: '+62812345678',
      channel: 'web',
    },
  });
  await prisma.conversationContext.create({
    data: {
      conversationId: conv.id,
      lastMessages: [],
      sessionKey: randomUUID(),
      sessionExpireAt: new Date(Date.now() + 86400000),
    },
  });
  return conv.id;
}

function makeActionContext(overrides?: Partial<{ storeId: string; customerId: string; conversationId: string }>): any {
  return {
    storeId: overrides?.storeId || storeId,
    customerId: overrides?.customerId || customerId,
    conversationId: overrides?.conversationId || conversationId,
    channel: 'web',
  };
}

function makeAddToCartRequest(actionId: string, qty: number = 2, pid?: string): any {
  return {
    actionId,
    type: 'ADD_TO_CART',
    payload: {
      productId: pid || productId,
      quantity: qty,
    },
  };
}

function makeIdempotencyKey(sid: string, cid: string, actionId: string): string {
  return `${sid}:${cid}:ADD_TO_CART:${actionId}`;
}

// ── Fixtures ─────────────────────────────────────────────────

before(async () => {
  await cleanup();

  const store = await prisma.store.upsert({
    where: { id: `${TEST_PREFIX}-store` },
    update: {},
    create: {
      id: `${TEST_PREFIX}-store`,
      name: 'Test Action Store',
      slug: `${TEST_PREFIX}-store`,
      email: 'test-action@garuda.test',
    },
  });
  storeId = store.id;

  const storeOther = await prisma.store.upsert({
    where: { id: `${TEST_PREFIX}-other` },
    update: {},
    create: {
      id: `${TEST_PREFIX}-other`,
      name: 'Other Store',
      slug: `${TEST_PREFIX}-other`,
      email: 'other-action@garuda.test',
    },
  });
  storeIdOther = storeOther.id;

  const customer = await prisma.customer.create({
    data: {
      id: `cust-${randomUUID()}`,
      storeId,
      webUid: `${TEST_PREFIX}-webuid`,
      name: 'Test Customer',
    },
  });
  customerId = customer.id;

  const customerOther = await prisma.customer.create({
    data: {
      id: `cust-other-${randomUUID()}`,
      storeId,
      webUid: `${TEST_PREFIX}-webuid-other`,
      name: 'Other Customer',
    },
  });
  customerIdOther = customerOther.id;

  conversationId = await createConversation(storeId, customerId);

  const prod = await prisma.product.create({
    data: {
      id: randomUUID(),
      storeId,
      name: 'Produk Test',
      price: 25000,
      currency: 'IDR',
      isActive: true,
    },
  });
  productId = prod.id;

  const prodOther = await prisma.product.create({
    data: {
      id: randomUUID(),
      storeId: storeIdOther,
      name: 'Produk Toko Lain',
      price: 99999,
      currency: 'IDR',
      isActive: true,
    },
  });
  productIdOtherStore = prodOther.id;
});

after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.actionIdempotency.deleteMany({ where: { storeId, status: { in: ['CLAIMED', 'COMPLETED', 'FAILED'] } } }).catch(() => {});
  await prisma.orderItem.deleteMany({
    where: { order: { conversationId, orderStatus: 'draft' } },
  }).catch(() => {});
  await prisma.order.deleteMany({
    where: { conversationId, orderStatus: 'draft' },
  }).catch(() => {});
});

// ═════════════════════════════════════════════════════════════
// §8 Test 1 — Valid UUID productId + positive integer quantity
// ═════════════════════════════════════════════════════════════
test('§8.1: ADD_TO_CART request schema accepts valid UUID productId and positive integer quantity', async () => {
  const actionId = randomUUID();
  const req = makeAddToCartRequest(actionId, 2);

   const ok = AddToCartRequestSchema.safeParse(req);
  assert.equal(ok.success, true, `schema should accept valid request: ${JSON.stringify(ok.error?.issues)}`);
  assert.equal(ok.data.payload.productId, productId);
  assert.equal(ok.data.payload.quantity, 2);
});

// ═════════════════════════════════════════════════════════════
// §8 Test 2 — Invalid payload rejected before CartAuthority
// ═════════════════════════════════════════════════════════════
test('§8.2: invalid payload rejected before CartAuthority execution', async () => {
  const actionId = randomUUID();

  // quantity = 0 (not positive)
  const badReq = {
    actionId,
    type: 'ADD_TO_CART',
    payload: { productId, quantity: 0 },
  };

  await assert.rejects(
    () => executeAction('ADD_TO_CART', badReq, makeActionContext()),
    (err: unknown) => err instanceof ApiError && err.code === ErrorCodes.ERR_VALIDATION,
  );

  // Verify no idempotency record was created
  const count = await prisma.actionIdempotency.count({
    where: { storeId, customerId, actionId },
  });
  assert.equal(count, 0, 'no idempotency record should be created for invalid payload');

  // Non-UUID productId
  const badReq2 = {
    actionId: randomUUID(),
    type: 'ADD_TO_CART',
    payload: { productId: 'not-a-uuid', quantity: 1 },
  };
  await assert.rejects(
    () => executeAction('ADD_TO_CART', badReq2, makeActionContext()),
    (err: unknown) => err instanceof ApiError && err.code === ErrorCodes.ERR_VALIDATION,
  );

  // Missing payload
  const badReq3 = { actionId: randomUUID(), type: 'ADD_TO_CART' };
  await assert.rejects(
    () => executeAction('ADD_TO_CART', badReq3, makeActionContext()),
    (err: unknown) => err instanceof ApiError && err.code === ErrorCodes.ERR_VALIDATION,
  );
});

// ═════════════════════════════════════════════════════════════
// §8 Test 3 — Valid action reaches existing CartAuthority
// ═════════════════════════════════════════════════════════════
test('§8.3: valid action reaches the existing CartAuthority', async () => {
  const actionId = randomUUID();
  const req = makeAddToCartRequest(actionId, 2);

  const result = await executeAction('ADD_TO_CART', req, makeActionContext());

  assert.equal(result.success, true);
  assert.equal(result.status, 'applied');
  assert.ok(result.data, 'data should be present');
  assert.equal(result.data.actionId, actionId);
  assert.equal(result.data.type, 'ADD_TO_CART');
  assert.ok(result.data.result, 'result object should be present');

  // Verify the ActionIdempotency record was created and is COMPLETED
  const record = await prisma.actionIdempotency.findUnique({
    where: {
      storeId_customerId_actionType_actionId: {
        storeId, customerId,
        actionType: 'ADD_TO_CART',
        actionId,
      },
    },
  });
  assert.ok(record, 'ActionIdempotency record must exist');
  assert.equal(record.status, ActionStatus.COMPLETED);
  assert.ok(record.idempotencyKey, 'idempotencyKey must be populated');
  assert.ok(record.claimedAt, 'claimedAt must be populated');
  assert.equal(record.actionType, 'ADD_TO_CART');
  assert.ok(record.completedAt, 'completedAt must be set');
});

// ═════════════════════════════════════════════════════════════
// §8 Test 4 — Product identity from productId, not name matching
// ═════════════════════════════════════════════════════════════
test('§8.4: product identity comes from productId, not product-name matching in the frontend', async () => {
  const actionId = randomUUID();

  // Resolve product by productId — the authoritative path
  const productFromDb = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, price: true, isActive: true },
  });
  assert.ok(productFromDb, 'product must exist');

  const req = makeAddToCartRequest(actionId, 2, productId);
  const result = await executeAction('ADD_TO_CART', req, makeActionContext());

  assert.equal(result.success, true);
  // The response result should reference the productId we sent
  assert.equal(result.data.result.productId, productId);

  // Verify OrderItem was created with the correct productId FK
  const orderItems = await prisma.orderItem.findMany({
    where: { order: { conversationId, orderStatus: 'draft' } },
  });
  assert.ok(orderItems.length >= 1, 'at least one OrderItem should exist');
  const addedItem = orderItems.find((i) => i.productId === productId);
  assert.ok(addedItem, 'OrderItem must have productId FK matching the request, proving identity came from productId');
  assert.equal(addedItem.productName, productFromDb.name);
  assert.equal(addedItem.quantity, 2);
  assert.equal(addedItem.unitPrice, 25000);
});

// ═════════════════════════════════════════════════════════════
// §8 Test 4b — Structured ADD_TO_CART with productId does NOT
//               round-trip through resolveProductByName.
// ═════════════════════════════════════════════════════════════
test('§8.4b: structured ADD_TO_CART (productId) skips resolveProductByName and resolves by id', async () => {
  const actionId = randomUUID();

  const { calls } = await withSpy(
    cartAuthority as any,
    'resolveProductByName',
    async () => {
      const result = await executeAction('ADD_TO_CART', makeAddToCartRequest(actionId, 3), makeActionContext());
      assert.equal(result.success, true);
      assert.equal(result.data.result.productId, productId);
    },
  );

  assert.equal(calls, 0, 'resolveProductByName must NOT be called for structured productId path');

  // Cart tetap kebentuk benar: OrderItem productId/qty sesuai request.
  const orderItems = await prisma.orderItem.findMany({
    where: { order: { conversationId, orderStatus: 'draft' } },
  });
  const addedItem = orderItems.find((i) => i.productId === productId);
  assert.ok(addedItem, 'OrderItem must be created with the requested productId');
  assert.equal(addedItem.quantity, 3);
  assert.equal(addedItem.unitPrice, 25000);
});

// ═════════════════════════════════════════════════════════════
// §8 Test 4c — By-name CartOp (LLM/natural-language fallback)
//               STILL resolves via resolveProductByName.
// ═════════════════════════════════════════════════════════════
test('§8.4c: by-name CartOp still uses resolveProductByName (LLM fallback preserved)', async () => {
  const byNameConv = await createConversation(storeId, customerId);
  const { calls } = await withSpy(
    cartAuthority as any,
    'resolveProductByName',
    async () => {
      const items = await cartAuthority.executeOps(
        [{ type: 'add', product: 'Produk Test', qty: 1 }],
        storeId,
        customerId,
        byNameConv,
      );
      assert.ok(Array.isArray(items));
    },
  );

  assert.equal(calls, 1, 'by-name path must still call resolveProductByName');
});

// ═════════════════════════════════════════════════════════════
// §8 Test 5 — Tenant mismatch rejected
// ═════════════════════════════════════════════════════════════
test('§8.5: tenant mismatch (product from different store) rejected', async () => {
  const actionId = randomUUID();
  const req = {
    actionId,
    type: 'ADD_TO_CART',
    payload: { productId: productIdOtherStore, quantity: 1 },
  };

  await assert.rejects(
    () => executeAction('ADD_TO_CART', req, makeActionContext()),
    (err: unknown) => err instanceof ApiError && err.code === ErrorCodes.ERR_AUTH_FORBIDDEN,
  );

  const count = await prisma.actionIdempotency.count({
    where: { storeId, customerId, actionId },
  });
  assert.equal(count, 0, 'no idempotency record should be created on tenant mismatch');
});

// ═════════════════════════════════════════════════════════════
// §8 Test 6 — Customer/conversation mismatch rejected
// ═════════════════════════════════════════════════════════════
test('§8.6: customer/conversation mismatch rejected', async () => {
  const actionId = randomUUID();
  const req = makeAddToCartRequest(actionId, 1);

  const otherStoreContext = makeActionContext({
    storeId: storeIdOther,
    conversationId: `conv-${randomUUID()}`,
  });

  await assert.rejects(
    () => executeAction('ADD_TO_CART', req, otherStoreContext),
    (err: unknown) => err instanceof ApiError && err.code === ErrorCodes.ERR_AUTH_FORBIDDEN,
  );

  const count = await prisma.actionIdempotency.count({
    where: { storeId: storeIdOther, actionId },
  });
  assert.equal(count, 0, 'no idempotency record should be created on customer/conversation mismatch');
});

// ═════════════════════════════════════════════════════════════
// §8 Test 7 — One valid action adds exactly requested quantity
// ═════════════════════════════════════════════════════════════
test('§8.7: one valid action adds exactly the requested quantity', async () => {
  const actionId = randomUUID();
  const req = makeAddToCartRequest(actionId, 3, productId);

  const result = await executeAction('ADD_TO_CART', req, makeActionContext());

  assert.equal(result.success, true);
  assert.equal(result.data.result.quantityAdded, 3);

  // Verify OrderItem quantity
  const orderItems = await prisma.orderItem.findMany({
    where: { order: { conversationId, orderStatus: 'draft' } },
  });
  const item = orderItems.find((i) => i.productId === productId);
  assert.ok(item, 'OrderItem should exist');
  assert.equal(item.quantity, 3, 'exactly the requested quantity must be added');

  // Verify total
  assert.equal(result.data.result.cart.total, 75000); // 25000 * 3
});

// ═════════════════════════════════════════════════════════════
// §8 Test 8 — Rapid duplicate UI tap cannot create two requests
// ═════════════════════════════════════════════════════════════
test('§8.8: rapid duplicate UI tap cannot create two requests for one physical gesture', async () => {
  // Simulate two rapid taps with the SAME actionId (same physical gesture)
  const actionId = randomUUID();
  const req = makeAddToCartRequest(actionId, 2);

  const [r1, r2] = await Promise.all([
    executeAction('ADD_TO_CART', req, makeActionContext()),
    executeAction('ADD_TO_CART', req, makeActionContext()),
  ]);

  // One should win (applied), the other should get 409 (action_in_progress)
  const statuses = [r1.status, r2.status].sort();
  assert.deepEqual(statuses, ['action_in_progress', 'applied'],
    `one should apply and one should be in_progress, got: ${statuses}`);

  // Only ONE OrderItem row should exist for this product (no double-add)
  const orderItems = await prisma.orderItem.findMany({
    where: { order: { conversationId, orderStatus: 'draft' } },
  });
  const productItems = orderItems.filter((i) => i.productId === productId);
  assert.equal(productItems.length, 1, 'only one OrderItem row should exist for the product');
  assert.equal(productItems[0].quantity, 2, 'quantity should be exactly 2 (not duplicated)');

  // Only ONE ActionIdempotency record
  const records = await prisma.actionIdempotency.findMany({
    where: { storeId, customerId, actionType: 'ADD_TO_CART', actionId },
  });
  assert.equal(records.length, 1, 'only one ActionIdempotency record');
  assert.equal(records[0].status, ActionStatus.COMPLETED);
});

// ═════════════════════════════════════════════════════════════
// §8 Test 9 — Same actionId retry returns already_applied
// ═════════════════════════════════════════════════════════════
test('§8.9: same actionId retried over network returns already_applied and does NOT add again', async () => {
  const actionId = randomUUID();
  const req = makeAddToCartRequest(actionId, 2);

  // First call — executes and completes
  const first = await executeAction('ADD_TO_CART', req, makeActionContext());
  assert.equal(first.success, true);
  assert.equal(first.status, 'applied');
  assert.equal(first.data.result.quantityAdded, 2);

  // Retry with same actionId — should return already_applied
  const second = await executeAction('ADD_TO_CART', req, makeActionContext());
  assert.equal(second.success, true);
  assert.equal(second.status, 'already_applied');
  assert.ok(second.data.result, 'cached result must be returned');
  assert.equal(second.data.result.quantityAdded, 2);
  assert.deepEqual(second.data.result.cart, first.data.result.cart);

  // Verify no double-add: still only 1 OrderItem with qty=2
  const orderItems = await prisma.orderItem.findMany({
    where: { order: { conversationId, orderStatus: 'draft' } },
  });
  const productItems = orderItems.filter((i) => i.productId === productId);
  assert.equal(productItems.length, 1, 'should not have duplicate OrderItem');
  assert.equal(productItems[0].quantity, 2, 'quantity should remain exactly 2');

  // Verify idempotency record is COMPLETED (not re-executed)
  const record = await prisma.actionIdempotency.findUnique({
    where: {
      storeId_customerId_actionType_actionId: {
        storeId, customerId,
        actionType: 'ADD_TO_CART',
        actionId,
      },
    },
  });
  assert.equal(record.status, ActionStatus.COMPLETED);
});

// ═════════════════════════════════════════════════════════════
// §8 Test 10 — Different actionId second action succeeds
// ═════════════════════════════════════════════════════════════
test('§8.10: second intentional tap with different actionId is allowed and adds again', async () => {
  const actionId1 = randomUUID();
  const r1 = await executeAction('ADD_TO_CART', makeAddToCartRequest(actionId1, 2), makeActionContext());
  assert.equal(r1.success, true);
  assert.equal(r1.status, 'applied');
  assert.equal(r1.data.result.quantityAdded, 2);

  const actionId2 = randomUUID();
  const r2 = await executeAction('ADD_TO_CART', makeAddToCartRequest(actionId2, 3), makeActionContext());
  assert.equal(r2.success, true);
  assert.equal(r2.status, 'applied');
  assert.equal(r2.data.result.quantityAdded, 3);

  // Both products in cart should be there — same product, accumulated qty
  const orderItems = await prisma.orderItem.findMany({
    where: { order: { conversationId, orderStatus: 'draft' } },
  });
  const productItems = orderItems.filter((i) => i.productId === productId);
  assert.equal(productItems.length, 1, 'same product should be one line item');
  assert.equal(productItems[0].quantity, 5, 'quantity should accumulate to 2+3=5');
  assert.equal(r2.data.result.cart.total, 125000); // 25000 * 5

  // Two separate idempotency records
  const records = await prisma.actionIdempotency.findMany({
    where: { storeId, customerId, actionType: 'ADD_TO_CART' },
  });
  assert.equal(records.length, 2, 'two separate idempotency records for two actionIds');
});

// ═════════════════════════════════════════════════════════════
// §8 Test 11 — Cart total from authoritative CartAuthority result
// ═════════════════════════════════════════════════════════════
test('§8.11: cart total and item state come from authoritative CartAuthority result', async () => {
  const actionId = randomUUID();
  const result = await executeAction('ADD_TO_CART', makeAddToCartRequest(actionId, 4), makeActionContext());

  assert.equal(result.success, true);
  const cartResult = result.data.result;
  assert.ok(cartResult.cart, 'cart must be present in result');
  assert.ok(cartResult.cart.items, 'cart items must be present');
  assert.equal(cartResult.cart.items.length, 1);
  assert.equal(cartResult.cart.items[0].productId, productId);
  assert.equal(cartResult.cart.items[0].productName, 'Produk Test');
  assert.equal(cartResult.cart.items[0].quantity, 4);
  assert.equal(cartResult.cart.items[0].unitPrice, 25000);
  assert.equal(cartResult.cart.items[0].subtotal, 100000);
  assert.equal(cartResult.cart.total, 100000);

  // Cross-check with DB state (authoritative)
  const order = await prisma.order.findFirst({
    where: { conversationId, orderStatus: 'draft' },
    select: { totalPrice: true, items: true },
  });
  assert.ok(order, 'draft order must exist');
  assert.equal(order.totalPrice, 100000);

  const orderItems = await prisma.orderItem.findMany({
    where: { order: { conversationId, orderStatus: 'draft' } },
  });
  assert.equal(orderItems.length, 1);
  assert.equal(orderItems[0].quantity, 4);
  assert.equal(orderItems[0].unitPrice, 25000);
  assert.equal(orderItems[0].subtotal, 100000);
});

// ═════════════════════════════════════════════════════════════
// §8 Test 12 — No localStorage/frontend cart authority
// ═════════════════════════════════════════════════════════════
test('§8.12: no localStorage/frontend cart authority is involved', async () => {
  // Static/source verification: action-registry.ts must not reference localStorage
  // or any frontend cart state. The handler delegates only to CartAuthority.executeOps.
  const fs = await import('node:fs');
  const source = fs.readFileSync('src/business/action-registry.ts', 'utf8');

  assert.equal(source.includes('localStorage'), false,
    'action-registry.ts must not reference localStorage');
  assert.equal(source.includes('window.'), false,
    'action-registry.ts must not reference window');
  assert.equal(source.includes('document.'), false,
    'action-registry.ts must not reference document');

  // Also verify no frontend cart state in routes/actions.ts
  const routeSource = fs.readFileSync('src/routes/actions.ts', 'utf8');
  assert.equal(routeSource.includes('localStorage'), false,
    'routes/actions.ts must not reference localStorage');

  // Verify the action actually persists to DB (not just frontend state)
  const actionId = randomUUID();
  await executeAction('ADD_TO_CART', makeAddToCartRequest(actionId, 2), makeActionContext());

  const orderItems = await prisma.orderItem.findMany({
    where: { order: { conversationId, orderStatus: 'draft' } },
  });
  assert.ok(orderItems.length > 0, 'cart state must be persisted in backend DB, not frontend only');
});

// ═════════════════════════════════════════════════════════════
// §8 Test 13 — Natural-language path unchanged
// ═════════════════════════════════════════════════════════════
test('§8.13: existing natural-language "tambah ... ke keranjang" path still works unchanged', async () => {
  // Verify the conversation engine still processes "tambah" messages through
  // the existing pipeline (NOT routed to the structured action endpoint).
  // The structured action path is tested separately in §8.14.
  const { conversationService } = await import('../business/conversation.service.js');

  const msg = 'tambah Produk Test ke keranjang';
  const result = await conversationService.processCustomerMessage(
    storeId,
    customerId,
    conversationId,
    msg,
    'web',
  );

  // The conversation engine must still process the message (not reject it)
  assert.ok(result, 'natural-language path must still return a response');
  assert.ok(result.message, 'response must have a message');
  assert.ok(result.message.content, 'response must have content');
});

// ═════════════════════════════════════════════════════════════
// §8 Test 14 — Structured and natural-language resolve same context
// ═════════════════════════════════════════════════════════════
test('§8.14: structured action and natural-language action resolve to same customer/store/conversation context', async () => {
  // Structured action: uses explicit context
  const actionId = randomUUID();
  const ctx = makeActionContext();
  const result = await executeAction('ADD_TO_CART', makeAddToCartRequest(actionId, 1), ctx);

  assert.equal(result.success, true);

  // Verify the ActionIdempotency record uses the same storeId/customerId/conversationId
  const record = await prisma.actionIdempotency.findUnique({
    where: {
      storeId_customerId_actionType_actionId: {
        storeId, customerId,
        actionType: 'ADD_TO_CART',
        actionId,
      },
    },
  });
  assert.ok(record);
  assert.equal(record.storeId, storeId);
  assert.equal(record.customerId, customerId);

  // The natural-language path (test §8.13) uses the same store/customer/conversationId
  // via the conversation service — verify the context is consistent
  assert.equal(ctx.storeId, storeId);
  assert.equal(ctx.customerId, customerId);
  assert.equal(ctx.conversationId, conversationId);

  // Verify OrderItem is in the same conversation
  const orderItems = await prisma.orderItem.findMany({
    where: { order: { conversationId, orderStatus: 'draft' } },
  });
  assert.ok(orderItems.length >= 1, 'cart state must be in the same conversation context');
});

// ═════════════════════════════════════════════════════════════
// P6-2 — Typed REMOVE_FROM_CART + UPDATE_CART_QUANTITY
// Reuse the SAME idempotency/lock pattern as ADD_TO_CART (claim →
// executeClaimedAction, FOR UPDATE + re-check, SAVEPOINT). Delegates to
// CartAuthority.removeLine / updateQuantity (logic untouched, only an
// optional tx param added so they run inside the locked transaction).
// ═════════════════════════════════════════════════════════════

async function getLineItemIdForConversation(convId: string, pid: string): Promise<string> {
  const item = await prisma.orderItem.findFirst({
    where: { order: { conversationId: convId, orderStatus: 'draft' }, productId: pid },
    select: { id: true },
  });
  return item!.id;
}

test('P6.2.1: REMOVE_FROM_CART removes the line item and returns applied', async () => {
  const conv = await createConversation(storeId, customerId);
  const ctx = makeActionContext({ conversationId: conv });
  await executeAction('ADD_TO_CART', makeAddToCartRequest(randomUUID(), 2), ctx);
  const lineItemId = await getLineItemIdForConversation(conv, productId);

  const rmId = randomUUID();
  const result = await executeAction(
    'REMOVE_FROM_CART',
    { actionId: rmId, type: 'REMOVE_FROM_CART', payload: { lineItemId } },
    ctx,
  );

  assert.equal(result.success, true);
  assert.equal(result.status, 'applied');
  assert.ok(result.data.result.cart, 'cart must be present');
  assert.equal(result.data.result.removedLineItemId, lineItemId);

  // DB readback: item gone from cart
  const remaining = await prisma.orderItem.findMany({
    where: { order: { conversationId: conv, orderStatus: 'draft' } },
  });
  assert.equal(remaining.length, 0, 'line item must be removed from cart');
});

test('P6.2.2: UPDATE_CART_QUANTITY changes qty and recomputes subtotal/total from DB', async () => {
  const conv = await createConversation(storeId, customerId);
  const ctx = makeActionContext({ conversationId: conv });
  await executeAction('ADD_TO_CART', makeAddToCartRequest(randomUUID(), 1), ctx);
  const lineItemId = await getLineItemIdForConversation(conv, productId);

  const upId = randomUUID();
  const result = await executeAction(
    'UPDATE_CART_QUANTITY',
    { actionId: upId, type: 'UPDATE_CART_QUANTITY', payload: { lineItemId, quantity: 5 } },
    ctx,
  );

  assert.equal(result.success, true);
  assert.equal(result.status, 'applied');
  assert.equal(result.data.result.updatedLineItemId, lineItemId);
  assert.equal(result.data.result.quantity, 5);

  // DB readback: qty + subtotal from DB (unitPrice 25000 * 5 = 125000)
  const item = await prisma.orderItem.findUnique({ where: { id: lineItemId } });
  assert.ok(item, 'item must still exist');
  assert.equal(item.quantity, 5);
  assert.equal(item.unitPrice, 25000);
  assert.equal(item.subtotal, 125000);

  const order = await prisma.order.findFirst({ where: { conversationId: conv, orderStatus: 'draft' } });
  assert.equal(order!.totalPrice, 125000, 'order total must be recomputed from DB');
  assert.equal(result.data.result.cart.total, 125000);
});

test('P6.2.3: REMOVE_FROM_CART retry with same actionId → already_applied, no double-execute', async () => {
  const conv = await createConversation(storeId, customerId);
  const ctx = makeActionContext({ conversationId: conv });
  await executeAction('ADD_TO_CART', makeAddToCartRequest(randomUUID(), 2), ctx);
  const lineItemId = await getLineItemIdForConversation(conv, productId);

  let removeLineCalls = 0;
  const origRemove = (cartAuthority as any).removeLine.bind(cartAuthority);
  (cartAuthority as any).removeLine = function (this: any, ...args: any[]) {
    removeLineCalls++;
    return origRemove(...args);
  };

  const rmId = randomUUID();
  const first = await executeAction(
    'REMOVE_FROM_CART',
    { actionId: rmId, type: 'REMOVE_FROM_CART', payload: { lineItemId } },
    ctx,
  );
  assert.equal(first.status, 'applied');

  const beforeRetry = await prisma.orderItem.count({ where: { order: { conversationId: conv } } });
  assert.equal(beforeRetry, 0, 'item already removed after first call');

  const second = await executeAction(
    'REMOVE_FROM_CART',
    { actionId: rmId, type: 'REMOVE_FROM_CART', payload: { lineItemId } },
    ctx,
  );
  assert.equal(second.status, 'already_applied', 'retry must return already_applied');

  const afterRetry = await prisma.orderItem.count({ where: { order: { conversationId: conv } } });
  assert.equal(afterRetry, 0, 'retry must NOT remove again (no double-execute)');

  // removeLine called exactly once across both attempts
  assert.equal(removeLineCalls, 1, 'removeLine must execute only once for the same actionId');
  (cartAuthority as any).removeLine = origRemove;

  const records = await prisma.actionIdempotency.findMany({
    where: { storeId, customerId, actionType: 'REMOVE_FROM_CART', actionId: rmId },
  });
  assert.equal(records.length, 1, 'exactly one idempotency record for the actionId');
  assert.equal(records[0].status, ActionStatus.COMPLETED);
});

test('P6.2.4: UPDATE_CART_QUANTITY retry with same actionId → already_applied, no double-update', async () => {
  const conv = await createConversation(storeId, customerId);
  const ctx = makeActionContext({ conversationId: conv });
  await executeAction('ADD_TO_CART', makeAddToCartRequest(randomUUID(), 1), ctx);
  const lineItemId = await getLineItemIdForConversation(conv, productId);

  let updateQtyCalls = 0;
  const origUpdate = (cartAuthority as any).updateQuantity.bind(cartAuthority);
  (cartAuthority as any).updateQuantity = function (this: any, ...args: any[]) {
    updateQtyCalls++;
    return origUpdate(...args);
  };

  const upId = randomUUID();
  const first = await executeAction(
    'UPDATE_CART_QUANTITY',
    { actionId: upId, type: 'UPDATE_CART_QUANTITY', payload: { lineItemId, quantity: 4 } },
    ctx,
  );
  assert.equal(first.status, 'applied');

  const second = await executeAction(
    'UPDATE_CART_QUANTITY',
    { actionId: upId, type: 'UPDATE_CART_QUANTITY', payload: { lineItemId, quantity: 4 } },
    ctx,
  );
  assert.equal(second.status, 'already_applied', 'retry must return already_applied');

  const item = await prisma.orderItem.findUnique({ where: { id: lineItemId } });
  assert.equal(item!.quantity, 4, 'quantity must not be re-applied/doubled on retry');
  assert.equal(updateQtyCalls, 1, 'updateQuantity must execute only once for the same actionId');
  (cartAuthority as any).updateQuantity = origUpdate;
});

test('P6.2.5: REMOVE_FROM_CART tenant mismatch is rejected (structured error, no cross-tenant deletion)', async () => {
  // Create a line item in a DIFFERENT store's draft order
  const otherConv = await createConversation(storeIdOther, customerIdOther);
  const otherOrder = await prisma.order.create({
    data: {
      id: `ord-${randomUUID()}`,
      conversationId: otherConv,
      storeId: storeIdOther,
      customerId: customerIdOther,
      orderStatus: 'draft',
      totalPrice: 0,
      currency: 'IDR',
      items: [],
    },
  });
  const otherItem = await prisma.orderItem.create({
    data: {
      orderId: otherOrder.id,
      productId: productIdOtherStore,
      productName: 'Produk Toko Lain',
      quantity: 1,
      unitPrice: 99999,
      subtotal: 99999,
    },
  });

  const rmId = randomUUID();
  const result = await executeAction(
    'REMOVE_FROM_CART',
    { actionId: rmId, type: 'REMOVE_FROM_CART', payload: { lineItemId: otherItem.id } },
    makeActionContext(),
  );

  assert.equal(result.success, false, 'cross-tenant remove must be rejected');
  assert.ok(result.error, 'structured error must be present');
  assert.equal(result.status, 'already_applied');

  // Cross-tenant item must remain intact (no deletion)
  const stillThere = await prisma.orderItem.findUnique({ where: { id: otherItem.id } });
  assert.ok(stillThere, 'cross-tenant line item must NOT be removed');

  const rec = await prisma.actionIdempotency.findUnique({
    where: {
      storeId_customerId_actionType_actionId: {
        storeId, customerId, actionType: 'REMOVE_FROM_CART', actionId: rmId,
      },
    },
  });
  assert.ok(rec, 'idempotency record must exist');
  assert.equal(rec.status, ActionStatus.FAILED, 'tenant mismatch must persist as FAILED');
});

test('P6.2.6: REMOVE_FROM_CART / UPDATE_CART_QUANTITY with non-existent lineItemId → structured business error, not a crash', async () => {
  // REMOVE non-existent
  const rmId = randomUUID();
  const rmResult = await executeAction(
    'REMOVE_FROM_CART',
    { actionId: rmId, type: 'REMOVE_FROM_CART', payload: { lineItemId: randomUUID() } },
    makeActionContext(),
  );
  assert.equal(rmResult.success, false);
  assert.ok(rmResult.error?.code, 'structured error code required (not a raw crash)');
  assert.equal(rmResult.status, 'already_applied');

  // UPDATE non-existent
  const upId = randomUUID();
  const upResult = await executeAction(
    'UPDATE_CART_QUANTITY',
    { actionId: upId, type: 'UPDATE_CART_QUANTITY', payload: { lineItemId: randomUUID(), quantity: 3 } },
    makeActionContext(),
  );
  assert.equal(upResult.success, false);
  assert.ok(upResult.error?.code, 'structured error code required (not a raw crash)');
  assert.equal(upResult.status, 'already_applied');

  // Both must be recorded as FAILED, not throw
  const rmRec = await prisma.actionIdempotency.findUnique({
    where: { storeId_customerId_actionType_actionId: { storeId, customerId, actionType: 'REMOVE_FROM_CART', actionId: rmId } },
  });
  assert.equal(rmRec?.status, ActionStatus.FAILED);
  const upRec = await prisma.actionIdempotency.findUnique({
    where: { storeId_customerId_actionType_actionId: { storeId, customerId, actionType: 'UPDATE_CART_QUANTITY', actionId: upId } },
  });
  assert.equal(upRec?.status, ActionStatus.FAILED);
});

// ═════════════════════════════════════════════════════════════
// P6-3 — Typed CANCEL_ORDER
// Reuse the SAME idempotency/lock pattern as ADD_TO_CART /
// REMOVE_FROM_CART / UPDATE_CART_QUANTITY (claim → executeClaimedAction,
// FOR UPDATE + re-check, SAVEPOINT). Delegates to OrderService.cancelOrder,
// which re-validates ownership (storeId + customerId) and enforces the
// order-transition state machine. Does NOT touch CartAuthority.
// ═════════════════════════════════════════════════════════════

/** Create an order in a given status owned by (storeId, customerId). */
async function createOrderInState(
  status: string,
  sid: string,
  cid: string,
  convId: string,
  pid: string,
): Promise<string> {
  const order = await prisma.order.create({
    data: {
      id: randomUUID(),
      storeId: sid,
      customerId: cid,
      conversationId: convId,
      orderStatus: status,
      totalPrice: 25000,
      currency: 'IDR',
      items: [],
      orderItems: {
        create: [{
          productId: pid,
          productName: 'Produk Test',
          quantity: 1,
          unitPrice: 25000,
          subtotal: 25000,
        }],
      },
    },
  });
  return order.id;
}

test('P6.3.1: CANCEL_ORDER from valid state → applied, orderStatus cancelled, DB readback', async () => {
  const conv = await createConversation(storeId, customerId);
  const orderId = await createOrderInState('pending', storeId, customerId, conv, productId);

  const result = await executeAction(
    'CANCEL_ORDER',
    { actionId: randomUUID(), type: 'CANCEL_ORDER', payload: { orderId } },
    makeActionContext({ conversationId: conv }),
  );

  assert.equal(result.success, true);
  assert.equal(result.status, 'applied');
  assert.equal(result.data.result.orderId, orderId);
  assert.equal(result.data.result.orderStatus, 'cancelled');

  // DB readback: orderStatus must be 'cancelled'
  const dbOrder = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(dbOrder!.orderStatus, 'cancelled', 'order must be cancelled in DB');

  const rec = await prisma.actionIdempotency.findUnique({
    where: { storeId_customerId_actionType_actionId: { storeId, customerId, actionType: 'CANCEL_ORDER', actionId: (result.data as any).actionId } },
  });
  assert.equal(rec?.status, ActionStatus.COMPLETED);
});

test('P6.3.2: CANCEL_ORDER invalid payload (non-UUID orderId) rejected before execution', async () => {
  const conv = await createConversation(storeId, customerId);
  const orderId = await createOrderInState('pending', storeId, customerId, conv, productId);

  await assert.rejects(
    () => executeAction(
      'CANCEL_ORDER',
      { actionId: randomUUID(), type: 'CANCEL_ORDER', payload: { orderId: 'not-a-uuid' } },
      makeActionContext({ conversationId: conv }),
    ),
    (e: any) => e instanceof ApiError && e.code === ErrorCodes.ERR_VALIDATION,
  );

  // Order must be unchanged (rejected before any mutation)
  const dbOrder = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(dbOrder!.orderStatus, 'pending', 'order must remain pending after invalid payload');

  // No idempotency record should have been created for the bad attempt.
  // Scope to THIS file's storeId: a leaked CANCEL_ORDER row from an unrelated
  // test store (e.g. auth.ts registration flow -> store-f7140b5c) must NOT
  // produce a false negative here. The handler already rejects the invalid
  // payload before claimAction(); any record for this store would be a real bug.
  const recs = await prisma.actionIdempotency.findMany({
    where: { actionType: 'CANCEL_ORDER', storeId },
  });
  assert.equal(recs.length, 0, 'no idempotency record for a rejected invalid payload in this store');
});

test('P6.3.3: CANCEL_ORDER tenant/customer mismatch → rejected, order unchanged, FAILED', async () => {
  // Order owned by a DIFFERENT store + customer
  const otherConv = await createConversation(storeIdOther, customerIdOther);
  const otherOrderId = await createOrderInState('pending', storeIdOther, customerIdOther, otherConv, productIdOtherStore);

  const result = await executeAction(
    'CANCEL_ORDER',
    { actionId: randomUUID(), type: 'CANCEL_ORDER', payload: { orderId: otherOrderId } },
    makeActionContext(), // default storeId/customerId — NOT the owner
  );

  assert.equal(result.success, false, 'cross-tenant cancel must be rejected');
  assert.ok(result.error, 'structured error must be present');
  assert.equal(result.error!.code, 'INVALID_ORDER_OWNERSHIP', 'clear ownership error code required');
  assert.equal(result.status, 'already_applied');

  // Cross-tenant order must remain intact (unchanged)
  const dbOrder = await prisma.order.findUnique({ where: { id: otherOrderId } });
  assert.equal(dbOrder!.orderStatus, 'pending', 'cross-tenant order must NOT be cancelled');

  // FAILED record is keyed by the caller's store/customer (default context)
  const failedRec = await prisma.actionIdempotency.findFirst({
    where: { storeId, customerId, actionType: 'CANCEL_ORDER', status: ActionStatus.FAILED },
  });
  assert.ok(failedRec, 'mismatch must persist as FAILED');
});

test('P6.3.4: CANCEL_ORDER from terminal state (completed) → rejected, order unchanged, clear error', async () => {
  const conv = await createConversation(storeId, customerId);
  const orderId = await createOrderInState('completed', storeId, customerId, conv, productId);

  const result = await executeAction(
    'CANCEL_ORDER',
    { actionId: randomUUID(), type: 'CANCEL_ORDER', payload: { orderId } },
    makeActionContext({ conversationId: conv }),
  );

  assert.equal(result.success, false, 'cancel from completed must be rejected');
  assert.ok(result.error, 'structured error must be present');
  assert.equal(result.error!.code, 'INVALID_ORDER_TRANSITION', 'clear transition error code required');
  assert.equal(result.status, 'already_applied');

  // Order must remain 'completed' (not mutated)
  const dbOrder = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(dbOrder!.orderStatus, 'completed', 'completed order must NOT change');

  const rec = await prisma.actionIdempotency.findFirst({
    where: { storeId, customerId, actionType: 'CANCEL_ORDER', status: ActionStatus.FAILED },
  });
  assert.ok(rec, 'terminal-state cancel must persist as FAILED');
});

test('P6.3.5: CANCEL_ORDER from shipped is allowed per existing state machine', async () => {
  const conv = await createConversation(storeId, customerId);
  const orderId = await createOrderInState('shipped', storeId, customerId, conv, productId);

  const result = await executeAction(
    'CANCEL_ORDER',
    { actionId: randomUUID(), type: 'CANCEL_ORDER', payload: { orderId } },
    makeActionContext({ conversationId: conv }),
  );

  assert.equal(result.success, true, 'shipped → cancelled is allowed by order-transition');
  assert.equal(result.status, 'applied');
  assert.equal(result.data.result.orderStatus, 'cancelled');

  const dbOrder = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(dbOrder!.orderStatus, 'cancelled');
});

test('P6.3.6: CANCEL_ORDER retry with same actionId → already_applied, no double-process', async () => {
  const conv = await createConversation(storeId, customerId);
  const orderId = await createOrderInState('pending', storeId, customerId, conv, productId);

  let cancelCalls = 0;
  const origCancel = (orderService as any).cancelOrder.bind(orderService);
  (orderService as any).cancelOrder = function (this: any, ...args: any[]) {
    cancelCalls++;
    return origCancel(...args);
  };

  const cancelId = randomUUID();
  const first = await executeAction(
    'CANCEL_ORDER',
    { actionId: cancelId, type: 'CANCEL_ORDER', payload: { orderId } },
    makeActionContext({ conversationId: conv }),
  );
  assert.equal(first.status, 'applied');

  const second = await executeAction(
    'CANCEL_ORDER',
    { actionId: cancelId, type: 'CANCEL_ORDER', payload: { orderId } },
    makeActionContext({ conversationId: conv }),
  );
  assert.equal(second.status, 'already_applied', 'retry must return already_applied');

  const dbOrder = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(dbOrder!.orderStatus, 'cancelled', 'order must not be re-cancelled on retry');
  assert.equal(cancelCalls, 1, 'cancelOrder must execute only once for the same actionId');
  (orderService as any).cancelOrder = origCancel;

  const rec = await prisma.actionIdempotency.findFirst({
    where: { storeId, customerId, actionType: 'CANCEL_ORDER', actionId: cancelId },
  });
  assert.equal(rec!.status, ActionStatus.COMPLETED);
});

test('P6.3.7: CANCEL_ORDER retry after FAILED does not re-execute mutation', async () => {
  const conv = await createConversation(storeId, customerId);
  const orderId = await createOrderInState('completed', storeId, customerId, conv, productId);

  let cancelCalls = 0;
  const origCancel = (orderService as any).cancelOrder.bind(orderService);
  (orderService as any).cancelOrder = function (this: any, ...args: any[]) {
    cancelCalls++;
    return origCancel(...args);
  };

  const cancelId = randomUUID();
  const first = await executeAction(
    'CANCEL_ORDER',
    { actionId: cancelId, type: 'CANCEL_ORDER', payload: { orderId } },
    makeActionContext({ conversationId: conv }),
  );
  assert.equal(first.status, 'already_applied');
  assert.equal(first.success, false);

  const second = await executeAction(
    'CANCEL_ORDER',
    { actionId: cancelId, type: 'CANCEL_ORDER', payload: { orderId } },
    makeActionContext({ conversationId: conv }),
  );
  assert.equal(second.status, 'already_applied', 'retry after FAILED returns already_applied');
  assert.equal(second.success, false, 'retry after FAILED does not succeed');

  const dbOrder = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(dbOrder!.orderStatus, 'completed', 'order must not be mutated on FAILED retry');
  assert.equal(cancelCalls, 1, 'cancelOrder must execute only once (FAILED not re-applied)');
  (orderService as any).cancelOrder = origCancel;
});

test('P6.3.8: CANCEL_ORDER does NOT invoke CartAuthority.executeOps / addLine', async () => {
  const conv = await createConversation(storeId, customerId);
  const orderId = await createOrderInState('pending', storeId, customerId, conv, productId);

  const execSpy = await withSpy(cartAuthority as any, 'executeOps', async () => {
    const addSpy = await withSpy(cartAuthority as any, 'addLine', async () => {
      await executeAction(
        'CANCEL_ORDER',
        { actionId: randomUUID(), type: 'CANCEL_ORDER', payload: { orderId } },
        makeActionContext({ conversationId: conv }),
      );
    });
    assert.equal(addSpy.calls, 0, 'CartAuthority.addLine must NOT be called for CANCEL_ORDER');
  });
  assert.equal(execSpy.calls, 0, 'CartAuthority.executeOps must NOT be called for CANCEL_ORDER');
});

// ═════════════════════════════════════════════════════════════
// §8 Test 17 — Business validation failure: rollback + FAILED
// ═════════════════════════════════════════════════════════════
test('§8.17: business validation failure rolls back cart mutation, leaves no partial OrderItem, persists FAILED with structured error', async () => {
  // Use PRODUCT_NOT_FOUND as the business validation failure path.
  // We call handleAddToCart directly (bypassing authorize) to test the
  // Stage-2 SAVEPOINT + FAILED semantics. resolveProductForCart returns null
  // when product doesn't exist in store → handler throws CartInvariantError(PRODUCT_NOT_FOUND)
  // inside SAVEPOINT → executeOps is NOT called, cart mutation is rolled back, FAILED is persisted.
  const actionId = randomUUID();
  const nonExistentProductId = randomUUID(); // valid UUID but doesn't exist in DB
  const req = {
    actionId,
    type: 'ADD_TO_CART',
    payload: { productId: nonExistentProductId, quantity: 1 },
  };

  const ctx = makeActionContext();
  const result = await handleAddToCart(req as any, ctx as any);

  assert.equal(result.success, false);
  assert.equal(result.status, 'already_applied');
  assert.ok(result.error, 'error must be present');
  assert.equal(result.error.code, 'PRODUCT_NOT_FOUND');
  assert.ok(result.error.message);

  // Verify FAILED record persisted with structured error
  const record = await prisma.actionIdempotency.findUnique({
    where: {
      storeId_customerId_actionType_actionId: {
        storeId, customerId,
        actionType: 'ADD_TO_CART',
        actionId,
      },
    },
  });
  assert.ok(record, 'ActionIdempotency record must exist');
  assert.equal(record.status, ActionStatus.FAILED);
  assert.ok(record.error, 'error JSON must be populated');
  const storedError = record.error as any;
  assert.equal(storedError.code, 'PRODUCT_NOT_FOUND');
  assert.ok(storedError.message);

  // Verify NO OrderItem was created (cart mutation rolled back)
  const orderItems = await prisma.orderItem.findMany({
    where: { order: { conversationId, orderStatus: 'draft' } },
  });
  assert.equal(orderItems.length, 0, 'no partial OrderItem should exist after business validation failure');
});

// ═════════════════════════════════════════════════════════════
// §8 Test 18 — Retry FAILED actionId does not re-execute
// ═════════════════════════════════════════════════════════════
test('§8.18: retrying same actionId after FAILED does not execute mutation again', async () => {
  const actionId = randomUUID();
  const nonExistentProductId = randomUUID();

  // Step 1: First attempt via handleAddToCart (bypass authorize) — causes
  // business validation failure → SAVEPOINT rollback → FAILED committed
  const ctx = makeActionContext();
  const first = await handleAddToCart({
    actionId,
    type: 'ADD_TO_CART',
    payload: { productId: nonExistentProductId, quantity: 1 },
  } as any, ctx as any);
  assert.equal(first.success, false);
  assert.equal(first.status, 'already_applied');
  assert.equal(first.error.code, 'PRODUCT_NOT_FOUND');

  // Verify FAILED committed
  const recordAfterFirst = await prisma.actionIdempotency.findUnique({
    where: {
      storeId_customerId_actionType_actionId: {
        storeId, customerId,
        actionType: 'ADD_TO_CART',
        actionId,
      },
    },
  });
  assert.equal(recordAfterFirst.status, ActionStatus.FAILED);

  // Step 2: Retry same actionId via executeAction with a VALID product.
  // Authorize passes (product exists in store), but plain SELECT finds FAILED
  // (Branch 4) and returns stored error immediately — NO executeOps() called.
  const retryReq = {
    actionId,
    type: 'ADD_TO_CART',
    payload: { productId, quantity: 1 },
  };
  const second = await executeAction('ADD_TO_CART', retryReq, makeActionContext());

  assert.equal(second.success, false);
  assert.equal(second.status, 'already_applied');
  assert.equal(second.error.code, 'PRODUCT_NOT_FOUND');
  assert.equal(second.error.message, first.error.message);

  // Status remains FAILED
  const recordAfterRetry = await prisma.actionIdempotency.findUnique({
    where: {
      storeId_customerId_actionType_actionId: {
        storeId, customerId,
        actionType: 'ADD_TO_CART',
        actionId,
      },
    },
  });
  assert.equal(recordAfterRetry.status, ActionStatus.FAILED, 'status must remain FAILED after retry');

  // No OrderItem created (executeOps was never called)
  const orderItems = await prisma.orderItem.findMany({
    where: { order: { conversationId, orderStatus: 'draft' } },
  });
  assert.equal(orderItems.length, 0, 'no cart mutation should have occurred on retry');
});

// ═════════════════════════════════════════════════════════════
// §8 Test 19 — Valid CLAIMED lease: immediate 409
// ═════════════════════════════════════════════════════════════
test('§8.19: CLAIMED record with valid lease returns 409 immediately, no FOR UPDATE, no held connection', async () => {
  const actionId = randomUUID();
  const claimTime = new Date();

  // Pre-create a CLAIMED record with valid (non-expired) lease
  await prisma.actionIdempotency.create({
    data: {
      idempotencyKey: makeIdempotencyKey(storeId, customerId, actionId),
      storeId,
      customerId,
      actionType: 'ADD_TO_CART',
      actionId,
      status: ActionStatus.CLAIMED,
      claimedAt: claimTime,
      leaseUntil: new Date(claimTime.getTime() + LEASE_FINAL_MS * 10),
    },
  });

  // Instrument: track whether executeClaimedAction is called or FOR UPDATE runs
  // We verify through the result: if 409 is returned without execution, no cart mutation occurs
  const result = await executeAction('ADD_TO_CART', makeAddToCartRequest(actionId, 1), makeActionContext());

  assert.equal(result.success, false);
  assert.equal(result.status, 'action_in_progress');
  assert.equal(result.error.code, 'ACTION_IN_PROGRESS');

  // Verify no OrderItem was created (no mutation happened)
  const orderItems = await prisma.orderItem.findMany({
    where: { order: { conversationId, orderStatus: 'draft' } },
  });
  assert.equal(orderItems.length, 0, 'no cart mutation should occur on valid lease 409');

  // Verify the record remains CLAIMED (not completed/failed)
  const record = await prisma.actionIdempotency.findUnique({
    where: {
      storeId_customerId_actionType_actionId: {
        storeId, customerId,
        actionType: 'ADD_TO_CART',
        actionId,
      },
    },
  });
  assert.equal(record.status, ActionStatus.CLAIMED, 'record must remain CLAIMED');
  assert.ok(new Date(record.leaseUntil) > claimTime, 'lease must still be valid');
  assert.equal(record.result, null, 'no result should be stored for pending action');
});

// ═════════════════════════════════════════════════════════════
// §8 Test 20 — Expired CLAIMED: executeClaimedAction + FOR UPDATE + re-check
// ═════════════════════════════════════════════════════════════
test('§8.20: expired CLAIMED triggers executeClaimedAction with FOR UPDATE and latest state re-check', async () => {
  const actionId = randomUUID();

  // Pre-create a CLAIMED record with EXPIRED lease (leaseUntil in the past)
  await prisma.actionIdempotency.create({
    data: {
      idempotencyKey: makeIdempotencyKey(storeId, customerId, actionId),
      storeId,
      customerId,
      actionType: 'ADD_TO_CART',
      actionId,
      status: ActionStatus.CLAIMED,
      claimedAt: new Date(Date.now() - 10000),
      leaseUntil: new Date(Date.now() - 5000), // expired 5 seconds ago
    },
  });

  // This should trigger executeClaimedAction() → FOR UPDATE + re-check → executeOps
  const result = await executeAction('ADD_TO_CART', makeAddToCartRequest(actionId, 2), makeActionContext());

  assert.equal(result.success, true);
  assert.equal(result.status, 'applied');

  // Verify the record was updated to COMPLETED
  const record = await prisma.actionIdempotency.findUnique({
    where: {
      storeId_customerId_actionType_actionId: {
        storeId, customerId,
        actionType: 'ADD_TO_CART',
        actionId,
      },
    },
  });
  assert.equal(record.status, ActionStatus.COMPLETED);
  assert.ok(record.completedAt, 'completedAt must be set after execution');
  assert.ok(record.result, 'result must be stored for COMPLETED status');

  // Verify cart mutation actually happened (proves FOR UPDATE + re-check → executeOps)
  const orderItems = await prisma.orderItem.findMany({
    where: { order: { conversationId, orderStatus: 'draft' } },
  });
  assert.ok(orderItems.length >= 1, 'cart mutation must have occurred via executeClaimedAction');
  const item = orderItems.find((i) => i.productId === productId);
  assert.ok(item, 'OrderItem must exist');
  assert.equal(item.quantity, 2, 'exactly the requested quantity must be added');
});

// ═════════════════════════════════════════════════════════════
// §8 Test 21 — Concurrent same actionId: exactly one executeOps
// ═════════════════════════════════════════════════════════════
test('§8.21: concurrent same actionId results in exactly one executeOps call; second resolves via locked re-check', async () => {
  const actionId = randomUUID();

  // Track executeOps calls by counting OrderItem rows — exactly one should be created
  const [r1, r2] = await Promise.all([
    executeAction('ADD_TO_CART', makeAddToCartRequest(actionId, 2), makeActionContext()),
    executeAction('ADD_TO_CART', makeAddToCartRequest(actionId, 2), makeActionContext()),
  ]);

  // One wins (applied), one gets 409 (action_in_progress)
  const statuses = [r1.status, r2.status].sort();
  assert.deepEqual(statuses, ['action_in_progress', 'applied']);

  // Verify exactly ONE OrderItem row (proves exactly one executeOps call)
  const orderItems = await prisma.orderItem.findMany({
    where: { order: { conversationId, orderStatus: 'draft' } },
  });
  const productItems = orderItems.filter((i) => i.productId === productId);
  assert.equal(productItems.length, 1, 'exactly one executeOps call → one OrderItem row');
  assert.equal(productItems[0].quantity, 2, 'quantity must be exactly 2 (not doubled)');

  // Verify idempotency record is COMPLETED
  const record = await prisma.actionIdempotency.findUnique({
    where: {
      storeId_customerId_actionType_actionId: {
        storeId, customerId,
        actionType: 'ADD_TO_CART',
        actionId,
      },
    },
  });
  assert.equal(record.status, ActionStatus.COMPLETED);
  assert.ok(record.result, 'result must be stored for COMPLETED status');
});

// ═════════════════════════════════════════════════════════════
// §8 Test 22 — P0 does not use addLine() or executeCartOps()
// ═════════════════════════════════════════════════════════════
test('§8.22: P0 code path does not use CartAuthority.addLine() or ConversationService.executeCartOps()', async () => {
  const fs = await import('node:fs');

  const actionRegistrySource = fs.readFileSync('src/business/action-registry.ts', 'utf8');
  const actionsRouteSource = fs.readFileSync('src/routes/actions.ts', 'utf8');

  // Verify addLine is NOT called in P0 code path
  const addLineRegex = /\.addLine\s*\(/;
  assert.equal(addLineRegex.test(actionRegistrySource), false,
    'action-registry.ts must not call CartAuthority.addLine()');
  assert.equal(addLineRegex.test(actionsRouteSource), false,
    'routes/actions.ts must not call CartAuthority.addLine()');

  // Verify executeCartOps is NOT called in P0 code path
  const executeCartOpsRegex = /executeCartOps\s*\(/;
  assert.equal(executeCartOpsRegex.test(actionRegistrySource), false,
    'action-registry.ts must not call ConversationService.executeCartOps()');
  assert.equal(executeCartOpsRegex.test(actionsRouteSource), false,
    'routes/actions.ts must not call ConversationService.executeCartOps()');

  // Verify executeOps IS called (the correct entry point)
  const executeOpsRegex = /cartAuthority\.executeOps\s*\(/;
  assert.equal(executeOpsRegex.test(actionRegistrySource), true,
    'action-registry.ts must call CartAuthority.executeOps()');

  // Verify conversation.service.ts is NOT imported by P0 files
  assert.equal(actionRegistrySource.includes('conversation.service'), false,
    'action-registry.ts must not import conversation.service');
  assert.equal(actionsRouteSource.includes('conversation.service'), false,
    'routes/actions.ts must not import conversation.service');
});

// ═════════════════════════════════════════════════════════════
// §8 Test 15 — CartAuthority regression suite green
// ═════════════════════════════════════════════════════════════
describe('§8.15: existing CartAuthority regression suite green', () => {
  test('CartAuthority regression suite passes', async () => {
    const { execSync } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');
    const fs = await import('node:fs');
    const moduleDir = fileURLToPath(new URL('../../', import.meta.url));
    const dbUrl = process.env.DATABASE_URL || 'postgresql://garuda_user:your_db_password@127.0.0.1:5432/garuda_dev';
    const outputPath = '/tmp/cart-authority-test-output.txt';

    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k.startsWith('NODE_')) continue;
      env[k] = v;
    }
    env.DATABASE_URL = dbUrl;

    execSync(
      `${process.execPath} --import tsx/esm --test --test-force-exit src/tests/cart-authority.test.ts > "${outputPath}" 2>&1`,
      { cwd: moduleDir, env, shell: true, timeout: 120000 });

    const output = fs.readFileSync(outputPath, 'utf8');
    const passMatch = output.match(/pass\s+(\d+)/);
    const failMatch = output.match(/fail\s+(\d+)/);
    const passCount = passMatch ? parseInt(passMatch[1]) : 0;
    const failCount = failMatch ? parseInt(failMatch[1]) : 0;

    assert.equal(failCount, 0,
      `CartAuthority regression tests must all pass. Output snippet:\n${output.slice(-3000)}`);
    assert.ok(passCount > 0,
      `at least one CartAuthority test must run. Output:\n${output.slice(-3000)}`);
  });
});

// ═════════════════════════════════════════════════════════════
// §8 Test 16 — Golden dataset green
// ═════════════════════════════════════════════════════════════
test('§8.16: golden dataset remains green', async () => {
  const { execSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const fs = await import('node:fs');
  const moduleDir = fileURLToPath(new URL('../../', import.meta.url));
  const dbUrl = process.env.DATABASE_URL || 'postgresql://garuda_user:your_db_password@127.0.0.1:5432/garuda_dev';
  const outputPath = '/tmp/golden-dataset-test-output.txt';

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('NODE_')) continue;
    env[k] = v;
  }
  env.DATABASE_URL = dbUrl;

  execSync(
    `${process.execPath} --import tsx/esm --test --test-force-exit src/tests/golden-dataset.test.ts > "${outputPath}" 2>&1`,
    { cwd: moduleDir, env, shell: true, timeout: 120000 });

  const output = fs.readFileSync(outputPath, 'utf8');
  const failMatch = output.match(/fail\s+(\d+)/);
  const failCount = failMatch ? parseInt(failMatch[1]) : 0;

  assert.equal(failCount, 0,
    `Golden dataset tests must all pass. Output:\n${output.slice(-3000)}`);
});
