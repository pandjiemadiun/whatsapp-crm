import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { prisma } from '../infrastructure/prisma.js';
import analyticsRoutes from '../routes/analytics.js';

// ============================================================
// E2E Tests — Analytics Magic Paste (Phase 1.9.6 hardening)
// Runner: npx tsx --test --test-force-exit src/tests/analytics.e2e.test.ts
//
// Memverifikasi:
//  1. Filter from/to INCLUSIVE start/end-of-day (bug fix 1.9.6)
//  2. Trend grouping konsisten dengan filter (tidak pindah hari UTC)
//  3. Agregasi summary (total, avg, median, lowConf, successRate)
//  4. Filter status & source
// ============================================================

const PREFIX = 'anl-hardening';
const STORE_ID = `store-${PREFIX}`;
let server: any;
let baseUrl = '';
let token = '';

function jsonFetch(path: string, options: any = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
}

async function parseJson<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function cleanup() {
  await prisma.magicPasteRun.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
  await prisma.storeSetting.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
  await prisma.store.deleteMany({ where: { id: STORE_ID } }).catch(() => {});
}

before(async () => {
  await cleanup();

  await prisma.store.upsert({
    where: { id: STORE_ID },
    update: {},
    create: {
      id: STORE_ID,
      name: 'Analytics Test Store',
      phoneNumber: '+6281200000092',
      address: 'Jl. Analytics No. 1',
      originProvinceId: 'prov-analytics-1',
      originProvinceName: 'Jawa Barat',
      originCityId: 'city-analytics-1',
      originCityName: 'Bandung',
      originSubdistrictId: 'sub-analytics-1',
      originSubdistrictName: 'Coblong',
    },
  });

  token = `${PREFIX}-token-${Date.now()}`;
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await prisma.storeSetting.upsert({
    where: { storeId_key: { storeId: STORE_ID, key: 'auth_token' } },
    update: { value: token },
    create: { storeId: STORE_ID, key: 'auth_token', value: token },
  });
  await prisma.storeSetting.upsert({
    where: { storeId_key: { storeId: STORE_ID, key: 'auth_token_expires_at' } },
    update: { value: expiresAt },
    create: { storeId: STORE_ID, key: 'auth_token_expires_at', value: expiresAt },
  });

  // Data test: 3 record hari ini dengan timestamp berbeda
  const today = new Date();
  const mk = (h: number, min: number, sec: number) => {
    const d = new Date(today);
    d.setHours(h, min, sec, 0);
    return d;
  };
  const baseEntities = (name: string, confidence: number) =>
    ({ name, price: 10000, confidence }) as any;

  await prisma.magicPasteRun.createMany({
    data: [
      // Pagi (00:01) — case yang dulu hilang karena UTC off-by-one
      { id: crypto.randomUUID(), storeId: STORE_ID, confidence: 0.95, status: 'success', textLength: 20, extractedEntities: baseEntities('Pagi Product', 0.95), source: 'store', createdAt: mk(0, 1, 0) },
      // Siang
      { id: crypto.randomUUID(), storeId: STORE_ID, confidence: 0.7, status: 'success', textLength: 25, extractedEntities: baseEntities('Siang Product', 0.7), source: 'store', createdAt: mk(12, 0, 0) },
      // Malam (23:59) — case yang dulu bisa pindah hari di trend UTC
      { id: crypto.randomUUID(), storeId: STORE_ID, confidence: 0.5, status: 'failed', textLength: 30, extractedEntities: baseEntities('Malam Product', 0.5), source: 'admin', createdAt: mk(23, 59, 0) },
    ],
  });

  const app = express();
  app.use(express.json());
  app.use('/api/analytics', analyticsRoutes);
  app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

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

// ─────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────

test('1. Auth: tanpa token → 401', async () => {
  const res = await jsonFetch('/api/analytics/magic-paste');
  assert.equal(res.status, 401);
});

// ─────────────────────────────────────────────────────────────
// DATE FILTER (bug fix: from/to inclusive)
// ─────────────────────────────────────────────────────────────

test('2. from=today & to=today → semua 3 record masuk (pagi 00:01 TIDAK hilang)', async () => {
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const res = await jsonFetch(`/api/analytics/magic-paste?from=${ymd}&to=${ymd}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await parseJson(res);
  assert.equal(body.data.pagination.total, 3, 'record pagi 00:01 harus masuk filter from=today');
});

test('3. from=kemarin & to=kemarin → 0 record (rentang kemarin kosong)', async () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const ymd = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  const res = await jsonFetch(`/api/analytics/magic-paste?from=${ymd}&to=${ymd}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await parseJson(res);
  assert.equal(body.data.pagination.total, 0);
});

// ─────────────────────────────────────────────────────────────
// SUMMARY AGGREGATION
// ─────────────────────────────────────────────────────────────

test('4. Summary: total 3, success 2, failed 1, avg & median benar', async () => {
  const res = await jsonFetch('/api/analytics/magic-paste', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await parseJson(res);
  const s = body.data.summary;
  assert.equal(s.totalExtractions, 3);
  assert.equal(s.totalSuccess, 2);
  assert.equal(s.failedCount, 1);
  assert.equal(s.previewCount, 0);
  // avg dari SEMUA record: (0.95 + 0.7 + 0.5) / 3 = 0.7166… → 0.72
  assert.equal(s.averageConfidence, 0.72);
  // median dari success-only: [0.7, 0.95] → 0.825 → dibulatkan 2 desimal → 0.83
  assert.equal(s.medianConfidence, 0.83);
  // low confidence: success < 0.8 → 1 (0.7)
  assert.equal(s.lowConfidenceCount, 1);
  assert.equal(s.lowConfidenceRate, 0.5);
  // success rate: 2/3 = 0.67
  assert.equal(s.successRate, 0.67);
});

// ─────────────────────────────────────────────────────────────
// TREND (bug fix: grouping tidak pindah hari)
// ─────────────────────────────────────────────────────────────

test('5. Trend: record hari ini masuk bucket hari ini (bukan pindah hari)', async () => {
  const res = await jsonFetch('/api/analytics/magic-paste', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await parseJson(res);
  const todayKey = localKey(new Date());
  const todayBucket = body.data.trend.find((t: any) => t.date === todayKey);
  assert.ok(todayBucket, `bucket ${todayKey} harus ada`);
  assert.equal(todayBucket.count, 3, 'semua 3 record masuk bucket hari ini');
  // avg bucket = (0.95+0.7+0.5)/3 = 0.7166 → 0.72
  assert.equal(todayBucket.avgConfidence, 0.72);
});

// ─────────────────────────────────────────────────────────────
// FILTER STATUS & SOURCE
// ─────────────────────────────────────────────────────────────

test('6. Filter status=success → hanya 2 record', async () => {
  const res = await jsonFetch('/api/analytics/magic-paste?status=success', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await parseJson(res);
  assert.equal(body.data.pagination.total, 2);
  assert.ok(body.data.history.every((h: any) => h.status === 'success'));
});

test('7. Filter source=admin → hanya 1 record', async () => {
  const res = await jsonFetch('/api/analytics/magic-paste?source=admin', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await parseJson(res);
  assert.equal(body.data.pagination.total, 1);
  assert.equal(body.data.history[0].source, 'admin');
});

test('8. Distribusi: success [0.95, 0.7] → high 1, medium 1, low 0', async () => {
  const res = await jsonFetch('/api/analytics/magic-paste', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await parseJson(res);
  assert.deepEqual(body.data.distribution, { low: 0, medium: 1, high: 1 });
});

test('9. History: kolom extractedName & errorMessage konsisten', async () => {
  const res = await jsonFetch('/api/analytics/magic-paste', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await parseJson(res);
  const names = body.data.history.map((h: any) => h.extractedName).sort();
  assert.deepEqual(names, ['Malam Product', 'Pagi Product', 'Siang Product']);
  const failed = body.data.history.find((h: any) => h.status === 'failed');
  assert.ok(failed);
  assert.equal(failed.errorMessage, null); // dibuat tanpa errorMessage
});

/** Key tanggal lokal (server timezone) — konsisten dengan utils/date-range */
function localKey(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${dd}`;
}
