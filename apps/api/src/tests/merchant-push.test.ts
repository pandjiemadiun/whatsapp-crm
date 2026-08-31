import { test } from 'node:test';
import assert from 'node:assert';
import { prisma } from '../infrastructure/prisma.js';

let STORE_A: string;
let STORE_B: string;

test('setup: get two existing stores', async () => {
  const stores = await prisma.store.findMany({ where: { deletedAt: null }, take: 2, select: { id: true } });
  assert.ok(stores.length >= 2, 'need at least 2 stores for tenant isolation test');
  STORE_A = stores[0].id;
  STORE_B = stores[1].id;
});

test('setup: create test push subscriptions', async () => {
  await prisma.storePushSubscription.createMany({
    data: [
      { storeId: STORE_A, endpoint: 'https://fcm.googleapis.com/a', auth: 'authA', p256dh: 'p256dhA' },
      { storeId: STORE_B, endpoint: 'https://fcm.googleapis.com/b', auth: 'authB', p256dh: 'p256dhB' },
    ],
  });
});

test('tenant isolation: Store A subs scoped to Store A only', async () => {
  const subsA = await prisma.storePushSubscription.findMany({
    where: { storeId: STORE_A },
    select: { endpoint: true, storeId: true },
  });
  assert.equal(subsA.length, 1);
  assert.equal(subsA[0].storeId, STORE_A);
  assert.equal(subsA[0].endpoint, 'https://fcm.googleapis.com/a');
});

test('tenant isolation: Store B subs separate from Store A', async () => {
  const subsB = await prisma.storePushSubscription.findMany({
    where: { storeId: STORE_B },
    select: { endpoint: true, storeId: true },
  });
  assert.equal(subsB.length, 1);
  assert.equal(subsB[0].storeId, STORE_B);
  assert.equal(subsB[0].endpoint, 'https://fcm.googleapis.com/b');
});

test('tenant isolation: no cross-contamination', async () => {
  const all = await prisma.storePushSubscription.findMany({
    where: { storeId: { in: [STORE_A, STORE_B] } },
  });
  for (const s of all) {
    if (s.storeId === STORE_A) assert.equal(s.endpoint, 'https://fcm.googleapis.com/a');
    if (s.storeId === STORE_B) assert.equal(s.endpoint, 'https://fcm.googleapis.com/b');
  }
});

test('teardown: remove test subscriptions', async () => {
  await prisma.storePushSubscription.deleteMany({
    where: { storeId: { in: [STORE_A, STORE_B] } },
  });
});
