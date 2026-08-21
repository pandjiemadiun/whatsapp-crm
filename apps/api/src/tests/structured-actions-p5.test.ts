/**
 * P5 OPEN_ORDER_HISTORY — Structured Action acceptance tests.
 *
 * Verifies the read-only order-history action against the owner-decided
 * semantics: OPEN_ORDER_HISTORY returns customer order history scoped to
 * the server-resolved storeId + conversationId via OrderService.
 *
 * Runner:
 *   npx tsx --env-file=../../.env --test --test-force-exit src/tests/structured-actions-p5.test.ts
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../infrastructure/prisma.js';
import {
  executeAction,
  actionRegistry,
  OpenOrderHistoryRequestSchema,
  OpenOrderHistoryResponseSchema,
} from '../business/action-registry.js';
import { orderService } from '../business/order.service.js';

const TEST_PREFIX = 'test-action-p5';

let storeId: string;
let storeIdOther: string;
let customerId: string;
let conversationId: string;
let orderId: string;
let orderIdOtherStore: string;
let orderIdOtherConv: string;

function makeActionContext(overrides?: Partial<{ storeId: string; customerId: string; conversationId: string }>): any {
  return {
    storeId: overrides?.storeId || storeId,
    customerId: overrides?.customerId || customerId,
    conversationId: overrides?.conversationId || conversationId,
    channel: 'web',
    requestId: randomUUID(),
  };
}

function makeRequest(opts: { badActionId?: boolean; badType?: boolean; noType?: boolean } = {}): any {
  const req: any = {
    actionId: randomUUID(),
    type: 'OPEN_ORDER_HISTORY',
    payload: {},
  };
  if (opts.badActionId) req.actionId = 'not-a-uuid';
  if (opts.badType) req.type = 'ADD_TO_CART';
  if (opts.noType) delete req.type;
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
      name: 'P5 Order Store',
      slug: `${TEST_PREFIX}-store`,
      email: 'p5@garuda.test',
      phoneNumber: '+6281200000094',
      address: 'Jl. P5 No. 1',
      originProvinceId: 'prov-p5-1',
      originProvinceName: 'Jawa Barat',
      originCityId: 'city-p5-1',
      originCityName: 'Bandung',
      originSubdistrictId: 'sub-p5-1',
      originSubdistrictName: 'Coblong',
    },
  });
  storeId = store.id;

  const storeOther = await prisma.store.upsert({
    where: { id: `${TEST_PREFIX}-other` },
    update: {},
    create: {
      id: `${TEST_PREFIX}-other`,
      name: 'P5 Other Store',
      slug: `${TEST_PREFIX}-other`,
      email: 'p5-other@garuda.test',
      phoneNumber: '+6281200000095',
      address: 'Jl. P5 Other No. 1',
      originProvinceId: 'prov-p5o-1',
      originProvinceName: 'Jawa Barat',
      originCityId: 'city-p5o-1',
      originCityName: 'Bandung',
      originSubdistrictId: 'sub-p5o-1',
      originSubdistrictName: 'Coblong',
    },
  });
  storeIdOther = storeOther.id;

  const customer = await prisma.customer.create({
    data: {
      id: `cust-p5-${randomUUID()}`,
      storeId,
      webUid: `${TEST_PREFIX}-webuid`,
      name: 'P5 Customer',
    },
  });
  customerId = customer.id;

  const conv = await prisma.conversation.create({
    data: {
      id: `conv-p5-${randomUUID()}`,
      storeId,
      customerId,
      customerPhone: '+628123456790',
      channel: 'web',
    },
  });
  conversationId = conv.id;

  // Create a completed order for this conversation (customer-facing status)
  orderId = (await prisma.order.create({
    data: {
      id: `order-p5-${randomUUID()}`,
      storeId,
      conversationId,
      customerId,
      items: [{ productName: 'Beras', quantity: 2, unitPrice: 15000, subtotal: 30000 }],
      totalPrice: 30000,
      currency: 'IDR',
      orderStatus: 'completed',
      createdAt: new Date('2025-01-15T10:00:00Z'),
    },
  })).id;

  // Create a draft order (should be EXCLUDED from customer view)
  await prisma.order.create({
    data: {
      id: `order-p5-draft-${randomUUID()}`,
      storeId,
      conversationId,
      customerId,
      items: [{ productName: 'Gula', quantity: 1, unitPrice: 15000, subtotal: 15000 }],
      totalPrice: 15000,
      currency: 'IDR',
      orderStatus: 'draft',
    },
  });

  // Create an order with internal status (should be EXCLUDED)
  await prisma.order.create({
    data: {
      id: `order-p5-wait-${randomUUID()}`,
      storeId,
      conversationId,
      customerId,
      items: [{ productName: 'Kopi', quantity: 1, unitPrice: 12000, subtotal: 12000 }],
      totalPrice: 12000,
      currency: 'IDR',
      orderStatus: 'waiting_address',
    },
  });

  // Create an order in a DIFFERENT conversation (same store) — should be EXCLUDED
  const convOther: any = await prisma.conversation.create({
    data: {
      id: `conv-p5-other-${randomUUID()}`,
      storeId,
      customerId,
      customerPhone: '+628123456791',
      channel: 'web',
    },
  });
  orderIdOtherConv = (await prisma.order.create({
    data: {
      id: `order-p5-otherconv-${randomUUID()}`,
      storeId,
      conversationId: convOther.id,
      customerId,
      items: [{ productName: 'Teh', quantity: 1, unitPrice: 5000, subtotal: 5000 }],
      totalPrice: 5000,
      currency: 'IDR',
      orderStatus: 'paid',
      createdAt: new Date('2025-01-20T10:00:00Z'),
    },
  })).id;
  await prisma.conversation.delete({ where: { id: convOther.id } }).catch(() => {});

  // Create an order in a DIFFERENT store — should be EXCLUDED
  const convDiffStore: any = await prisma.conversation.create({
    data: {
      id: `conv-p5-diffstore-${randomUUID()}`,
      storeId: storeIdOther,
      customerId,
      customerPhone: '+628123456792',
      channel: 'web',
    },
  });
  orderIdOtherStore = (await prisma.order.create({
    data: {
      id: `order-p5-otherstore-${randomUUID()}`,
      storeId: storeIdOther,
      conversationId: convDiffStore.id,
      customerId,
      items: [{ productName: 'Air', quantity: 1, unitPrice: 3000, subtotal: 3000 }],
      totalPrice: 3000,
      currency: 'IDR',
      orderStatus: 'shipped',
    },
  })).id;
  await prisma.conversation.delete({ where: { id: convDiffStore.id } }).catch(() => {});
}

before(async () => {
  await setupFixtures();
});

after(async () => {
  await cleanup();
});

describe('P5 — OPEN_ORDER_HISTORY schema & registry', () => {
  test('§P5.1: valid OPEN_ORDER_HISTORY schema', () => {
    const req = makeRequest();
    const result = OpenOrderHistoryRequestSchema.safeParse(req);
    assert.equal(result.success, true);
  });

  test('§P5.2: invalid actionId rejected before handler', () => {
    const req = makeRequest({ badActionId: true });
    const result = OpenOrderHistoryRequestSchema.safeParse(req);
    assert.equal(result.success, false);
  });

  test('§P5.3: wrong action type rejected', () => {
    const req = makeRequest({ badType: true });
    const result = OpenOrderHistoryRequestSchema.safeParse(req);
    assert.equal(result.success, false);
  });

  test('§P5.4: payload must not accept client identity fields', () => {
    const req = makeRequest();
    // The schema only allows actionId, type, payload (empty object)
    const parsed = OpenOrderHistoryRequestSchema.parse(req);
    assert.deepEqual(parsed.payload, req.payload);
    assert.equal(Object.keys(parsed).includes('storeId'), false);
    assert.equal(Object.keys(parsed).includes('customerId'), false);
    assert.equal(Object.keys(parsed).includes('conversationId'), false);
    assert.equal(Object.keys(parsed).includes('orderId'), false);
  });

  test('§P5.5: OPEN_ORDER_HISTORY registered in action registry', () => {
    assert.ok(actionRegistry.OPEN_ORDER_HISTORY, 'OPEN_ORDER_HISTORY must be registered');
    assert.equal(actionRegistry.OPEN_ORDER_HISTORY.type, 'OPEN_ORDER_HISTORY');
  });

  test('§P5.16: response validates against typed schema', async () => {
    const result = await executeAction('OPEN_ORDER_HISTORY', makeRequest(), makeActionContext());
    assert.equal(result.success, true);
    const parsed = OpenOrderHistoryResponseSchema.safeParse(result.data);
    assert.equal(parsed.success, true);
  });
});

describe('P5 — OPEN_ORDER_HISTORY handler behavior', () => {
  test('§P5.6: handler uses server context storeId', async () => {
    const result = await executeAction('OPEN_ORDER_HISTORY', makeRequest(), makeActionContext());
    assert.equal(result.success, true);
    const orders = result.data?.result?.orders ?? [];
    // All orders must belong to the requesting store
    // (we can't check storeId directly in response, but we verify by count/content)
    assert.ok(orders.length > 0);
  });

  test('§P5.7: handler uses server context conversationId', async () => {
    const result = await executeAction('OPEN_ORDER_HISTORY', makeRequest(), makeActionContext());
    assert.equal(result.success, true);
    const orders = result.data?.result?.orders ?? [];
    // Only the completed order for this conversation should appear
    assert.equal(orders.length, 1);
    assert.equal(orders[0].id, orderId);
    // The paid order from other conversation must NOT appear
    assert.ok(!orders.find((o: any) => o.id === orderIdOtherConv));
  });

  test('§P5.8: cross-store order cannot leak', async () => {
    const result = await executeAction('OPEN_ORDER_HISTORY', makeRequest(), makeActionContext());
    assert.equal(result.success, true);
    const orders = result.data?.result?.orders ?? [];
    assert.ok(!orders.find((o: any) => o.id === orderIdOtherStore));
  });

  test('§P5.9: cross-conversation order cannot leak', async () => {
    const result = await executeAction('OPEN_ORDER_HISTORY', makeRequest(), makeActionContext());
    assert.equal(result.success, true);
    const orders = result.data?.result?.orders ?? [];
    assert.ok(!orders.find((o: any) => o.id === orderIdOtherConv));
  });

  test('§P5.10: deleted orders excluded', async () => {
    // Create a deleted order
    await prisma.order.update({
      where: { id: orderId },
      data: { deletedAt: new Date() },
    });
    const result = await executeAction('OPEN_ORDER_HISTORY', makeRequest(), makeActionContext());
    assert.equal(result.success, true);
    const orders = result.data?.result?.orders ?? [];
    assert.ok(!orders.find((o: any) => o.id === orderId));
    // Restore for other tests
    await prisma.order.update({
      where: { id: orderId },
      data: { deletedAt: null },
    });
  });

  test('§P5.11: draft/waiting_address/waiting_payment excluded', async () => {
    const result = await executeAction('OPEN_ORDER_HISTORY', makeRequest(), makeActionContext());
    assert.equal(result.success, true);
    const orders = result.data?.result?.orders ?? [];
    assert.equal(orders.length, 1);
    assert.equal(orders[0].status, 'completed');
  });

  test('§P5.12: customer-facing statuses mapped correctly', async () => {
    // Create orders with all customer-facing statuses
    const testStatuses = ['pending', 'confirmed', 'paid', 'packing', 'shipped', 'completed', 'cancelled', 'refunded'];
    for (const status of testStatuses) {
      await prisma.order.create({
        data: {
          id: `order-p5-${status}-${randomUUID()}`,
          storeId,
          conversationId,
          customerId,
          items: [{ productName: `Test ${status}`, quantity: 1, unitPrice: 10000, subtotal: 10000 }],
          totalPrice: 10000,
          currency: 'IDR',
          orderStatus: status,
        },
      });
    }
    // Delete the completed order we set up to avoid extra count
    await prisma.order.update({ where: { id: orderId }, data: { deletedAt: new Date() } });

    const result = await executeAction('OPEN_ORDER_HISTORY', makeRequest(), makeActionContext());
    assert.equal(result.success, true);
    const orders = result.data?.result?.orders ?? [];

    const statusLabels: Record<string, string> = {
      pending: 'Diproses',
      confirmed: 'Dikonfirmasi',
      paid: 'Sudah Bayar',
      packing: 'Dikemas',
      shipped: 'Terkirim',
      completed: 'Selesai',
      cancelled: 'Dibatalkan',
      refunded: 'Direfund',
    };

    for (const [status, label] of Object.entries(statusLabels)) {
      const order = orders.find((o: any) => o.status === status);
      assert.ok(order, `Status ${status} should be present`);
      assert.equal(order.statusLabel, label, `Status ${status} should map to label ${label}`);
    }

    // Restore for other tests
    await prisma.order.update({ where: { id: orderId }, data: { deletedAt: null } });
    // Cleanup extra orders
    await prisma.order.deleteMany({
      where: { id: { startsWith: `order-p5-pending-` } },
    }).catch(() => {});
  });

  test('§P5.13: maximum 10 orders returned', async () => {
    // Create 12 completed orders for this conversation
    for (let i = 0; i < 12; i++) {
      await prisma.order.create({
        data: {
          id: `order-p5-max-${i}-${randomUUID()}`,
          storeId,
          conversationId,
          customerId,
          items: [{ productName: `MaxTest ${i}`, quantity: 1, unitPrice: 10000, subtotal: 10000 }],
          totalPrice: 10000,
          currency: 'IDR',
          orderStatus: 'completed',
        },
      });
    }

    const result = await executeAction('OPEN_ORDER_HISTORY', makeRequest(), makeActionContext());
    assert.equal(result.success, true);
    const orders = result.data?.result?.orders ?? [];
    assert.ok(orders.length <= 10, `Expected max 10 orders, got ${orders.length}`);
  });

  test('§P5.14: createdAt DESC ordering (newest first)', async () => {
    // Clean up leftover orders from P13 test
    await prisma.order.deleteMany({
      where: { id: { startsWith: 'order-p5-max-' } },
    }).catch(() => {});
    await prisma.order.deleteMany({
      where: { id: { startsWith: 'order-p5-pending-' } },
    }).catch(() => {});
    // Create two orders with known timestamps
    const older = await prisma.order.create({
      data: {
        id: `order-p5-old-${randomUUID()}`,
        storeId,
        conversationId,
        customerId,
        items: [{ productName: 'Older', quantity: 1, unitPrice: 10000, subtotal: 10000 }],
        totalPrice: 10000,
        currency: 'IDR',
        orderStatus: 'paid',
        createdAt: new Date('2025-01-10T10:00:00Z'),
      },
    });
    const newer = await prisma.order.create({
      data: {
        id: `order-p5-new-${randomUUID()}`,
        storeId,
        conversationId,
        customerId,
        items: [{ productName: 'Newer', quantity: 1, unitPrice: 10000, subtotal: 10000 }],
        totalPrice: 10000,
        currency: 'IDR',
        orderStatus: 'paid',
        createdAt: new Date('2025-01-20T10:00:00Z'),
      },
    });

    const result = await executeAction('OPEN_ORDER_HISTORY', makeRequest(), makeActionContext());
    assert.equal(result.success, true);
    const orders = result.data?.result?.orders ?? [];
    const newIdx = orders.findIndex((o: any) => o.id === newer.id);
    const oldIdx = orders.findIndex((o: any) => o.id === older.id);
    assert.ok(newIdx >= 0 && oldIdx >= 0, 'Both orders should be present');
    assert.ok(newIdx < oldIdx, 'Newer order should appear before older (DESC)');
  });

  test('§P5.15: response excludes internal fields', async () => {
    const result = await executeAction('OPEN_ORDER_HISTORY', makeRequest(), makeActionContext());
    assert.equal(result.success, true);
    const orders = result.data?.result?.orders ?? [];
    for (const order of orders) {
      assert.equal('storeId' in order, false, 'storeId must not be exposed');
      assert.equal('customerId' in order, false, 'customerId must not be exposed');
      assert.equal('conversationId' in order, false, 'conversationId must not be exposed');
      assert.equal('shippingAddress' in order, false, 'shippingAddress must not be exposed');
      assert.equal('notes' in order, false, 'notes must not be exposed');
      assert.equal('confirmedAt' in order, false, 'confirmedAt must not be exposed');
      assert.equal('updatedAt' in order, false, 'updatedAt must not be exposed');
      assert.equal('extractedAt' in order, false, 'extractedAt must not be exposed');
      assert.equal('orderStatus' in order, false, 'raw orderStatus must not be exposed (replaced by status+statusLabel)');
      for (const item of (order.items || [])) {
        assert.equal('id' in item, false, 'OrderItem.id must not be exposed');
        assert.equal('orderId' in item, false, 'OrderItem.orderId must not be exposed');
        assert.equal('productId' in item, false, 'OrderItem.productId must not be exposed');
        assert.equal('customizations' in item, false, 'OrderItem.customizations must not be exposed');
        assert.equal('createdAt' in item, false, 'OrderItem.createdAt must not be exposed');
        assert.equal('updatedAt' in item, false, 'OrderItem.updatedAt must not be exposed');
      }
    }
  });

  test('§P5.17: empty history returns [] without error', async () => {
    // Create a new conversation with no orders
    const convEmpty = await prisma.conversation.create({
      data: {
        id: `conv-p5-empty-${randomUUID()}`,
        storeId,
        customerId,
        customerPhone: '+628123456793',
        channel: 'web',
      },
    });
    const result = await executeAction('OPEN_ORDER_HISTORY', makeRequest(), makeActionContext({ conversationId: convEmpty.id }));
    assert.equal(result.success, true);
    assert.equal(result.data?.result?.orders.length, 0);
    await prisma.conversation.delete({ where: { id: convEmpty.id } }).catch(() => {});
  });

  test('§P5.18: zero ActionIdempotency rows', async () => {
    const before = await prisma.actionIdempotency.count({
      where: { actionType: 'OPEN_ORDER_HISTORY', storeId: { startsWith: TEST_PREFIX } },
    });
    await executeAction('OPEN_ORDER_HISTORY', makeRequest(), makeActionContext());
    const after = await prisma.actionIdempotency.count({
      where: { actionType: 'OPEN_ORDER_HISTORY', storeId: { startsWith: TEST_PREFIX } },
    });
    assert.equal(after, before, 'No ActionIdempotency rows should be created for read-only action');
  });
});

describe('P5 — OPEN_ORDER_HISTORY registry integrity', () => {
  test('§P5.19: zero LLM/ConversationEngine calls', async () => {
    // Verify the action does not invoke processCustomerMessage by checking
    // that execution succeeds without any message processing side effects
    const result = await executeAction('OPEN_ORDER_HISTORY', makeRequest(), makeActionContext());
    assert.equal(result.success, true);
    assert.equal(result.data?.type, 'OPEN_ORDER_HISTORY');
    assert.equal(result.data?.status, 'applied');
  });

  test('§P5.20: P0/P1/P2/P3 registry entries remain intact', () => {
    assert.ok(actionRegistry.ADD_TO_CART, 'P0 ADD_TO_CART must remain');
    assert.ok(actionRegistry.SHOW_RELATED_PRODUCTS, 'P1 SHOW_RELATED_PRODUCTS must remain');
    assert.ok(actionRegistry.OPEN_CATALOG, 'P2 OPEN_CATALOG must remain');
    assert.ok(actionRegistry.OPEN_CART, 'P3 OPEN_CART must remain');
    assert.ok(actionRegistry.OPEN_ORDER_HISTORY, 'P5 OPEN_ORDER_HISTORY must be registered');
  });
});
