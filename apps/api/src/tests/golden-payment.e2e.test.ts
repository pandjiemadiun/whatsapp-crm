import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { prisma } from '../infrastructure/prisma.js';
import { orderService } from '../business/order.service.js';
import pwaRouter from '../routes/pwa.js';
import ordersRouter from '../routes/orders.js';

// ============================================================
// G2-F5 — Golden dataset: checkout/payment lifecycle (mutation-tested, pola P6-5)
// Runner: npx tsx --env-file=../../.env --test --test-force-exit src/tests/golden-payment.e2e.test.ts
//
// Coverage:
//  (a) draft -> waiting_address (checkout transfer) -> payment-report -> payment-verify
//      approve(target valid) -> orderStatus berubah ke target, paymentStatus=paid.
//  (b) COD checkout -> tetap waiting_address, payment-report untuk order COD -> 400.
//  (c) payment-verify reject -> paymentStatus=rejected, orderStatus TIDAK berubah.
//  (d) payment-verify approve TANPA targetOrderStatus -> 400 (kontrak: jangan tebak state).
//  (e) payment-verify approve targetOrderStatus TIDAK VALID -> rollback penuh,
//      paymentStatus tetap pending_verification.
// ============================================================

const PREFIX = 'golden-pay';
const SLUG = `${PREFIX}-slug`;
let server: any;
let baseUrl = '';
let storeId = '';
let storeToken = '';
let custId = '';
let convId = '';
let productA = '';

async function cleanup() {
  await prisma.orderItem.deleteMany({ where: { order: { storeId } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { storeId } }).catch(() => {});
  await prisma.conversation.deleteMany({ where: { storeId } }).catch(() => {});
  await prisma.customer.deleteMany({ where: { storeId } }).catch(() => {});
  await prisma.product.deleteMany({ where: { storeId } }).catch(() => {});
  await prisma.productCategory.deleteMany({ where: { storeId } }).catch(() => {});
  await prisma.storeSetting.deleteMany({ where: { storeId, key: { in: ['auth_token', 'auth_token_expires_at'] } } }).catch(() => {});
  await prisma.store.deleteMany({ where: { id: { startsWith: PREFIX } } }).catch(() => {});
}

before(async () => {
  await cleanup();

  const s = await prisma.store.create({
    data: {
      id: `${PREFIX}-store`,
      name: 'Golden Pay Store',
      slug: SLUG,
      isActive: true,
      acceptsTransfer: true,
      acceptsQris: true,
      acceptsCod: true,
      phoneNumber: '+6281200000010',
      address: 'Jl. Test No. 10',
      originProvinceId: 'prov-test-10',
      originProvinceName: 'Jawa Barat',
      originCityId: 'city-test-10',
      originCityName: 'Bandung',
      originSubdistrictId: 'sub-test-10',
      originSubdistrictName: 'Coblong',
    },
  });
  storeId = s.id;

  const cat = await prisma.productCategory.create({ data: { storeId, name: 'Makanan', displayOrder: 1 } });
  const p = await prisma.product.create({ data: { storeId, categoryId: cat.id, name: 'Nasi', price: 10000, sku: 'GOLDEN-NASI', stock: 10 } });
  productA = p.id;

  const c = await prisma.customer.create({ data: { storeId, webUid: `${PREFIX}-uid`, phone: null } });
  custId = c.id;
  const conv = await prisma.conversation.create({ data: { storeId, customerId: custId, channel: 'web', status: 'open' } });
  convId = conv.id;

  storeToken = `${PREFIX}-token`;
  const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await prisma.storeSetting.create({ data: { storeId, key: 'auth_token', value: storeToken } });
  await prisma.storeSetting.create({ data: { storeId, key: 'auth_token_expires_at', value: expiry } });

  const app = express();
  app.use(express.json());
  app.use('/api/pwa', pwaRouter);
  app.use('/api/orders', ordersRouter);
  app.use((_req, res) => res.status(404).json({ error: 'not found', code: 'ERR_NOT_FOUND' }));

  server = await new Promise<any>((resolve) => {
    const srv = app.listen(0, () => resolve(srv));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await cleanup();
  await prisma.$disconnect();
});

function pwaPost(path: string, body: any) {
  return fetch(`${baseUrl}/api/pwa/${SLUG}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function ordersPost(path: string, body: any) {
  return fetch(`${baseUrl}/api/orders${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storeToken}` },
    body: JSON.stringify(body),
  });
}

async function createDraftOrder() {
  const o = await prisma.order.create({
    data: {
      id: `order-${Math.random().toString(36).slice(2)}`,
      storeId,
      conversationId: convId,
      customerId: custId,
      orderStatus: 'draft',
      paymentMethod: null,
      paymentStatus: 'unpaid',
      items: [],
    },
  });
  return o.id;
}

async function makePendingPaymentOrder() {
  const o = (await orderService.createOrder(storeId, convId, custId, [{ productId: productA, quantity: 1 }])) as unknown as { id: string };
  await prisma.order.update({
    where: { id: o.id },
    data: {
      paymentMethod: 'transfer',
      paymentStatus: 'pending_verification',
      paymentProofUrl: 'https://proof/golden',
      paymentReportedAt: new Date(),
    },
  });
  return o.id;
}

// (a) draft -> checkout transfer -> payment-report -> verify approve(target=paid) -> paid
test('G2-F5 (a) checkout transfer -> payment-report -> verify approve(target=paid) -> paid', async () => {
  const orderId = await createDraftOrder();
  const co = await pwaPost('/checkout', { uid: `${PREFIX}-uid`, orderId, address: 'Jl. Golden 1', paymentMethod: 'transfer' });
  assert.equal(co.status, 200);
  let body = await co.json();
  assert.equal(body.data.orderStatus, 'waiting_address');
  assert.equal(body.data.paymentMethod, 'transfer');

  const pr = await pwaPost('/payment-report', { uid: `${PREFIX}-uid`, orderId, paymentMethod: 'transfer', proofUrl: 'https://proof/golden-a' });
  assert.equal(pr.status, 200);
  body = await pr.json();
  assert.equal(body.data.paymentStatus, 'pending_verification');

  const v = await ordersPost(`/${orderId}/payment-verify`, { decision: 'approve', targetOrderStatus: 'paid' });
  assert.equal(v.status, 200);
  body = await v.json();
  assert.equal(body.data.paymentStatus, 'paid');
  assert.equal(body.data.orderStatus, 'paid');

  const db = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(db!.paymentStatus, 'paid');
  assert.equal(db!.orderStatus, 'paid');
  assert.ok(db!.paymentVerifiedAt);
});

// (b) COD checkout -> tetap waiting_address; payment-report untuk order COD -> 400
test('G2-F5 (b) COD checkout -> tetap waiting_address, payment-report untuk order COD -> 400', async () => {
  const orderId = await createDraftOrder();
  const co = await pwaPost('/checkout', { uid: `${PREFIX}-uid`, orderId, address: 'Jl. Golden 2', paymentMethod: 'cod' });
  assert.equal(co.status, 200);
  let body = await co.json();
  assert.equal(body.data.orderStatus, 'waiting_address');
  assert.equal(body.data.paymentMethod, 'cod');

  const dbCod = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(dbCod!.paymentStatus, 'unpaid');

  const pr = await pwaPost('/payment-report', { uid: `${PREFIX}-uid`, orderId, paymentMethod: 'transfer', proofUrl: 'https://proof/golden-b' });
  assert.equal(pr.status, 400);
  const db = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(db!.paymentStatus, 'unpaid');
  assert.equal(db!.paymentMethod, 'cod');
});

// (c) payment-verify reject -> paymentStatus=rejected, orderStatus tidak berubah
test('G2-F5 (c) payment-verify reject -> paymentStatus=rejected, orderStatus tidak berubah', async () => {
  const orderId = await makePendingPaymentOrder(); // orderStatus 'pending'
  const v = await ordersPost(`/${orderId}/payment-verify`, { decision: 'reject' });
  assert.equal(v.status, 200);
  const body = await v.json();
  assert.equal(body.data.paymentStatus, 'rejected');
  assert.equal(body.data.orderStatus, 'pending');

  const db = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(db!.paymentStatus, 'rejected');
  assert.equal(db!.orderStatus, 'pending');
});

// (d) payment-verify approve TANPA targetOrderStatus -> 400 (kontrak: jangan tebak state)
test('G2-F5 (d) payment-verify approve TANPA targetOrderStatus -> 400', async () => {
  const orderId = await makePendingPaymentOrder();
  const v = await ordersPost(`/${orderId}/payment-verify`, { decision: 'approve' });
  assert.equal(v.status, 400);
  const db = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(db!.paymentStatus, 'pending_verification');
});

// (e) payment-verify approve targetOrderStatus TIDAK VALID -> rollback penuh, paymentStatus tetap pending_verification
test('G2-F5 (e) payment-verify approve targetOrderStatus TIDAK VALID -> rollback, paymentStatus tetap pending_verification', async () => {
  const orderId = await makePendingPaymentOrder(); // orderStatus 'pending', paymentStatus pending_verification
  // 'refunded' BUKAN transisi valid dari 'pending' (cek getAllowedTransitions('pending')).
  const v = await ordersPost(`/${orderId}/payment-verify`, { decision: 'approve', targetOrderStatus: 'refunded' });
  assert.equal(v.status, 400);
  const db = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(db!.paymentStatus, 'pending_verification');
  assert.equal(db!.orderStatus, 'pending');
});
