/**
 * UNIT 3 (post) — null-write bug fix verification.
 *
 * PUT profile dengan field wajib (phoneNumber/address/origin*) dikirim tapi
 * kosong/falsy harus DITOLAK 400, BUKAN diam-diam simpan string kosong /
 * crash (sejak kolom tersebut NOT NULL di DB).
 *
 * Field yang TIDAK dikirim (undefined) tetap di-skip (tidak diubah).
 *
 * Runner:
 *   npx tsx --env-file=../../.env --test --test-force-exit \
 *     src/tests/profile-null-write.test.ts
 */
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import crypto from 'crypto';
import authRouter from '../routes/auth.js';
import profileRouter from '../routes/profile.js';
import { prisma } from '../infrastructure/prisma.js';

const STORE_ID = `null-write-test-${crypto.randomUUID().slice(0, 8)}`;
const TOKEN = 'null-write-test-token';

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);
app.use('/api/profile', profileRouter);

let server: http.Server;
let baseUrl: string;

async function seedStore() {
  await prisma.store.create({
    data: {
      id: STORE_ID,
      name: 'Null Write Test Store',
      email: `${STORE_ID}@garuda.test`,
      phoneNumber: '+6281200000099',
      address: 'Jl. Awal No. 1',
      originProvinceId: 'prov-x',
      originProvinceName: 'Jawa Barat',
      originCityId: 'city-x',
      originCityName: 'Bandung',
      originSubdistrictId: 'sub-x',
      originSubdistrictName: 'Coblong',
    },
  });
  const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await prisma.storeSetting.createMany({
    data: [
      { storeId: STORE_ID, key: 'auth_token', value: TOKEN },
      { storeId: STORE_ID, key: 'auth_token_expires_at', value: expiry },
    ],
  });
}

function putProfile(path: string, body: Record<string, unknown>) {
  return fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
}

before(async () => {
  server = app.listen(0);
  const addr = server.address();
  if (typeof addr === 'object' && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
  else throw new Error('Failed to get test server port');
  await seedStore();
});

after(async () => {
  server?.close();
  await prisma.storeSetting.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
  await prisma.store.delete({ where: { id: STORE_ID } }).catch(() => {});
  await prisma.$disconnect();
});

test('PUT /api/auth/profile phoneNumber="" → 400 (tidak boleh dikosongkan)', async () => {
  const res = await putProfile('/api/auth/profile', { phoneNumber: '' });
  assert.equal(res.status, 400);
});

test('PUT /api/profile address="" → 400 (tidak boleh dikosongkan)', async () => {
  const res = await putProfile('/api/profile', { address: '   ' });
  assert.equal(res.status, 400);
});

test('PUT /api/profile originProvinceId="" → 400 (tidak boleh dikosongkan)', async () => {
  const res = await putProfile('/api/profile', { originProvinceId: '' });
  assert.equal(res.status, 400);
});

test('PUT /api/auth/profile dengan phoneNumber valid → 200 (field dikirim & valid)', async () => {
  const res = await putProfile('/api/auth/profile', { phoneNumber: '+6281299887766' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.phoneNumber, '+6281299887766');
});

test('PUT /api/auth/profile tanpa phoneNumber (undefined) → 200 (skip update, tidak error)', async () => {
  const res = await putProfile('/api/auth/profile', { name: 'Ganti Nama Saja' });
  assert.equal(res.status, 200);
});
