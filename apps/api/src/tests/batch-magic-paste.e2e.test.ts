import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { prisma } from '../infrastructure/prisma.js';
import { adapters } from '../adapters/container.js';
import storeProductsRoutes from '../routes/store-products.js';

// ============================================================
// E2E Tests — Magic Paste BATCH (Phase 1.9.7)
// Runner: npx tsx --test --test-force-exit src/tests/batch-magic-paste.e2e.test.ts
//
// LLM di-stub agar deterministik. Store auth token dibuat langsung di DB
// (tanpa endpoint login → tidak kena rate limit).
// ============================================================

const PREFIX = 'mp-batch';
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

/** Stub LLM deterministik — parse pola "name <harga>" sederhana. */
function stubLLM() {
  (adapters.ai as any).generate = async (prompt: string, _options?: any) => {
    const m = /NOW EXTRACT THIS TEXT:\s*([\s\S]+)$/.exec(prompt);
    const line = m ? m[1].trim() : '';
    const pm = line.match(/^(.+?)\s+(\d+)$/);
    const parsed = pm
      ? { name: pm[1], price: parseInt(pm[2], 10) }
      : { error: 'cannot parse', name: null, price: null, confidence: 0.3 };
    const payload = {
      name: parsed.name ?? null,
      price: parsed.price ?? null,
      stock: null,
      categoryName: null,
      unit: null,
      description: null,
      priceDisplay: null,
      confidence: parsed.error ? 0.3 : 0.9,
      error: parsed.error ?? undefined,
    };
    return {
      content: JSON.stringify(payload),
      provider: 'stub',
      model: 'stub',
      tokens: { input: 0, output: 0 },
      cost: 0,
    };
  };
}

async function cleanup() {
  await prisma.magicPasteRun.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
  await prisma.product.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
  await prisma.storeSetting.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
  await prisma.store.deleteMany({ where: { id: STORE_ID } }).catch(() => {});
}

before(async () => {
  await cleanup();
  stubLLM();

  await prisma.store.upsert({
    where: { id: STORE_ID },
    update: {},
    create: {
      id: STORE_ID,
      name: 'Batch Store',
      phoneNumber: '+6281200000103',
      address: 'Jl. Batch No. 1',
      originProvinceId: 'prov-batch-1',
      originProvinceName: 'Jawa Barat',
      originCityId: 'city-batch-1',
      originCityName: 'Bandung',
      originSubdistrictId: 'sub-batch-1',
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

  const app = express();
  app.use(express.json());
  app.use('/api/products', storeProductsRoutes);
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

const AUTH = () => ({ Authorization: `Bearer ${token}` });

// ─────────────────────────────────────────────────────────────
test('1. Auth: tanpa token → 401', async () => {
  const res = await jsonFetch('/api/products/my/magic-paste/batch?preview=true', {
    method: 'POST',
    body: JSON.stringify({ text: 'A 1000\nB 2000' }),
  });
  assert.equal(res.status, 401);
});

test('2. Preview batch: multi-baris semua sukses', async () => {
  const res = await jsonFetch('/api/products/my/magic-paste/batch?preview=true', {
    method: 'POST',
    headers: AUTH(),
    body: JSON.stringify({ text: 'Kangkung 5000\nKubis 3000\nWortel 7000' }),
  });
  assert.equal(res.status, 200);
  const body = await parseJson(res);
  assert.equal(body.data.summary.total, 3);
  assert.equal(body.data.summary.success, 3);
  assert.equal(body.data.summary.failed, 0);
  assert.equal(body.data.items[0].status, 'success');
  assert.equal(body.data.items[0].extractedEntities.name, 'Kangkung');
});

test('3. Preview batch: campuran sukses + gagal (baris tanpa harga)', async () => {
  const res = await jsonFetch('/api/products/my/magic-paste/batch?preview=true', {
    method: 'POST',
    headers: AUTH(),
    body: JSON.stringify({ text: 'Tahu 3000\nbaris rusak tanpa harga\nTempe 2500' }),
  });
  const body = await parseJson(res);
  assert.equal(body.data.summary.total, 3);
  assert.equal(body.data.summary.success, 2);
  assert.equal(body.data.summary.failed, 1);
  const failed = body.data.items.find((it: any) => it.status === 'failed');
  assert.ok(failed);
  assert.ok(failed.error, 'baris gagal harus punya pesan error');
});

test('4. Preview batch: CRLF & baris kosong di-skip', async () => {
  const res = await jsonFetch('/api/products/my/magic-paste/batch?preview=true', {
    method: 'POST',
    headers: AUTH(),
    body: JSON.stringify({ text: 'Tahu 3000\r\n\r\nTempe 2500\n\nGula 13000' }),
  });
  const body = await parseJson(res);
  assert.equal(body.data.summary.total, 3);
  assert.equal(body.data.summary.success, 3);
});

test('5. Preview batch: baris > 500 char → skipped', async () => {
  const long = `Nama ${'x'.repeat(600)} 15000`;
  const res = await jsonFetch('/api/products/my/magic-paste/batch?preview=true', {
    method: 'POST',
    headers: AUTH(),
    body: JSON.stringify({ text: `Tahu 3000\n${long}\nTempe 2500` }),
  });
  const body = await parseJson(res);
  assert.equal(body.data.summary.skipped, 1);
  const skipped = body.data.items.find((it: any) => it.status === 'skipped');
  assert.ok(skipped);
  assert.match(skipped.error, /terlalu panjang/);
});

test('6. Preview batch: max 20 baris', async () => {
  const lines = Array.from({ length: 25 }, (_, i) => `Produk${i} ${1000 + i}`);
  const res = await jsonFetch('/api/products/my/magic-paste/batch?preview=true', {
    method: 'POST',
    headers: AUTH(),
    body: JSON.stringify({ text: lines.join('\n') }),
  });
  const body = await parseJson(res);
  assert.equal(body.data.items.length, 20);
});

test('7. Create batch: hanya item sukses yang jadi produk', async () => {
  const res = await jsonFetch('/api/products/my/magic-paste/batch', {
    method: 'POST',
    headers: AUTH(),
    body: JSON.stringify({ text: 'Rendang 50000\nbaris gagal\nSate 20000' }),
  });
  const body = await parseJson(res);
  assert.equal(body.data.summary.success, 2);
  assert.equal(body.data.summary.failed, 1);

  const products = await prisma.product.findMany({
    where: { storeId: STORE_ID, source: 'magic_paste' },
    select: { name: true },
  });
  const names = products.map((p) => p.name);
  assert.ok(names.includes('Rendang'));
  assert.ok(names.includes('Sate'));
  assert.ok(!names.includes('baris gagal'));
});

test('8. Analytics: setiap item batch tercatat (preview + create)', async () => {
  const runs = await prisma.magicPasteRun.findMany({
    where: { storeId: STORE_ID },
    select: { status: true },
  });
  // Test 2,3,4,5,6 (preview) + 7 (create) — minimal ada 1 success create
  const successCreate = runs.filter((r) => r.status === 'success').length;
  assert.ok(successCreate >= 2, 'minimal 2 success create (Rendang + Sate)');
  const preview = runs.filter((r) => r.status === 'preview').length;
  assert.ok(preview >= 5, 'minimal 5 preview');
  const failed = runs.filter((r) => r.status === 'failed').length;
  assert.ok(failed >= 1, 'minimal 1 failed');
});

test('9. Validasi: text hanya newline → 400', async () => {
  const res = await jsonFetch('/api/products/my/magic-paste/batch?preview=true', {
    method: 'POST',
    headers: AUTH(),
    body: JSON.stringify({ text: '\n\n\n' }),
  });
  assert.equal(res.status, 400);
});
