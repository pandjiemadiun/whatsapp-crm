import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { prisma } from '../infrastructure/prisma.js';
import { orderService } from '../business/order.service.js';
import { getAllowedTransitions } from '../business/order-transition.js';

// ============================================================
// E2E Tests — Payment Verification routes (G2-F4)
// Covers: GET /api/orders/:id/valid-next-states (new) and the
// existing payment-verify approve/reject, exercised over HTTP with
// proper tenant-scoped store auth.
// Runner: npx tsx --env-file=../../.env --test --test-force-exit src/tests/payment-verify-routes.e2e.test.ts
// ============================================================

const PREFIX = 'e2e-g2f4';
let server: any;
let baseUrl = '';
let storeId = '';
let store2Id = '';
let custA = '';
let convA = '';
let productA = '';
let custB = '';
let convB = '';
let productB = '';
let storeToken = '';
let store2Token = '';

function jsonFetch(path: string, options: any = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

async function parseJson<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function cleanup() {
  await prisma.orderItem.deleteMany({ where: { order: { storeId: { in: [storeId, store2Id] } } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { storeId: { in: [storeId, store2Id] } } }).catch(() => {});
  await prisma.conversation.deleteMany({ where: { storeId: { in: [storeId, store2Id] } } }).catch(() => {});
  await prisma.customer.deleteMany({ where: { storeId: { in: [storeId, store2Id] } } }).catch(() => {});
  await prisma.product.deleteMany({ where: { storeId: { in: [storeId, store2Id] } } }).catch(() => {});
  await prisma.productCategory.deleteMany({ where: { storeId: { in: [storeId, store2Id] } } }).catch(() => {});
  await prisma.storeSetting.deleteMany({ where: { storeId: { in: [storeId, store2Id] }, key: { in: ['auth_token', 'auth_token_expires_at'] } } }).catch(() => {});
  await prisma.store.deleteMany({ where: { id: { startsWith: PREFIX } } }).catch(() => {});
}

before(async () => {
  await cleanup();

  const s1 = await prisma.store.create({
    data: { id: `${PREFIX}-store1`, name: 'G2F4 Store1', email: 'g2f4-1@garuda.test', slug: `${PREFIX}-s1` },
  });
  storeId = s1.id;
  const s2 = await prisma.store.create({
    data: { id: `${PREFIX}-store2`, name: 'G2F4 Store2', email: 'g2f4-2@garuda.test', slug: `${PREFIX}-s2` },
  });
  store2Id = s2.id;

  const cat = await prisma.productCategory.create({ data: { storeId, name: 'Minuman', displayOrder: 1 } });
  const pa = await prisma.product.create({ data: { storeId, categoryId: cat.id, name: 'Es Teh', price: 5000, sku: 'G2F4-TEA', stock: 10 } });
  productA = pa.id;

  const cat2 = await prisma.productCategory.create({ data: { storeId: store2Id, name: 'Minuman2', displayOrder: 1 } });
  const pb = await prisma.product.create({ data: { storeId: store2Id, categoryId: cat2.id, name: 'Es Jeruk', price: 7000, sku: 'G2F4-JERUK', stock: 10 } });
  productB = pb.id;

  const cA = await prisma.customer.create({ data: { storeId, webUid: `${PREFIX}-uid-a`, phone: null } });
  custA = cA.id;
  const conv = await prisma.conversation.create({ data: { storeId, customerId: custA, channel: 'web', customerPhone: null, status: 'open' } });
  convA = conv.id;

  const cB = await prisma.customer.create({ data: { storeId: store2Id, webUid: `${PREFIX}-uid-b`, phone: null } });
  custB = cB.id;
  const conv2 = await prisma.conversation.create({ data: { storeId: store2Id, customerId: custB, channel: 'web', customerPhone: null, status: 'open' } });
  convB = conv2.id;

  // Store auth tokens (mirrors middleware/auth.ts lookup)
  storeToken = `${PREFIX}-token-store1`;
  store2Token = `${PREFIX}-token-store2`;
  const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  for (const [sid, tok] of [[storeId, storeToken], [store2Id, store2Token]] as const) {
    await prisma.storeSetting.create({ data: { storeId: sid, key: 'auth_token', value: tok } });
    await prisma.storeSetting.create({ data: { storeId: sid, key: 'auth_token_expires_at', value: expiry } });
  }

  const ordersRouter = (await import('../routes/orders.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/orders', ordersRouter);
  app.use((_req, res) => res.status(404).json({ error: 'Route not found', code: 'ERR_NOT_FOUND' }));

  server = await new Promise<any>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await cleanup();
  await prisma.$disconnect();
});

// Helper: buat order pending + lapor bukti bayar (transfer)
async function makePendingPaymentOrder(sId: string, cId: string, convId: string, productId: string = productA) {
  const o = (await orderService.createOrder(sId, convId, cId, [{ productId, quantity: 1 }])) as unknown as { id: string };
  await prisma.order.update({
    where: { id: o.id },
    data: {
      paymentMethod: 'transfer',
      paymentStatus: 'pending_verification',
      paymentProofUrl: 'https://proof/g2f4',
      paymentReportedAt: new Date(),
    },
  });
  return o.id;
}

// ─────────────────────────────────────────────────────────────
// valid-next-states (new endpoint)
// ─────────────────────────────────────────────────────────────

test('A. GET valid-next-states — 200 + daftar transisi valid dari state saat ini', async () => {
  const orderId = await makePendingPaymentOrder(storeId, custA, convA); // orderStatus 'pending'
  const res = await jsonFetch(`/api/orders/${orderId}/valid-next-states`, {
    headers: { Authorization: `Bearer ${storeToken}` },
  });
  assert.equal(res.status, 200);
  const body = await parseJson(res);
  assert.equal(body.success, true);
  assert.deepEqual(body.data, getAllowedTransitions('pending'));
  assert.ok(body.data.includes('paid'));
});

test('B. GET valid-next-states — 401 tanpa token', async () => {
  const orderId = await makePendingPaymentOrder(storeId, custA, convA);
  const res = await jsonFetch(`/api/orders/${orderId}/valid-next-states`);
  assert.equal(res.status, 401);
});

test('C. GET valid-next-states — 404 order milik store lain / tidak ada', async () => {
  const orderId = await makePendingPaymentOrder(storeId, custA, convA);
  const res = await jsonFetch(`/api/orders/${orderId}/valid-next-states`, {
    headers: { Authorization: `Bearer ${store2Token}` }, // store beda
  });
  assert.equal(res.status, 404);
});

// ─────────────────────────────────────────────────────────────
// GET /api/orders?paymentStatus= (tenant-scoped filter, new)
// ─────────────────────────────────────────────────────────────

test('D. GET /api/orders?paymentStatus=pending_verification — hanya order terkait store + status', async () => {
  const oId = await makePendingPaymentOrder(storeId, custA, convA);
  await makePendingPaymentOrder(store2Id, custB, convB, productB); // milik store2, tidak boleh muncul
  const res = await jsonFetch('/api/orders?paymentStatus=pending_verification', {
    headers: { Authorization: `Bearer ${storeToken}` },
  });
  assert.equal(res.status, 200);
  const body = await parseJson(res);
  const ids = body.data.map((o: any) => o.id);
  assert.ok(ids.includes(oId));
  assert.ok(body.data.every((o: any) => o.storeId === storeId));
});

// ─────────────────────────────────────────────────────────────
// payment-verify approve/reject (existing endpoint, HTTP smoke)
// ─────────────────────────────────────────────────────────────

test('E. payment-verify approve + target valid — 200, paymentStatus=paid + orderStatus berubah', async () => {
  const orderId = await makePendingPaymentOrder(storeId, custA, convA); // pending
  const res = await jsonFetch(`/api/orders/${orderId}/payment-verify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${storeToken}` },
    body: JSON.stringify({ decision: 'approve', targetOrderStatus: 'paid' }),
  });
  assert.equal(res.status, 200);
  const body = await parseJson(res);
  assert.equal(body.success, true);
  assert.equal(body.data.paymentStatus, 'paid');
  assert.equal(body.data.orderStatus, 'paid');

  const db = await prisma.order.findUnique({ where: { id: orderId } });
  assert.equal(db!.paymentStatus, 'paid');
  assert.equal(db!.orderStatus, 'paid');
});

test('F. payment-verify approve tanpa targetOrderStatus — 400', async () => {
  const orderId = await makePendingPaymentOrder(storeId, custA, convA);
  const res = await jsonFetch(`/api/orders/${orderId}/payment-verify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${storeToken}` },
    body: JSON.stringify({ decision: 'approve' }),
  });
  assert.equal(res.status, 400);
});

test('G. payment-verify reject — 200, paymentStatus=rejected, orderStatus tidak berubah', async () => {
  const orderId = await makePendingPaymentOrder(storeId, custA, convA); // pending
  const res = await jsonFetch(`/api/orders/${orderId}/payment-verify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${storeToken}` },
    body: JSON.stringify({ decision: 'reject' }),
  });
  assert.equal(res.status, 200);
  const body = await parseJson(res);
  assert.equal(body.data.paymentStatus, 'rejected');
  assert.equal(body.data.orderStatus, 'pending');
});
