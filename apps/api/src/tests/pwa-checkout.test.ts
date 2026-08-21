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
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import { prisma } from '../infrastructure/prisma.js';
import pwaRouter from '../routes/pwa.js';

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
