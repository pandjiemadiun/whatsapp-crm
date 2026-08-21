/**
 * UNIT 2 — Registrasi toko: phoneNumber/address/origin* wajib.
 *
 * Verifies that POST /api/auth/register rejects payloads missing the
 * now-mandatory contact/location fields with HTTP 400 (zod schema).
 *
 * Runner:
 *   npx tsx --env-file=../../.env --test --test-force-exit \
 *     src/tests/register-validation.test.ts
 */
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import authRouter from '../routes/auth.js';
import { prisma } from '../infrastructure/prisma.js';

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

let server: http.Server;
let baseUrl: string;

before(async () => {
  server = app.listen(0);
  const addr = server.address();
  if (typeof addr === 'object' && addr) {
    baseUrl = `http://127.0.0.1:${addr.port}`;
  } else {
    throw new Error('Failed to get test server port');
  }
});

after(async () => {
  server?.close();
  await prisma.$disconnect();
});

const BASE = {
  email: 'register-validation@garuda.test',
  password: 'secret123',
};

const FULL = {
  ...BASE,
  phoneNumber: '081234567890',
  address: 'Jl. Test No. 1',
  originProvinceId: 'prov-1',
  originProvinceName: 'Jawa Barat',
  originCityId: 'city-1',
  originCityName: 'Bandung',
  originSubdistrictId: 'sub-1',
  originSubdistrictName: 'Coblong',
};

async function postRegister(body: unknown) {
  return fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('register TANPA phone/address/lokasi → 400', async () => {
  const res = await postRegister(BASE); // only email + password (old shape)
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error, 'harus ada pesan error');
});

test('register TANPA phoneNumber → 400', async () => {
  const { phoneNumber, ...rest } = FULL;
  void phoneNumber;
  const res = await postRegister(rest);
  assert.equal(res.status, 400);
});

test('register dengan format phoneNumber tidak valid → 400', async () => {
  const res = await postRegister({ ...FULL, phoneNumber: '12345' });
  assert.equal(res.status, 400);
});

test('register dengan address kosong → 400', async () => {
  const res = await postRegister({ ...FULL, address: '   ' });
  assert.equal(res.status, 400);
});

test('register dengan field lokasi kosong → 400', async () => {
  const res = await postRegister({ ...FULL, originCityId: '' });
  assert.equal(res.status, 400);
});
