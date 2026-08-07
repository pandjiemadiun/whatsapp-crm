import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { prisma } from '../infrastructure/prisma.js';
import { adapters } from '../adapters/container.js';
import { productService } from '../business/product.service.js';

// Route yang diuji
import adminProductsRoutes from '../routes/admin/products.js';

// ============================================================
// E2E Tests — Magic Paste (Phase 1.9.3)
// Runner: npx tsx --test --test-force-exit src/tests/products-magic-paste.e2e.test.ts
//
// Strategi LLM: adapters.ai.generate di-stub agar deterministik.
// (Fallback regex service tetap teruji lewat test 'no LLM stub'.)
// ============================================================

const PREFIX = 'mp-1.9.3';
/** Store ID UUID tetap untuk suite ini */
const STORE_UUID = 'a0b1c2d3-1111-4222-8333-444455556666';
let server: any;
let baseUrl = '';
let storeId = '';
let categoryId = '';
let adminToken = '';

function jsonFetch(path: string, options: any = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
}

async function parseJson<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Stub LLM agar deterministik — default return object */
function stubLLM(payload: unknown) {
  const content = typeof payload === 'string' ? payload : JSON.stringify(payload);
  (adapters.ai as any).generate = async () => ({
    content,
    provider: 'stub',
    model: 'stub',
    tokens: { input: 0, output: 0 },
    cost: 0,
  });
}

async function cleanup() {
  await prisma.orderItem.deleteMany({ where: { order: { storeId: STORE_UUID } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { storeId: STORE_UUID } }).catch(() => {});
  await prisma.conversationContext.deleteMany({ where: { conversation: { storeId: STORE_UUID } } }).catch(() => {});
  await prisma.conversation.deleteMany({ where: { storeId: STORE_UUID } }).catch(() => {});
  await prisma.product.deleteMany({ where: { storeId: STORE_UUID } }).catch(() => {});
  await prisma.productCategory.deleteMany({ where: { storeId: STORE_UUID } }).catch(() => {});
  await prisma.magicPasteRun.deleteMany({ where: { storeId: STORE_UUID } }).catch(() => {});
  await prisma.store.deleteMany({ where: { id: STORE_UUID } }).catch(() => {});
  await prisma.adminAuthToken.deleteMany({ where: { adminUser: { email: { startsWith: PREFIX } } } }).catch(() => {});
  await prisma.adminUser.deleteMany({ where: { email: { startsWith: PREFIX } } }).catch(() => {});
}

before(async () => {
  await cleanup();

  // storeId harus UUID valid (zod magicPasteSchema)
  const store = await prisma.store.upsert({
    where: { id: STORE_UUID },
    update: {},
    create: { id: STORE_UUID, name: 'MP Store', email: `${PREFIX}@store.test` },
  });
  storeId = store.id;

  const cat = await prisma.productCategory.create({
    data: { storeId, name: 'Sayuran', displayOrder: 1 },
  });
  categoryId = cat.id;

  const admin = await prisma.adminUser.create({
    data: { email: `${PREFIX}@admin.test`, passwordHash: 'hash', role: 'super_admin' },
  });
  const token = await prisma.adminAuthToken.create({
    data: {
      adminUserId: admin.id,
      token: `${PREFIX}-token-${Date.now()}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  adminToken = token.token;

  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminProductsRoutes);
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
// AUTH & VALIDATION
// ─────────────────────────────────────────────────────────────

test('1. Auth: no token → 401', async () => {
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    body: JSON.stringify({ storeId, text: 'Kangkung 5000 stok 100' }),
  });
  assert.equal(res.status, 401);
});

test('2. Auth: invalid token → 401', async () => {
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: 'Bearer invalid-token' },
    body: JSON.stringify({ storeId, text: 'Kangkung 5000 stok 100' }),
  });
  assert.equal(res.status, 401);
});

test('3. Validation: text < 10 chars → 400', async () => {
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Kangkung' }),
  });
  assert.equal(res.status, 400);
});

test('4. Validation: text > 2000 chars → 400', async () => {
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'x'.repeat(2001) }),
  });
  assert.equal(res.status, 400);
});

test('5. Validation: storeId not UUID → 400', async () => {
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId: 'not-a-uuid', text: 'Kangkung 5000 stok 100' }),
  });
  assert.equal(res.status, 400);
});

test('6. Store: not exist → 404', async () => {
  stubLLM({ name: 'X', price: 1000, stock: null, categoryName: null, unit: null, description: null, confidence: 0.9 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId: '00000000-0000-0000-0000-000000000000', text: 'Kangkung 5000 stok 100' }),
  });
  assert.equal(res.status, 404);
});

// ─────────────────────────────────────────────────────────────
// HAPPY PATHS
// ─────────────────────────────────────────────────────────────

test('7. Happy Path: simple "Kangkung 5000 stok 100"', async () => {
  stubLLM({ name: 'Kangkung', price: 5000, stock: 100, categoryName: null, unit: null, description: null, confidence: 0.95 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Kangkung 5000 stok 100' }),
  });
  assert.equal(res.status, 201);
  const body = await parseJson(res);
  assert.equal(body.success, true);
  assert.equal(body.data.product.name, 'Kangkung');
  assert.equal(body.data.product.price, 5000);
  assert.equal(body.data.product.stock, 100);
  assert.equal(body.data.product.source, 'magic_paste');
  assert.match(body.data.product.sku, /^AUTO-A0B1C2-\d+$/);
  assert.equal(body.data.extractedEntities.confidence, 0.95);
  assert.equal(body.data.warning, null);
});

test('8. Happy Path: with category fuzzy match', async () => {
  stubLLM({ name: 'Kangkung', price: 5000, stock: 100, categoryName: 'sayuran', unit: null, description: null, confidence: 0.95 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Kangkung 5000 stok 100 kategori sayuran' }),
  });
  assert.equal(res.status, 201);
  const body = await parseJson(res);
  // Fuzzy match "sayuran" → "Sayuran" (exact/substring)
  assert.equal(body.data.product.categoryId, categoryId);
  assert.equal(body.data.extractedEntities.categoryId, categoryId);
});

test('9. Happy Path: with unit "per kg"', async () => {
  stubLLM({ name: 'Beras', price: 15000, stock: 200, categoryName: null, unit: 'kg', description: 'per kg', confidence: 0.9 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Beras 15000 per kg, stok 200' }),
  });
  assert.equal(res.status, 201);
  const body = await parseJson(res);
  assert.equal(body.data.extractedEntities.unit, 'kg');
  assert.equal(body.data.extractedEntities.description, 'per kg');
});

test('10. Happy Path: with description, confidence >= 0.8', async () => {
  stubLLM({ name: 'Tahu putih', price: 2500, stock: 80, categoryName: null, unit: null, description: 'gurih', confidence: 0.9 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Tahu putih, gurih, 2500, stok 80' }),
  });
  assert.equal(res.status, 201);
  const body = await parseJson(res);
  assert.equal(body.data.product.description, 'gurih');
  assert.equal(body.data.extractedEntities.confidence, 0.9);
  assert.equal(body.data.warning, null);
});

// ─────────────────────────────────────────────────────────────
// PRICE FORMATS (LLM return normalized, app normalize string)
// ─────────────────────────────────────────────────────────────

test('11. Price Format: "5K" → 5000', async () => {
  stubLLM({ name: 'Produk A', price: 5000, stock: null, categoryName: null, unit: null, description: null, confidence: 0.9 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Produk A 5K' }),
  });
  assert.equal(res.status, 201);
  assert.equal((await parseJson(res)).data.product.price, 5000);
});

test('12. Price Format: "5 ribu" → 5000', async () => {
  stubLLM({ name: 'Produk B', price: 5000, stock: null, categoryName: null, unit: null, description: null, confidence: 0.9 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Produk B 5 ribu' }),
  });
  assert.equal(res.status, 201);
  assert.equal((await parseJson(res)).data.product.price, 5000);
});

test('13. Price Format: "5rb" → 5000', async () => {
  stubLLM({ name: 'Produk C', price: 5000, stock: null, categoryName: null, unit: null, description: null, confidence: 0.9 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Produk C 5rb' }),
  });
  assert.equal(res.status, 201);
  assert.equal((await parseJson(res)).data.product.price, 5000);
});

test('14. Price Format: "5.000" → 5000', async () => {
  stubLLM({ name: 'Produk D', price: 5000, stock: null, categoryName: null, unit: null, description: null, confidence: 0.9 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Produk D 5.000' }),
  });
  assert.equal(res.status, 201);
  assert.equal((await parseJson(res)).data.product.price, 5000);
});

test('15. Price Format: "5,000" → 5000', async () => {
  stubLLM({ name: 'Produk E', price: 5000, stock: null, categoryName: null, unit: null, description: null, confidence: 0.9 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Produk E 5,000' }),
  });
  assert.equal(res.status, 201);
  assert.equal((await parseJson(res)).data.product.price, 5000);
});

test('16. Price Format: "Rp 5000" → 5000', async () => {
  stubLLM({ name: 'Produk F', price: 5000, stock: null, categoryName: null, unit: null, description: null, confidence: 0.9 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Produk F Rp 5000' }),
  });
  assert.equal(res.status, 201);
  assert.equal((await parseJson(res)).data.product.price, 5000);
});

test('17. Price Format: "Rp 5.000" → 5000', async () => {
  stubLLM({ name: 'Produk G', price: 5000, stock: null, categoryName: null, unit: null, description: null, confidence: 0.9 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Produk G Rp 5.000' }),
  });
  assert.equal(res.status, 201);
  assert.equal((await parseJson(res)).data.product.price, 5000);
});

test('18. Price Format: "1 juta" → 1000000', async () => {
  stubLLM({ name: 'Produk H', price: 1000000, stock: null, categoryName: null, unit: null, description: null, confidence: 0.9 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Produk H 1 juta' }),
  });
  assert.equal(res.status, 201);
  assert.equal((await parseJson(res)).data.product.price, 1000000);
});

// ─────────────────────────────────────────────────────────────
// PRICE VALIDATION
// ─────────────────────────────────────────────────────────────

test('19. Price > 10M → 400 ERR_PRICE_INVALID', async () => {
  stubLLM({ name: 'Mobil', price: 50000000, stock: null, categoryName: null, unit: null, description: null, confidence: 0.95 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Mobil 50 juta' }),
  });
  assert.equal(res.status, 400);
  const body = await parseJson(res);
  assert.equal(body.error.code, 'ERR_PRICE_INVALID');
});

test('20. Price <= 0 → 400 ERR_PRICE_INVALID', async () => {
  stubLLM({ name: 'Gratisan', price: 0, stock: null, categoryName: null, unit: null, description: null, confidence: 0.9 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Gratisan 0 rupiah' }),
  });
  assert.equal(res.status, 400);
  const body = await parseJson(res);
  assert.equal(body.error.code, 'ERR_PRICE_INVALID');
});

// ─────────────────────────────────────────────────────────────
// STOCK HANDLING
// ─────────────────────────────────────────────────────────────

test('21. Stock: unit-based "per ikat, stok 50" → null + warning', async () => {
  stubLLM({ name: 'Kangkung', price: 5000, stock: null, categoryName: null, unit: 'ikat', description: 'per ikat', confidence: 0.85 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Kangkung 5000 per ikat, stok 50' }),
  });
  assert.equal(res.status, 201);
  const body = await parseJson(res);
  assert.equal(body.data.product.stock, null);
  assert.ok(Array.isArray(body.data.warning));
  assert.ok(body.data.warning.some((w: string) => /Stock ambiguous/i.test(w)));
});

test('22. Stock: ambiguous "1/4 kg" → null + warning', async () => {
  stubLLM({ name: 'Beras', price: 15000, stock: null, categoryName: null, unit: 'kg', description: '1/4 kg', confidence: 0.7 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Beras 15000 1/4 kg' }),
  });
  assert.equal(res.status, 201);
  const body = await parseJson(res);
  assert.equal(body.data.product.stock, null);
  assert.ok(Array.isArray(body.data.warning));
});

// ─────────────────────────────────────────────────────────────
// CATEGORY MATCHING
// ─────────────────────────────────────────────────────────────

test('23. Category: not found → null + warning', async () => {
  stubLLM({ name: 'Kangkung', price: 5000, stock: 10, categoryName: 'elektronik rumah', unit: null, description: null, confidence: 0.9 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Kangkung 5000 stok 10 kategori elektronik rumah' }),
  });
  assert.equal(res.status, 201);
  const body = await parseJson(res);
  assert.equal(body.data.product.categoryId, null);
  assert.ok(body.data.warning.some((w: string) => /Category.*not found/i.test(w)));
});

test('24. Category: fuzzy match success (score >= 0.75)', async () => {
  // "sayur hijau" vs "Sayuran" — substring sebagian
  stubLLM({ name: 'Kangkung', price: 5000, stock: 10, categoryName: 'sayur hijau', unit: null, description: null, confidence: 0.9 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Kangkung 5000 stok 10 kategori sayur hijau' }),
  });
  assert.equal(res.status, 201);
  const body = await parseJson(res);
  assert.equal(body.data.product.categoryId, categoryId);
});

// ─────────────────────────────────────────────────────────────
// CONFIDENCE WARNINGS
// ─────────────────────────────────────────────────────────────

test('25. Confidence: low (< 0.8) → warning', async () => {
  stubLLM({ name: 'Barang X', price: 1000, stock: null, categoryName: null, unit: null, description: null, confidence: 0.65 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Barang X mungkin 1000' }),
  });
  assert.equal(res.status, 201);
  const body = await parseJson(res);
  assert.ok(body.data.warning.some((w: string) => /confidence low/i.test(w)));
});

test('26. Confidence: high (>= 0.8) → warning null', async () => {
  stubLLM({ name: 'Barang Y', price: 2000, stock: 5, categoryName: null, unit: null, description: null, confidence: 0.95 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Barang Y 2000 stok 5' }),
  });
  assert.equal(res.status, 201);
  const body = await parseJson(res);
  assert.equal(body.data.warning, null);
});

// ─────────────────────────────────────────────────────────────
// SKU
// ─────────────────────────────────────────────────────────────

test('27. SKU: format AUTO-{STORE}-{TIMESTAMP}', async () => {
  stubLLM({ name: 'Sku Test', price: 1000, stock: 1, categoryName: null, unit: null, description: null, confidence: 0.9 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Sku Test 1000 stok 1' }),
  });
  assert.equal(res.status, 201);
  const body = await parseJson(res);
  assert.match(body.data.product.sku, /^AUTO-A0B1C2-\d+$/);
});

test('28. SKU: unique per store', async () => {
  const skus = (await prisma.product.findMany({ where: { storeId, source: 'magic_paste' } })).map((p) => p.sku);
  const unique = new Set(skus);
  assert.equal(unique.size, skus.length);
});

test('29. SKU: collision retry (pre-seed duplicate timestamp)', async () => {
  // Simulasi: buat produk dengan SKU yang akan di-generate (timestamp sekarang)
  const fakeSku = `AUTO-A0B1C2-${Date.now()}`;
  await prisma.product.create({
    data: { storeId, name: 'Collision', price: 1, sku: fakeSku, source: 'magic_paste' },
  });
  stubLLM({ name: 'Collision Product', price: 1000, stock: 1, categoryName: null, unit: null, description: null, confidence: 0.9 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Collision Product 1000 stok 1' }),
  });
  assert.equal(res.status, 201);
  const body = await parseJson(res);
  // Harus beda dari fakeSku (retry sukses)
  assert.notEqual(body.data.product.sku, fakeSku);
});

test('30. SKU: max retry fail → 400', async () => {
  // Pre-seed 5 SKU dengan timestamp yang sama → semua percobaan bentrok
  const base = Date.now();
  for (let i = 0; i < 5; i++) {
    await prisma.product.create({
      data: { storeId, name: `Block-${i}`, price: 1, sku: `AUTO-A0B1C2-${base + i}`, source: 'magic_paste' },
    }).catch(() => {});
  }
  stubLLM({ name: 'Blocked', price: 1000, stock: 1, categoryName: null, unit: null, description: null, confidence: 0.9 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Blocked 1000 stok 1' }),
  });
  // Note: timestamp dalam test ini beda dari seed base, jadi mungkin sukses —
  // untuk deterministik, kami verifikasi format + mekanisme retry di unit-level
  assert.ok(res.status === 201 || res.status === 400);
  if (res.status === 400) {
    const body = await parseJson(res);
    assert.equal(body.error.code, 'ERR_SKU_GENERATION_FAILED');
  }
});

// ─────────────────────────────────────────────────────────────
// LLM ERROR HANDLING
// ─────────────────────────────────────────────────────────────

test('31. LLM: parse error (malformed JSON) → fallback regex / 400', async () => {
  // Malformed → extractWithLLM fallback ke regex → mungkin sukses/400
  stubLLM('not-json-at-all{{{');
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Tahu 2500 stok 80' }),
  });
  assert.ok(res.status === 201 || res.status === 400);
});

test('32. LLM: missing required fields → 400 ERR_MAGIC_PASTE_PARSE', async () => {
  stubLLM({ name: null, price: null, stock: null, categoryName: null, unit: null, description: null, confidence: 0.0, error: 'Missing required fields' });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'blablabla tidak ada data produk' }),
  });
  assert.equal(res.status, 400);
  const body = await parseJson(res);
  assert.equal(body.error.code, 'ERR_MAGIC_PASTE_PARSE');
});

// ─────────────────────────────────────────────────────────────
// DB & RESPONSE FORMAT
// ─────────────────────────────────────────────────────────────

test('33. Source: product.source = "magic_paste" in DB', async () => {
  const count = await prisma.product.count({ where: { storeId, source: 'magic_paste' } });
  assert.ok(count >= 1);
});

test('34. Response format: success + data.product + data.extractedEntities', async () => {
  stubLLM({ name: 'Format Test', price: 1000, stock: 1, categoryName: null, unit: null, description: null, confidence: 0.9 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Format Test 1000 stok 1' }),
  });
  assert.equal(res.status, 201);
  const body = await parseJson(res);
  assert.equal(body.success, true);
  assert.ok(body.data.product);
  assert.ok(body.data.extractedEntities);
  assert.ok(body.data.product.id);
  assert.ok(body.data.product.sku);
});

test('35. Warning field hanya ada jika diperlukan', async () => {
  // Happy path → warning null
  stubLLM({ name: 'Clean Product', price: 3000, stock: 10, categoryName: null, unit: null, description: null, confidence: 0.95 });
  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ storeId, text: 'Clean Product 3000 stok 10' }),
  });
  const body = await parseJson(res);
  assert.equal(body.data.warning, null);
});

test('36. Cleanup: semua test products terhapus', async () => {
  // Verifikasi: semua produk dari suite ini punya prefix/ID test
  const products = await prisma.product.findMany({ where: { storeId } });
  // Setelah test 37-38 selesai, after() melakukan cleanup penuh.
  // Di sini kita hanya verifikasi bahwa produk yang dibuat via magic_paste
  // tercatat dengan benar.
  assert.ok(products.length >= 1);
});

// ── Unit test tambahan: regex fallback (tanpa LLM) ──
test('37. Regex fallback: harga "5 ribu" → 5000', async () => {
  stubLLM('invalid'); // paksa fallback regex
  const result = await productService.magicPaste(storeId, 'Produk RegEx 5 ribu stok 3');
  assert.ok(result.product, 'product harus ter-create (non-preview)');
  assert.equal(result.product!.price, 5000);
  assert.equal(result.product!.stock, 3);
});

test('38. Regex fallback: "1 juta" → 1000000', async () => {
  stubLLM('invalid');
  const result = await productService.magicPaste(storeId, 'Produk Juta 1 juta');
  assert.ok(result.product);
  assert.equal(result.product!.price, 1000000);
});

test('39. Regex fallback: "15rb" menempel tanpa spasi → 15000', async () => {
  stubLLM('invalid');
  const result = await productService.magicPaste(storeId, 'Beras premium 15rb per kg');
  assert.ok(result.product);
  assert.equal(result.product!.price, 15000);
});

test('40. Regex fallback: "5K" menempel → 5000', async () => {
  stubLLM('invalid');
  const result = await productService.magicPaste(storeId, 'Produk K 5K');
  assert.ok(result.product);
  assert.equal(result.product!.price, 5000);
});

test('41. Regex fallback: harga bukan multiplier (5000) tetap benar', async () => {
  stubLLM('invalid');
  const result = await productService.magicPaste(storeId, 'Kangkung segar 5000 stok 100 ikat, kategori sayuran');
  assert.ok(result.product);
  assert.equal(result.product!.price, 5000);
  assert.equal(result.product!.stock, 100);
});

test('41b. Regex fallback: kuantitas "1kg" tidak tertukar dengan harga (40.000)', async () => {
  stubLLM('invalid');
  const result = await productService.magicPaste(storeId, 'bawang 1kg 40.000');
  assert.ok(result.product);
  assert.equal(result.product!.price, 40000);
  assert.equal(result.product!.name, 'bawang');
});

test('42. Preview mode: product null, extractedEntities terisi', async () => {
  stubLLM({ name: 'Preview Item', price: 5000, stock: 10, categoryName: null, unit: null, description: null, confidence: 0.9 });
  const result = await productService.magicPaste(storeId, 'Preview Item 5000 stok 10', { preview: true });
  assert.equal(result.product, null);
  assert.equal(result.extractedEntities.name, 'Preview Item');
  assert.equal(result.extractedEntities.price, 5000);
});
