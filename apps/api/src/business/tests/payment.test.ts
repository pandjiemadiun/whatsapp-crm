import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../infrastructure/prisma.js';
import { orderService } from '../order.service.js';
import { transitionOrder } from '../order-transition.js';
import { paymentService } from '../payment.service.js';

// ============================================================
// Payment report/verify integration tests (G2-F2)
// Runner: npx tsx --env-file=../../.env --test --test-force-exit src/business/tests/payment.test.ts
// ============================================================

const PREFIX = 'test-g2f2';

let storeId = '';
let store2Id = '';
let productA = '';
let custA = ''; // customer milik store1 (web session)
let custB = ''; // customer milik store2 (tenant lain)

async function cleanup() {
  await prisma.orderItem.deleteMany({ where: { order: { storeId: { in: [storeId, store2Id] } } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { storeId: { in: [storeId, store2Id] } } }).catch(() => {});
  await prisma.conversation.deleteMany({ where: { storeId: { in: [storeId, store2Id] } } }).catch(() => {});
  await prisma.customer.deleteMany({ where: { id: { in: [custA, custB] } } }).catch(() => {});
  await prisma.product.deleteMany({ where: { storeId: { in: [storeId, store2Id] } } }).catch(() => {});
  await prisma.productCategory.deleteMany({ where: { storeId: { in: [storeId, store2Id] } } }).catch(() => {});
  await prisma.store.deleteMany({ where: { id: { startsWith: PREFIX } } }).catch(() => {});
}

async function makeOrder(customerId: string, sId: string, opts: { paymentMethod?: string } = {}) {
  const conv = await prisma.conversation.create({
    data: { storeId: sId, customerId, channel: 'web', customerPhone: null, status: 'open' },
  });
  const order = await orderService.createOrder(sId, conv.id, customerId, [
    { productId: productA, quantity: 1 },
  ]);
  if (opts.paymentMethod) {
    await prisma.order.update({ where: { id: order.id }, data: { paymentMethod: opts.paymentMethod } });
  }
  return order as unknown as { id: string; orderStatus: string };
}

before(async () => {
  await cleanup();
  const s1 = await prisma.store.create({
    data: { id: `${PREFIX}-store1`, name: 'G2F2 Store1', email: 'g2f2-1@garuda.test', slug: `${PREFIX}-s1` },
  });
  storeId = s1.id;
  const s2 = await prisma.store.create({
    data: { id: `${PREFIX}-store2`, name: 'G2F2 Store2', email: 'g2f2-2@garuda.test', slug: `${PREFIX}-s2` },
  });
  store2Id = s2.id;

  const cat = await prisma.productCategory.create({ data: { storeId, name: 'Minuman', displayOrder: 1 } });
  const pa = await prisma.product.create({ data: { storeId, categoryId: cat.id, name: 'Es Teh', price: 5000, sku: 'G2F2-TEA', stock: 10 } });
  productA = pa.id;

  const cA = await prisma.customer.create({ data: { storeId, webUid: `${PREFIX}-uid-a`, phone: null } });
  custA = cA.id;
  const cB = await prisma.customer.create({ data: { storeId: store2Id, webUid: `${PREFIX}-uid-b`, phone: null } });
  custB = cB.id;
});

after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

// a. transfer valid -> pending_verification, orderStatus tidak berubah
test('a. payment-report transfer valid -> pending_verification, orderStatus unchanged', async () => {
  const o = await makeOrder(custA, storeId);
  const before = o.orderStatus;
  const r = await paymentService.reportPayment(o.id, storeId, custA, 'transfer', 'https://proof/1');
  assert.equal(r.paymentStatus, 'pending_verification');
  assert.equal(r.orderStatus, before);
  assert.equal(r.paymentMethod, 'transfer');
  assert.ok(r.paymentReportedAt);
});

// b. paymentMethod='cod' -> 400, tidak tulis DB
test('b. payment-report paymentMethod=cod -> 400, no DB write', async () => {
  const o = await makeOrder(custA, storeId);
  await assert.rejects(
    () => paymentService.reportPayment(o.id, storeId, custA, 'cod', 'x'),
    (e: any) => e.statusCode === 400,
  );
  const after = await prisma.order.findUnique({ where: { id: o.id } });
  assert.equal(after!.paymentStatus, 'unpaid');
});

// c. paymentStatus sudah 'paid' -> 400 (no overwrite)
test('c. payment-report paymentStatus already paid -> 400', async () => {
  const o = await makeOrder(custA, storeId);
  await prisma.order.update({ where: { id: o.id }, data: { paymentStatus: 'paid' } });
  await assert.rejects(
    () => paymentService.reportPayment(o.id, storeId, custA, 'transfer', 'x'),
    (e: any) => e.statusCode === 400,
  );
  const after = await prisma.order.findUnique({ where: { id: o.id } });
  assert.equal(after!.paymentStatus, 'paid');
});

// d. payment-verify paymentMethod='cod' -> 400
test('d. payment-verify paymentMethod=cod -> 400', async () => {
  const o = await makeOrder(custA, storeId, { paymentMethod: 'cod' });
  await assert.rejects(
    () => paymentService.verifyPayment(o.id, storeId, 'approve', 'paid', storeId),
    (e: any) => e.statusCode === 400,
  );
});

// e. payment-verify paymentStatus != pending_verification -> 400
test('e. payment-verify paymentStatus not pending_verification -> 400', async () => {
  const o = await makeOrder(custA, storeId); // paymentStatus 'unpaid'
  await assert.rejects(
    () => paymentService.verifyPayment(o.id, storeId, 'approve', 'paid', storeId),
    (e: any) => e.statusCode === 400,
  );
});

// f. payment-verify approve + target VALID -> paid + orderStatus berubah, 1 transaksi
test('f. payment-verify approve valid target -> paid + orderStatus changed', async () => {
  const o = await makeOrder(custA, storeId); // pending
  await paymentService.reportPayment(o.id, storeId, custA, 'qris', 'https://proof/2');
  const adminEmail = 'g2f2-owner@garuda.test';
  const r = await paymentService.verifyPayment(o.id, storeId, 'approve', 'paid', adminEmail);
  assert.equal(r.paymentStatus, 'paid');
  assert.equal(r.orderStatus, 'paid');
  assert.ok(r.paymentVerifiedAt);
  assert.equal(r.verifiedByAdminId, adminEmail);
});

// g. payment-verify approve + target TIDAK VALID -> rollback, paymentStatus tetap pending_verification
test('g. payment-verify approve invalid target -> full rollback', async () => {
  const o = await makeOrder(custA, storeId); // pending
  await paymentService.reportPayment(o.id, storeId, custA, 'transfer', 'https://proof/3');
  await assert.rejects(
    () => paymentService.verifyPayment(o.id, storeId, 'approve', 'completed', storeId),
    (e: any) => e.statusCode === 400,
  );
  const after = await prisma.order.findUnique({ where: { id: o.id } });
  assert.equal(after!.paymentStatus, 'pending_verification'); // TIDAK jadi paid
  assert.equal(after!.orderStatus, 'pending'); // TIDAK berubah
  assert.equal(after!.paymentVerifiedAt, null);
});

// h. payment-verify approve TANPA targetOrderStatus -> 400
test('h. payment-verify approve without targetOrderStatus -> 400', async () => {
  const o = await makeOrder(custA, storeId);
  await paymentService.reportPayment(o.id, storeId, custA, 'transfer', 'https://proof/4');
  await assert.rejects(
    () => paymentService.verifyPayment(o.id, storeId, 'approve', undefined, storeId),
    (e: any) => e.statusCode === 400,
  );
});

// i. payment-verify reject -> paymentStatus='rejected', orderStatus tidak berubah
test('i. payment-verify reject -> rejected, orderStatus unchanged', async () => {
  const o = await makeOrder(custA, storeId); // pending
  await paymentService.reportPayment(o.id, storeId, custA, 'transfer', 'https://proof/5');
  const r = await paymentService.verifyPayment(o.id, storeId, 'reject', undefined, storeId);
  assert.equal(r.paymentStatus, 'rejected');
  assert.equal(r.orderStatus, 'pending');
  assert.ok(r.paymentVerifiedAt);
});

// i2. reject dengan reason -> tersimpan ke paymentRejectReason
test('i2. payment-verify reject + reason -> paymentRejectReason tersimpan', async () => {
  const o = await makeOrder(custA, storeId);
  await paymentService.reportPayment(o.id, storeId, custA, 'transfer', 'https://proof/6');
  const r = await paymentService.verifyPayment(o.id, storeId, 'reject', undefined, storeId, 'Bukti kurang jelas');
  assert.equal(r.paymentStatus, 'rejected');
  assert.equal(r.paymentRejectReason, 'Bukti kurang jelas');
  const db = await prisma.order.findUnique({ where: { id: o.id } });
  assert.equal(db!.paymentRejectReason, 'Bukti kurang jelas');
});

// i3. reject tanpa reason -> paymentRejectReason tetap null (JANGAN wajibkan)
test('i3. payment-verify reject tanpa reason -> paymentRejectReason null', async () => {
  const o = await makeOrder(custA, storeId);
  await paymentService.reportPayment(o.id, storeId, custA, 'transfer', 'https://proof/7');
  const r = await paymentService.verifyPayment(o.id, storeId, 'reject', undefined, storeId);
  assert.equal(r.paymentStatus, 'rejected');
  assert.equal(r.paymentRejectReason, null);
  const db = await prisma.order.findUnique({ where: { id: o.id } });
  assert.equal(db!.paymentRejectReason, null);
});

// j. tenant isolation: store lain / customer lain tidak bisa report/verify
test('j. tenant isolation — order milik store/customer lain ditolak', async () => {
  const o = await makeOrder(custA, storeId); // store1 order
  await assert.rejects(
    () => paymentService.reportPayment(o.id, store2Id, custA, 'transfer', 'x'),
    (e: any) => e.code === 'ERR_NOT_FOUND',
  );
  await assert.rejects(
    () => paymentService.reportPayment(o.id, storeId, 'wrong-cust', 'transfer', 'x'),
    (e: any) => e.code === 'ERR_NOT_FOUND',
  );
  await assert.rejects(
    () => paymentService.verifyPayment(o.id, store2Id, 'approve', 'paid', store2Id),
    (e: any) => e.code === 'ERR_NOT_FOUND',
  );
  // order asli tidak berubah
  const after = await prisma.order.findUnique({ where: { id: o.id } });
  assert.equal(after!.paymentStatus, 'unpaid');
});
