/**
 * PV-P1-08 — Stock integrity: atomic decrement at checkout, restore on cancel,
 * and auto-expiry of stuck unpaid orders.
 *
 * Runs as a standalone node:test file (isolated store `test-stock-*`), so it
 * does NOT collide with cart-authority.test.ts (`test-cart-*`) product stock.
 *
 *   npx tsx --env-file=../../.env --test src/tests/order-stock.test.ts
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../infrastructure/prisma.js';
import { cartAuthority, CartInvariantError } from '../business/cart-authority.js';
import { orderService } from '../business/order.service.js';
import { runAutoCancelOnce } from '../bootstrap/scheduleAutoCancel.js';
import { randomUUID } from 'node:crypto';

const TEST_PREFIX = 'test-stock';
const storeId = `${TEST_PREFIX}-store`;
const customerId = `${TEST_PREFIX}-cust`;

// Product / variant ids (seeded once in `before`; stock reset per-test).
const unlimitedId = `${TEST_PREFIX}-prod-unlimited`; // stock = NULL (unlimited)
const plainId = `${TEST_PREFIX}-prod-plain`; // stock = 5
const raceId = `${TEST_PREFIX}-prod-race`; // stock = 1
const pvRootId = `${TEST_PREFIX}-prod-variant`; // hasVariants
const pvVariantId = `${TEST_PREFIX}-variant-1`; // ProductVariant stock = 5

async function cleanupAll(): Promise<void> {
  await prisma.orderItem.deleteMany({ where: { order: { storeId } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { storeId } }).catch(() => {});
  await prisma.productVariant.deleteMany({ where: { storeId } }).catch(() => {});
  await prisma.product.deleteMany({ where: { storeId } }).catch(() => {});
  await prisma.conversationContext
    .deleteMany({ where: { conversation: { storeId } } })
    .catch(() => {});
  await prisma.conversation.deleteMany({ where: { storeId } }).catch(() => {});
  await prisma.store.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
}

async function cleanupOrders(): Promise<void> {
  await prisma.orderItem.deleteMany({ where: { order: { storeId } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { storeId } }).catch(() => {});
  await prisma.conversationContext
    .deleteMany({ where: { conversation: { storeId } } })
    .catch(() => {});
  await prisma.conversation.deleteMany({ where: { storeId } }).catch(() => {});
}

async function createConversation(): Promise<string> {
  const conv = await prisma.conversation.create({
    data: { storeId, customerId, customerPhone: '+628120000stock1', channel: 'whatsapp' },
  });
  await prisma.conversationContext.create({
    data: {
      conversationId: conv.id,
      lastMessages: [],
      sessionKey: randomUUID(),
      sessionExpireAt: new Date(Date.now() + 86_400_000),
    },
  });
  return conv.id;
}

async function resetStock(): Promise<void> {
  await prisma.product.update({ where: { id: plainId }, data: { stock: 5 } }).catch(() => {});
  await prisma.product.update({ where: { id: raceId }, data: { stock: 1 } }).catch(() => {});
  await prisma.product.update({ where: { id: unlimitedId }, data: { stock: null } }).catch(() => {});
  await prisma.productVariant.update({ where: { id: pvVariantId }, data: { stock: 5 } }).catch(() => {});
}

before(async () => {
  await cleanupAll();
  await prisma.store.create({
    data: {
      id: storeId,
      name: 'Stock Test Store',
      email: 'stock@garuda.test',
      phoneNumber: '+628120000stock0',
      address: 'Jl Stock No. 0',
      originProvinceId: 'prov-stock',
      originProvinceName: 'Jawa Barat',
      originCityId: 'city-stock',
      originCityName: 'Bandung',
      originSubdistrictId: 'sub-stock',
      originSubdistrictName: 'Coblong',
    },
  });

  await prisma.product.create({ data: { id: unlimitedId, storeId, name: 'Unlimited', price: 10000, isActive: true } });
  await prisma.product.create({ data: { id: plainId, storeId, name: 'Plain', price: 10000, isActive: true, stock: 5 } });
  await prisma.product.create({ data: { id: raceId, storeId, name: 'Race', price: 10000, isActive: true, stock: 1 } });
  await prisma.product.create({ data: { id: pvRootId, storeId, name: 'Variant Root', price: 10000, isActive: true, hasVariants: true } });
  await prisma.productVariant.create({
    data: { id: pvVariantId, productId: pvRootId, storeId, attributes: { size: '1L' } as any, price: 10000, stock: 5 },
  });
});

beforeEach(async () => {
  await cleanupOrders();
  await resetStock();
});

after(async () => {
  await cleanupAll();
  await prisma.$disconnect();
});

describe('PV-P1-08: checkout stock decrement + auto-cancel', () => {
  test('7. unlimited stock (null) → checkout succeeds, NO decrement (skip path)', async () => {
    const convId = await createConversation();
    await cartAuthority.addLine(convId, storeId, customerId, unlimitedId, 3);
    const orderId = await cartAuthority.checkout(convId, storeId);
    assert.ok(orderId, 'checkout should succeed for unlimited stock');

    const prod = await prisma.product.findUnique({ where: { id: unlimitedId }, select: { stock: true } });
    assert.equal(prod!.stock, null, 'unlimited (stock=null) must stay null — never decremented');
  });

  test('8. decrement success — plain product stock 5 → checkout qty 2 → stock 3', async () => {
    const convId = await createConversation();
    await cartAuthority.addLine(convId, storeId, customerId, plainId, 2);
    const orderId = await cartAuthority.checkout(convId, storeId);
    assert.ok(orderId, 'checkout should succeed');

    const prod = await prisma.product.findUnique({ where: { id: plainId }, select: { stock: true } });
    assert.equal(prod!.stock, 3, 'stock decremented 5 → 3');

    const item = await prisma.orderItem.findFirst({ where: { orderId, productId: plainId } });
    assert.ok(item, 'OrderItem persisted for the plain product line');
    assert.equal(item!.quantity, 2);
    assert.equal(item!.variantId, null);
  });

  test('8b. decrement success — variant product stock 5 → checkout qty 2 → variant stock 3', async () => {
    const convId = await createConversation();
    await cartAuthority.addLine(convId, storeId, customerId, pvRootId, 2, pvVariantId);
    const orderId = await cartAuthority.checkout(convId, storeId);
    assert.ok(orderId, 'checkout should succeed for a variant product');

    const variant = await prisma.productVariant.findUnique({ where: { id: pvVariantId }, select: { stock: true } });
    assert.equal(variant!.stock, 3, 'variant stock decremented 5 → 3');

    const item = await prisma.orderItem.findFirst({ where: { orderId, variantId: pvVariantId } });
    assert.ok(item, 'OrderItem persisted for the variant line');
    assert.equal(item!.quantity, 2);
  });

  test('9. RACE: two concurrent checkouts on plain stock=1, qty=1 → exactly one wins, final stock=0', async () => {
    const conv1 = await createConversation();
    const conv2 = await createConversation();
    // addLine is a soft check (no reservation) — both pass against stock=1.
    await cartAuthority.addLine(conv1, storeId, customerId, raceId, 1);
    await cartAuthority.addLine(conv2, storeId, customerId, raceId, 1);

    let successes = 0;
    let failures = 0;
    const errors: unknown[] = [];
    await Promise.all([
      cartAuthority.checkout(conv1, storeId).then(() => successes++).catch((e) => { failures++; errors.push(e); }),
      cartAuthority.checkout(conv2, storeId).then(() => successes++).catch((e) => { failures++; errors.push(e); }),
    ]);

    assert.equal(successes, 1, 'exactly one concurrent checkout must succeed');
    assert.equal(failures, 1, 'the other must lose the race (stock was taken)');
    assert.ok(errors[0] instanceof CartInvariantError, 'loser must throw CartInvariantError');
    assert.equal((errors[0] as CartInvariantError).code, 'INSUFFICIENT_STOCK', 'loser code = INSUFFICIENT_STOCK');

    const prod = await prisma.product.findUnique({ where: { id: raceId }, select: { stock: true } });
    assert.equal(prod!.stock, 0, 'final stock must be 0 — never negative (oversell blocked)');
  });

  test('10. cancel restores stock (plain 5 → checkout 2 → 3 → cancel → 5)', async () => {
    const convId = await createConversation();
    await cartAuthority.addLine(convId, storeId, customerId, plainId, 2);
    const orderId = await cartAuthority.checkout(convId, storeId);

    const afterCheckout = await prisma.product.findUnique({ where: { id: plainId }, select: { stock: true } });
    assert.equal(afterCheckout!.stock, 3, 'checkout decremented 5 → 3');

    await orderService.cancelOrder(orderId, storeId, customerId);

    const afterCancel = await prisma.product.findUnique({ where: { id: plainId }, select: { stock: true } });
    assert.equal(afterCancel!.stock, 5, 'cancel restored 3 → 5');

    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { orderStatus: true } });
    assert.equal(order!.orderStatus, 'cancelled');
  });

  test('11. auto-cancel expires stuck waiting_payment order + restores stock (and logs)', async () => {
    const convId = await createConversation();
    await cartAuthority.addLine(convId, storeId, customerId, plainId, 2);
    // checkout → waiting_address, stock 5 → 3, autoCancelAt = now + 24h
    const orderId = await cartAuthority.checkout(convId, storeId);

    // Simulate a stuck order: advance to waiting_payment + past expiry.
    await prisma.order.update({
      where: { id: orderId },
      data: {
        orderStatus: 'waiting_payment',
        autoCancelAt: new Date(Date.now() - 60_000), // 1 minute ago
      },
    });

    const beforeStock = await prisma.product.findUnique({ where: { id: plainId }, select: { stock: true } });
    assert.equal(beforeStock!.stock, 3, 'stock is 3 after checkout, before auto-cancel');

    const cancelled = await runAutoCancelOnce(new Date());
    assert.equal(cancelled, 1, 'runAutoCancelOnce should cancel the single stuck order');

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { orderStatus: true, paymentStatus: true },
    });
    assert.equal(order!.orderStatus, 'cancelled', 'stuck order transitioned to cancelled');
    assert.equal(order!.paymentStatus, 'unpaid', 'paymentStatus untouched by auto-cancel');

    const afterStock = await prisma.product.findUnique({ where: { id: plainId }, select: { stock: true } });
    assert.equal(afterStock!.stock, 5, 'stock restored 3 → 5 by auto-cancel');
  });

  test('12. pending_verification order is NOT auto-cancelled (awaiting admin) and stock stays as-is', async () => {
    const convId = await createConversation();
    await cartAuthority.addLine(convId, storeId, customerId, plainId, 2);
    const orderId = await cartAuthority.checkout(convId, storeId); // stock 5 → 3

    await prisma.order.update({
      where: { id: orderId },
      data: {
        orderStatus: 'waiting_payment',
        paymentStatus: 'pending_verification',
        autoCancelAt: new Date(Date.now() - 60_000), // past expiry
      },
    });

    const cancelled = await runAutoCancelOnce(new Date());
    assert.equal(cancelled, 0, 'pending_verification must be skipped (not abandoned)');

    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { orderStatus: true } });
    assert.equal(order!.orderStatus, 'waiting_payment', 'order status untouched');

    const afterStock = await prisma.product.findUnique({ where: { id: plainId }, select: { stock: true } });
    assert.equal(afterStock!.stock, 3, 'stock untouched (not restored) while pending_verification');
  });

  test(
    '13. CANCEL_ORDER via structured action → stock restored (regression proof)',
    async () => {
      // Path: handleCancelOrder → orderService.cancelOrder → restoreStockForOrderItems
      // Verify cancelOrder restores stock when cancelling an order that was past checkout.
      const convId = await createConversation();
      await cartAuthority.addLine(convId, storeId, customerId, plainId, 2);
      const orderId = await cartAuthority.checkout(convId, storeId); // stock 5 → 3
      const beforeStock = await prisma.product.findUnique({ where: { id: plainId }, select: { stock: true } });
      assert.equal(beforeStock!.stock, 3, 'stock 5 → 3 after checkout');

      // Execute cancelOrder within a transaction (same as handleCancelOrder does via executeClaimedAction)
      await prisma.$transaction(async (tx) => {
        const cancelled = await orderService.cancelOrder(orderId, storeId, customerId, { tx });
        assert.equal(cancelled.orderStatus, 'cancelled', 'structured order transition to cancelled');
      });

      const afterStock = await prisma.product.findUnique({ where: { id: plainId }, select: { stock: true } });
      assert.equal(afterStock!.stock, 5, 'stock restored 3 → 5 by cancelOrder within transaction');

      const finalOrder = await prisma.order.findUnique({ where: { id: orderId }, select: { orderStatus: true } });
      assert.equal(finalOrder!.orderStatus, 'cancelled');
    },
  );
});
