/**
 * G2-F3 — PWA checkout endpoint (POST /api/pwa/:storeSlug/checkout).
 *
 * Runner: npx tsx --env-file=../../.env --test --test-force-exit src/tests/pwa-checkout.test.ts
 *
 * Coverage:
 *  - address kosong -> 400
 *  - paymentMethod invalid -> 400
 *  - uid/orderId wajib -> 400
 *  - COD -> paymentMethod= 'cod', orderStatus tetap 'waiting_address', TIDAK ada
 *    payment-report dipanggil (paymentStatus 'unpaid', paymentProofUrl null)
 *  - transfer -> paymentMethod='transfer', orderStatus 'waiting_address',
 *    next='upload_proof', paymentProofUrl null (menunggu payment-report terpisah)
 *  - qris -> sama dengan transfer
 */
import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import { prisma } from '../infrastructure/prisma.js';
import pwaRouter, { __setShippingServiceForTest } from '../routes/pwa.js';
import { cachedShippingCostService } from '../services/shipping/cached-shipping-cost.service.js';
import { getOrderWeightGrams } from '../services/shipping/order-weight.helper.js';

const PREFIX = 'pwa-checkout-test';
const SLUG = PREFIX;
let server: http.Server;
let baseUrl: string;

before(async () => {
  await prisma.store.upsert({
    where: { id: `${PREFIX}-store` },
    update: {
      name: 'Checkout Test Store',
      slug: SLUG,
      isActive: true,
      acceptsTransfer: true,
      acceptsQris: true,
      acceptsCod: true,
    },
    create: {
      id: `${PREFIX}-store`,
      name: 'Checkout Test Store',
      slug: SLUG,
      isActive: true,
      acceptsTransfer: true,
      acceptsQris: true,
      acceptsCod: true,
      phoneNumber: '+6281200000096',
      address: 'Jl. Checkout No. 1',
      originProvinceId: 'prov-checkout-1',
      originProvinceName: 'Jawa Barat',
      originCityId: 'city-checkout-1',
      originCityName: 'Bandung',
      originSubdistrictId: 'sub-checkout-1',
      originSubdistrictName: 'Coblong',
    },
  });

  await prisma.customer.upsert({
    where: { id: `${PREFIX}-cust` },
    update: { webUid: `${PREFIX}-uid`, storeId: `${PREFIX}-store` },
    create: {
      id: `${PREFIX}-cust`,
      storeId: `${PREFIX}-store`,
      webUid: `${PREFIX}-uid`,
      phone: null,
    },
  });

  await prisma.conversation.upsert({
    where: { id: `${PREFIX}-conv` },
    update: { storeId: `${PREFIX}-store`, customerId: `${PREFIX}-cust`, channel: 'web' },
    create: {
      id: `${PREFIX}-conv`,
      storeId: `${PREFIX}-store`,
      customerId: `${PREFIX}-cust`,
      channel: 'web',
      status: 'open',
    },
  });

  await prisma.order.upsert({
    where: { id: `${PREFIX}-order` },
    update: { orderStatus: 'draft', paymentMethod: null, paymentStatus: 'unpaid', paymentProofUrl: null },
    create: {
      id: `${PREFIX}-order`,
      storeId: `${PREFIX}-store`,
      conversationId: `${PREFIX}-conv`,
      customerId: `${PREFIX}-cust`,
      items: [],
      orderStatus: 'draft',
      paymentMethod: null,
      paymentStatus: 'unpaid',
    },
  });

  const app = express();
  app.use(express.json());
  app.use('/api/pwa', pwaRouter);
  server = app.listen(0);
  const addr = server.address();
  if (typeof addr === 'object' && addr) {
    baseUrl = `http://127.0.0.1:${addr.port}`;
  } else {
    throw new Error('Failed to get test server port');
  }
});

after(async () => {
  await prisma.order.deleteMany({ where: { id: { startsWith: PREFIX } } }).catch(() => {});
  await prisma.bankAccount.deleteMany({ where: { storeId: `${PREFIX}-store` } }).catch(() => {});
  await prisma.conversation.deleteMany({ where: { id: { startsWith: PREFIX } } }).catch(() => {});
  await prisma.customer.deleteMany({ where: { id: { startsWith: PREFIX } } }).catch(() => {});
  await prisma.store.deleteMany({ where: { id: { startsWith: PREFIX } } }).catch(() => {});
  server.close();
});

const checkout = (body: unknown) =>
  fetch(`${baseUrl}/api/pwa/${SLUG}/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('G2-F3 — PWA checkout endpoint', () => {
  test('address kosong -> 400', async () => {
    const res = await checkout({ uid: `${PREFIX}-uid`, orderId: `${PREFIX}-order`, address: '   ', paymentMethod: 'cod' });
    assert.equal(res.status, 400);
  });

  test('paymentMethod invalid -> 400', async () => {
    const res = await checkout({ uid: `${PREFIX}-uid`, orderId: `${PREFIX}-order`, address: 'Jl. Test', paymentMethod: 'bitcoin' });
    assert.equal(res.status, 400);
  });

  test('uid/orderId wajib -> 400', async () => {
    const res = await checkout({ address: 'Jl. Test', paymentMethod: 'cod' });
    assert.equal(res.status, 400);
  });

  test('order bukan milik session -> 404', async () => {
    const res = await checkout({ uid: 'uid-lain', orderId: `${PREFIX}-order`, address: 'Jl. Test', paymentMethod: 'cod' });
    assert.equal(res.status, 401);
  });

  test('COD -> paymentMethod set, tetap waiting_address, TIDAK ada payment-report', async () => {
    const res = await checkout({ uid: `${PREFIX}-uid`, orderId: `${PREFIX}-order`, address: 'Jl. Test 123', paymentMethod: 'cod' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.orderStatus, 'waiting_address');
    assert.equal(body.data.paymentMethod, 'cod');
    assert.equal(body.data.next, 'done');

    const order = await prisma.order.findUnique({ where: { id: `${PREFIX}-order` } });
    assert.equal(order?.orderStatus, 'waiting_address');
    assert.equal(order?.paymentMethod, 'cod');
    assert.equal(order?.shippingAddress, 'Jl. Test 123');
    // Bukti TIDAK di-submit: payment-report tidak dipanggil.
    assert.equal(order?.paymentStatus, 'unpaid');
    assert.equal(order?.paymentProofUrl, null);
  });

  test('transfer -> paymentMethod set, next=upload_proof, menunggu payment-report terpisah', async () => {
    // reset order ke draft agar bisa checkout lagi
    await prisma.order.update({ where: { id: `${PREFIX}-order` }, data: { orderStatus: 'draft', paymentMethod: null, paymentProofUrl: null, paymentStatus: 'unpaid', shippingAddress: null } });

    const res = await checkout({ uid: `${PREFIX}-uid`, orderId: `${PREFIX}-order`, address: 'Jl. Transfer 9', paymentMethod: 'transfer' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.orderStatus, 'waiting_address');
    assert.equal(body.data.paymentMethod, 'transfer');
    assert.equal(body.data.next, 'upload_proof');

    const order = await prisma.order.findUnique({ where: { id: `${PREFIX}-order` } });
    assert.equal(order?.orderStatus, 'waiting_address');
    assert.equal(order?.paymentMethod, 'transfer');
    // Masih menunggu bukti (payment-report terpisah, belum dipanggil).
    assert.equal(order?.paymentStatus, 'unpaid');
    assert.equal(order?.paymentProofUrl, null);
  });

  test('qris -> paymentMethod set, next=upload_proof', async () => {
    await prisma.order.update({ where: { id: `${PREFIX}-order` }, data: { orderStatus: 'draft', paymentMethod: null, paymentProofUrl: null, paymentStatus: 'unpaid', shippingAddress: null } });

    const res = await checkout({ uid: `${PREFIX}-uid`, orderId: `${PREFIX}-order`, address: 'Jl. QRIS 5', paymentMethod: 'qris' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.orderStatus, 'waiting_address');
    assert.equal(body.data.paymentMethod, 'qris');
    assert.equal(body.data.next, 'upload_proof');
  });

  test('destination fields opsional tersimpan kalau dikirim', async () => {
    await prisma.order.update({ where: { id: `${PREFIX}-order` }, data: { orderStatus: 'draft', paymentMethod: null, paymentProofUrl: null, paymentStatus: 'unpaid', shippingAddress: null } });
    const res = await checkout({
      uid: `${PREFIX}-uid`, orderId: `${PREFIX}-order`, address: 'Jl. Dest 1', paymentMethod: 'cod',
      destinationProvinceId: '31', destinationProvinceName: 'DKI Jakarta',
      destinationCityId: '174', destinationCityName: 'Jakarta Barat',
      destinationSubdistrictId: '17473', destinationSubdistrictName: 'GROGOL',
    });
    assert.equal(res.status, 200);
    const order = await prisma.order.findUnique({ where: { id: `${PREFIX}-order` } });
    assert.equal(order?.destinationProvinceId, '31');
    assert.equal(order?.destinationProvinceName, 'DKI Jakarta');
    assert.equal(order?.destinationCityId, '174');
    assert.equal(order?.destinationCityName, 'Jakarta Barat');
    assert.equal(order?.destinationSubdistrictId, '17473');
    assert.equal(order?.destinationSubdistrictName, 'GROGOL');
    assert.equal(order?.shippingAddress, 'Jl. Dest 1');
  });

  test('GET /payment-info mengembalikan accepts* + bankAccounts (reuse BankAccount model)', async () => {
    await prisma.bankAccount.create({
      data: { storeId: `${PREFIX}-store`, bankName: 'BCA', accountNumber: '1234567890', accountName: 'Toko Test', isActive: true },
    });
    const res = await fetch(`${baseUrl}/api/pwa/${SLUG}/payment-info`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.acceptsTransfer, true);
    assert.equal(body.data.acceptsQris, true);
    assert.equal(body.data.acceptsCod, true);
    assert.ok(Array.isArray(body.data.bankAccounts));
    assert.equal(body.data.bankAccounts.length, 1);
    assert.equal(body.data.bankAccounts[0].bankName, 'BCA');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UNIT 2 — order-weight.helper: SUM(OrderItem.quantity * Product.weight).
// ─────────────────────────────────────────────────────────────────────────────
describe('UNIT2 — getOrderWeightGrams', () => {
  const W = 'unit2';
  let orderId: string;

  before(async () => {
    await prisma.store.upsert({
      where: { id: `${W}-store` },
      update: { slug: `${W}-slug`, isActive: true, acceptsCod: true },
      create: {
        id: `${W}-store`, name: 'U2 Store', slug: `${W}-slug`, isActive: true,
        phoneNumber: '+6281200000099', address: 'Jl U2', acceptsCod: true,
        originProvinceId: 'p', originProvinceName: 'P', originCityId: 'c',
        originCityName: 'C', originSubdistrictId: 's', originSubdistrictName: 'S',
      },
    });
    await prisma.customer.upsert({
      where: { id: `${W}-cust` },
      update: { webUid: `${W}-uid`, storeId: `${W}-store` },
      create: { id: `${W}-cust`, storeId: `${W}-store`, webUid: `${W}-uid`, phone: null },
    });
    await prisma.conversation.upsert({
      where: { id: `${W}-conv` },
      update: { storeId: `${W}-store`, customerId: `${W}-cust`, channel: 'web' },
      create: { id: `${W}-conv`, storeId: `${W}-store`, customerId: `${W}-cust`, channel: 'web', status: 'open' },
    });
    const prodA = await prisma.product.create({
      data: { storeId: `${W}-store`, name: 'A', price: 1000, weight: 250, source: 'api' },
    });
    const prodB = await prisma.product.create({
      data: { storeId: `${W}-store`, name: 'B', price: 2000, weight: 400, source: 'api' },
    });
    const order = await prisma.order.create({
      data: {
        id: `${W}-order`, storeId: `${W}-store`, conversationId: `${W}-conv`,
        customerId: `${W}-cust`, items: [], orderStatus: 'draft', paymentStatus: 'unpaid',
      },
    });
    orderId = order.id;
    await prisma.orderItem.createMany({
      data: [
        { orderId, productId: prodA.id, productName: 'A', quantity: 2, unitPrice: 1000, subtotal: 2000 },
        { orderId, productId: prodB.id, productName: 'B', quantity: 3, unitPrice: 2000, subtotal: 6000 },
      ],
    });
  });

  after(async () => {
    await prisma.orderItem.deleteMany({ where: { orderId: { startsWith: W } } }).catch(() => {});
    await prisma.order.deleteMany({ where: { id: { startsWith: W } } }).catch(() => {});
    await prisma.product.deleteMany({ where: { storeId: `${W}-store` } }).catch(() => {});
    await prisma.conversation.deleteMany({ where: { id: { startsWith: W } } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { id: { startsWith: W } } }).catch(() => {});
    await prisma.store.deleteMany({ where: { id: `${W}-store` } }).catch(() => {});
  });

  test('2 item berat beda → hasil sum benar (2*250 + 3*400 = 1700g)', async () => {
    const grams = await getOrderWeightGrams(orderId);
    assert.equal(grams, 2 * 250 + 3 * 400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UNIT 3 — GET /api/pwa/:storeSlug/shipping-options (read-only).
// Shipping service di-inject via __setShippingServiceForTest (stub) — JANGAN
// panggil RajaOngkir asli / habiskan quota di test.
// ─────────────────────────────────────────────────────────────────────────────
describe('UNIT3 — GET /shipping-options', () => {
  const U3 = 'unit3';
  const SLUG3 = `${U3}-slug`;
  let orderId: string;

  const optsUrl = (oid: string) =>
    `${baseUrl}/api/pwa/${SLUG3}/shipping-options?uid=${U3}-uid&orderId=${oid}`;

  before(async () => {
    await prisma.store.upsert({
      where: { id: `${U3}-store` },
      update: { slug: SLUG3, isActive: true, acceptsCod: true, originSubdistrictId: 'orig-1' },
      create: {
        id: `${U3}-store`, name: 'U3 Store', slug: SLUG3, isActive: true, acceptsCod: true,
        phoneNumber: '+6281200000098', address: 'Jl U3',
        originProvinceId: 'p', originProvinceName: 'P', originCityId: 'c', originCityName: 'C',
        originSubdistrictId: 'orig-1', originSubdistrictName: 'O',
      },
    });
    await prisma.customer.upsert({
      where: { id: `${U3}-cust` },
      update: { webUid: `${U3}-uid`, storeId: `${U3}-store` },
      create: { id: `${U3}-cust`, storeId: `${U3}-store`, webUid: `${U3}-uid`, phone: null },
    });
    await prisma.conversation.upsert({
      where: { id: `${U3}-conv` },
      update: { storeId: `${U3}-store`, customerId: `${U3}-cust`, channel: 'web' },
      create: { id: `${U3}-conv`, storeId: `${U3}-store`, customerId: `${U3}-cust`, channel: 'web', status: 'open' },
    });
    const prodA = await prisma.product.create({
      data: { storeId: `${U3}-store`, name: 'A3', price: 1000, weight: 250, source: 'api' },
    });
    const prodB = await prisma.product.create({
      data: { storeId: `${U3}-store`, name: 'B3', price: 2000, weight: 400, source: 'api' },
    });
    const order = await prisma.order.upsert({
      where: { id: `${U3}-order` },
      update: {
        storeId: `${U3}-store`, conversationId: `${U3}-conv`, customerId: `${U3}-cust`,
        orderStatus: 'draft', paymentStatus: 'unpaid',
        destinationSubdistrictId: 'dest-1', destinationSubdistrictName: 'D',
      },
      create: {
        id: `${U3}-order`, storeId: `${U3}-store`, conversationId: `${U3}-conv`,
        customerId: `${U3}-cust`, items: [], orderStatus: 'draft', paymentStatus: 'unpaid',
        destinationSubdistrictId: 'dest-1', destinationSubdistrictName: 'D',
      },
    });
    orderId = order.id;
    await prisma.orderItem.createMany({
      data: [
        { orderId, productId: prodA.id, productName: 'A3', quantity: 2, unitPrice: 1000, subtotal: 2000 },
        { orderId, productId: prodB.id, productName: 'B3', quantity: 3, unitPrice: 2000, subtotal: 6000 },
      ],
    });
  });

  afterEach(() => __setShippingServiceForTest(cachedShippingCostService));

  after(async () => {
    await prisma.orderItem.deleteMany({ where: { orderId: { startsWith: U3 } } }).catch(() => {});
    await prisma.order.deleteMany({ where: { id: { startsWith: U3 } } }).catch(() => {});
    await prisma.product.deleteMany({ where: { storeId: `${U3}-store` } }).catch(() => {});
    await prisma.conversation.deleteMany({ where: { id: { startsWith: U3 } } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { id: { startsWith: U3 } } }).catch(() => {});
    await prisma.store.deleteMany({ where: { id: `${U3}-store` } }).catch(() => {});
    __setShippingServiceForTest(cachedShippingCostService);
  });

  test('destination kosong → 400 "pilih alamat tujuan dulu"', async () => {
    await prisma.order.update({ where: { id: orderId }, data: { destinationSubdistrictId: null } });
    const res = await fetch(optsUrl(orderId));
    assert.equal(res.status, 400);
    await prisma.order.update({ where: { id: orderId }, data: { destinationSubdistrictId: 'dest-1' } });
  });

  test('semua kurir QUOTA_EXCEEDED → success:false error QUOTA_EXCEEDED', async () => {
    __setShippingServiceForTest({ getCost: async () => 'QUOTA_EXCEEDED' } as any);
    const res = await fetch(optsUrl(orderId));
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, false);
    assert.equal(body.error, 'QUOTA_EXCEEDED');
  });

  test('2 kurir sukses → array terurut termurah dulu', async () => {
    __setShippingServiceForTest({
      getCost: async (o: string, d: string, w: number, c: string) =>
        c === 'jne'
          ? [{ courier: 'jne', service: 'CTC', cost: 20000, etd: '2-3' }]
          : [{ courier: 'tiki', service: 'REG', cost: 15000, etd: '3-4' }],
    } as any);
    const res = await fetch(optsUrl(orderId));
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.length, 2);
    assert.equal(body.data[0].courier, 'tiki'); // 15000 < 20000
    assert.equal(body.data[0].cost, 15000);
    assert.equal(body.data[1].courier, 'jne');
    assert.equal(body.data[1].cost, 20000);
  });
});

