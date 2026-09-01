/**
 * PV-P3 UNIT 2 — Magic Paste: transactional create WITH variants.
 *
 * Acceptance tests (a–f) for the Unit 2 change-set:
 *  (a) owner example → 3 ProductVariant rows + Product.hasVariants=true
 *  (b) non-variant regression → hasVariants=false, 0 variant rows (byte-identical behavior)
 *  (c) variantOverrides (merchant-edited) WIN over raw LLM variants (via admin route)
 *  (d) duplicate SKU within batch → clean 409 ERR_CONFLICT, ZERO rows (atomic rollback)
 *  (e) SKU collides with EXISTING variant (other product, same store) → clean fail, no partial
 *  (f) cart-add after create with no variantId → VARIANT_REQUIRED
 *
 * Runner: npx tsx --env-file=../../.env --test --test-force-exit src/tests/magic-paste-variant-create.e2e.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';

import { prisma } from '../infrastructure/prisma.js';
import { adapters } from '../adapters/container.js';
import { productService } from '../business/product.service.js';
import { ApiError } from '../errors/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import adminProductsRoutes from '../routes/admin/products.js';
import { cartAuthority, CartInvariantError } from '../business/cart-authority.js';

// ============================================================
// Bootstrap (mirrors products-magic-paste.e2e.test.ts + cart-authority.test.ts)
// ============================================================

const PREFIX = 'mp-p3-u2';
const STORE_UUID = 'c0b1c2d3-1111-4222-8333-444455556668';
const CUSTOMER_ID = `${PREFIX}-cust`;

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

/** Stub LLM agar deterministik — set `adapters.ai.generate`. */
function stubLLM(payload: unknown, injectWeight = true) {
  let p = payload;
  if (injectWeight && p && typeof p === 'object' && !('error' in (p as Record<string, unknown>))) {
    const w = (p as Record<string, unknown>).weight;
    p = { ...(p as Record<string, unknown>), weight: w ?? 250 };
  }
  const content = typeof p === 'string' ? p : JSON.stringify(p);
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
  await prisma.productVariant.deleteMany({ where: { storeId: STORE_UUID } }).catch(() => {});
  await prisma.product.deleteMany({ where: { storeId: STORE_UUID } }).catch(() => {});
  await prisma.productCategory.deleteMany({ where: { storeId: STORE_UUID } }).catch(() => {});
  await prisma.magicPasteRun.deleteMany({ where: { storeId: STORE_UUID } }).catch(() => {});
  await prisma.store.deleteMany({ where: { id: STORE_UUID } }).catch(() => {});
  await prisma.adminAuthToken.deleteMany({ where: { adminUser: { email: { startsWith: PREFIX } } } }).catch(() => {});
  await prisma.adminUser.deleteMany({ where: { email: { startsWith: PREFIX } } }).catch(() => {});
}

async function createConversation(): Promise<string> {
  const conv = await prisma.conversation.create({
    data: { storeId, customerId: CUSTOMER_ID, customerPhone: '+6281200000193', channel: 'whatsapp' },
  });
  await prisma.conversationContext.create({
    data: {
      conversationId: conv.id,
      lastMessages: [],
      sessionKey: randomUUID(),
      sessionExpireAt: new Date(Date.now() + 86400000),
    },
  });
  return conv.id;
}

before(async () => {
  await cleanup();

  const store = await prisma.store.upsert({
    where: { id: STORE_UUID },
    update: {},
    create: {
      id: STORE_UUID,
      name: `${PREFIX} Store`,
      email: `${PREFIX}@store.test`,
      phoneNumber: '+6281200000193',
      address: 'Jl. MP No. 1',
      originProvinceId: 'prov-mp-1',
      originProvinceName: 'Jawa Barat',
      originCityId: 'city-mp-1',
      originCityName: 'Bandung',
      originSubdistrictId: 'sub-mp-1',
      originSubdistrictName: 'Coblong',
    },
  });
  storeId = store.id;

  const cat = await prisma.productCategory.create({
    data: { storeId, name: 'Pakaian', displayOrder: 1 },
  });
  categoryId = cat.id;

  const admin = await prisma.adminUser.create({
    data: { email: `${PREFIX}@admin.test`, passwordHash: 'hash', role: 'super_admin' },
  });
  const tokenRow = await prisma.adminAuthToken.create({
    data: {
      adminUserId: admin.id,
      token: `${PREFIX}-token-${Date.now()}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  adminToken = tokenRow.token;

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

// ============================================================
// LLM payloads
// ============================================================

/** Owner example: shared weight 100g, 3 size variants @ 10 stock each, weight=100. */
const OWNER_VARIANTS = [
  { attributes: { size: 's' }, price: 10000, stock: 10, sku: null },
  { attributes: { size: 'm' }, price: 20000, stock: 10, sku: null },
  { attributes: { size: 'l' }, price: 30000, stock: 10, sku: null },
];
const OWNER_LLM = {
  name: 'KemejaU2',
  price: 10000,
  stock: null,
  categoryName: 'Pakaian',
  unit: null,
  description: null,
  weight: 100,
  confidence: 0.95,
  variantConfidence: 0.95,
  variants: OWNER_VARIANTS,
};

/** Simple product (no variant signal). */
const NO_VARIANTS_LLM = {
  name: 'KangkungU2',
  price: 5000,
  stock: 100,
  categoryName: null,
  unit: null,
  description: null,
  confidence: 0.95,
};

// ============================================================
// (a) Owner example: transactional create → 3 variants + hasVariants=true
// ============================================================
test('a. owner example → transactional create produces 3 ProductVariant rows + hasVariants=true', async () => {
  stubLLM(OWNER_LLM);
  const created = await productService.magicPaste(storeId, 'Kemeja 10000 gram 100', {
    preview: false,
    source: 'admin',
  });

  assert.ok(created.product, 'product should be created');
  const productId = created.product!.id;

  // Product-level
  const prod = await prisma.product.findUnique({ where: { id: productId } });
  assert.ok(prod, 'product row exists');
  assert.equal(prod!.hasVariants, true, 'hasVariants flag set true');
  assert.equal(prod!.weight, 100, 'shared weight 100g product-level');
  assert.equal(prod!.stock, null, 'product-level stock null (per-variant stock)');
  assert.equal(prod!.categoryId, categoryId);

  // extractedEntities surfaces variants (dashboard preview/read)
  assert.equal(Array.isArray(created.extractedEntities.variants), true);
  assert.equal((created.extractedEntities.variants as any[]).length, 3);
  assert.equal(created.extractedEntities.variantConfidence, 0.95);

  // 3 variant rows, atomic (all exist or none)
  const variants = await prisma.productVariant.findMany({
    where: { productId },
    orderBy: { price: 'asc' },
  });
  assert.equal(variants.length, 3, 'exactly 3 variant rows');
  const sizes = variants.map((v) => String(v.attributes.size));
  assert.deepEqual(sizes.sort(), ['l', 'm', 's']);
  assert.equal(variants[0].price, 10000); // sorted asc → first = 10000 (size s)
  assert.equal(variants[1].price, 20000);
  assert.equal(variants[2].price, 30000);
  for (const v of variants) {
    assert.equal(v.stock, 10, 'each variant stock = 10');
    assert.equal(v.isActive, true);
    assert.equal(v.storeId, storeId);
  }
});

// ============================================================
// (b) Non-variant regression: hasVariants=false, 0 variant rows
// ============================================================
test('b. non-variant (LLM no variants) → hasVariants=false, 0 ProductVariant rows', async () => {
  stubLLM(NO_VARIANTS_LLM);
  const created = await productService.magicPaste(storeId, 'Kangkung 5000 stok 100', {
    preview: false,
    source: 'admin',
  });

  assert.ok(created.product);
  const productId = created.product!.id;

  const prod = await prisma.product.findUnique({ where: { id: productId } });
  assert.equal(prod!.hasVariants, false, 'hasVariants stays false (regression)');
  assert.equal(prod!.weight, 250); // stubLLM injectWeight default 250

  const variants = await prisma.productVariant.findMany({ where: { productId } });
  assert.equal(variants.length, 0, 'no variant rows for simple product');
  assert.equal(created.extractedEntities.variants, null);
});

// ============================================================
// (c) variantOverrides (merchant-edited) WIN over raw LLM (via admin route)
// ============================================================
test('c. variantOverrides win over raw LLM variants (admin route E2E)', async () => {
  // LLM mengembalikan 1 varian size=s@10000; merchant override size=m@15000
  stubLLM({
    name: 'OverrideU2',
    price: 10000,
    stock: null,
    categoryName: null,
    unit: null,
    description: null,
    weight: 100,
    confidence: 0.9,
    variants: [{ attributes: { size: 's' }, price: 10000, stock: 10, sku: null }],
  });

  const res = await jsonFetch('/api/admin/products/magic-paste', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      storeId,
      text: 'OverrideU2 15000 stok 50 gram 100',
      variantOverrides: [
        { attributes: { size: 'm' }, price: 15000, stock: 50, sku: 'SKU-C-TEST' },
      ],
    }),
  });
  const body = await parseJson(res);
  assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(body)}`);
  const productId = body.data.product.id;

  const variants = await prisma.productVariant.findMany({ where: { productId } });
  assert.equal(variants.length, 1, 'exactly 1 variant (override)');
  // Merchant edit wins: size m (NOT s), price 15000 (NOT 10000)
  assert.equal(variants[0].attributes.size, 'm');
  assert.equal(variants[0].price, 15000);
  assert.equal(variants[0].stock, 50);
  assert.equal(variants[0].sku, 'SKU-C-TEST');

  const prod = await prisma.product.findUnique({ where: { id: productId }, select: { hasVariants: true } });
  assert.equal(prod!.hasVariants, true);
});

// ============================================================
// (d) Duplicate SKU within batch → clean 409, ZERO rows (atomic rollback)
// ============================================================
test('d. duplicate SKU within batch → ERR_CONFLICT 409, ZERO rows (atomic rollback)', async () => {
  stubLLM({ name: 'DupU2', price: 1000, stock: null, categoryName: null, unit: null, description: null, weight: 100, confidence: 0.9 });

  let err: any;
  try {
    await productService.magicPaste(storeId, 'DupU2 1000 gram 100', {
      preview: false,
      variantOverrides: [
        { attributes: { size: 's' }, price: 1000, stock: 5, sku: 'SKU-D-DUP' },
        { attributes: { size: 'm' }, price: 1200, stock: 5, sku: 'SKU-D-DUP' }, // sama → P2002
      ],
    });
  } catch (e: any) {
    err = e;
  }
  assert.ok(err, 'expected magicPaste to throw');
  assert.ok(err instanceof ApiError, `expected ApiError, got ${err?.constructor?.name}`);
  assert.equal(err.code, ErrorCodes.ERR_CONFLICT);
  assert.equal(err.statusCode, 409);

  // Atomic rollback → ZERO rows persisted (product + partial variant rolled back)
  const product = await prisma.product.findFirst({ where: { storeId, name: 'DupU2' } });
  assert.equal(product, null, 'no product persisted on batch-SKU conflict');
  const dupVariant = await prisma.productVariant.findFirst({ where: { storeId, sku: 'SKU-D-DUP' } });
  assert.equal(dupVariant, null, 'no variant persisted on batch-SKU conflict');
});

// ============================================================
// (e) SKU collides with EXISTING variant (other product, same store) → clean fail, no partial
// ============================================================
test('e. SKU collides with existing variant → ERR_CONFLICT 409, no partial, existing untouched', async () => {
  // Pre-buat produk P1 + sebuah variant SKU-E-X
  const p1 = await prisma.product.create({
    data: {
      storeId,
      name: 'EksisU2',
      price: 1000,
      currency: 'IDR',
      sku: 'SKU-E-PROD',
      stock: 5,
      weight: 100,
      source: 'manual',
      isActive: true,
    },
  });
  await prisma.productVariant.create({
    data: {
      productId: p1.id,
      storeId,
      sku: 'SKU-E-X',
      attributes: { size: 's' },
      price: 1000,
      stock: 5,
      isActive: true,
    },
  });

  stubLLM({ name: 'KonflikU2', price: 2000, stock: null, categoryName: null, unit: null, description: null, weight: 100, confidence: 0.9 });

  let err: any;
  try {
    await productService.magicPaste(storeId, 'KonflikU2 2000 gram 100', {
      preview: false,
      variantOverrides: [
        { attributes: { size: 'm' }, price: 2000, stock: 5, sku: 'SKU-E-X' }, // kolisi dengan P1
      ],
    });
  } catch (e: any) {
    err = e;
  }
  assert.ok(err, 'expected magicPaste to throw');
  assert.ok(err instanceof ApiError, `expected ApiError, got ${err?.constructor?.name}`);
  assert.equal(err.code, ErrorCodes.ERR_CONFLICT);
  assert.equal(err.statusCode, 409);

  // P1 + variantnya tidak terdampak (rollback hanya pada tx yang gagal)
  const p1check = await prisma.product.findUnique({ where: { id: p1.id } });
  assert.ok(p1check, 'existing product P1 untouched');
  const p1variant = await prisma.productVariant.findFirst({ where: { productId: p1.id, sku: 'SKU-E-X' } });
  assert.ok(p1variant, 'existing variant SKU-E-X untouched');
  // konflik produk baru (KonflikU2) tidak boleh terbuat (atomic rollback)
  const konflik = await prisma.product.findFirst({ where: { storeId, name: 'KonflikU2' } });
  assert.equal(konflik, null, 'no partial product persisted on SKU collision');
});

// ============================================================
// (f) cart-add setelah create dengan no variantId → VARIANT_REQUIRED
// ============================================================
test('f. cart-add after variant product with no variantId → VARIANT_REQUIRED', async () => {
  // Owner payload (3 variants) tapi nama distinkt untuk test cart (avoid name ambiguity)
  stubLLM({ ...OWNER_LLM, name: 'ProdukFU2', price: 15000, variants: OWNER_VARIANTS });

  const created = await productService.magicPaste(storeId, 'ProdukFU2 15000 gram 100', {
    preview: false,
    source: 'admin',
  });
  assert.ok(created.product);
  const prod = await prisma.product.findUnique({ where: { id: created.product!.id } });
  assert.equal(prod!.hasVariants, true);

  // Conversation (wajib untuk executeOps)
  const convId = await createConversation();

  // Add ke cart TANPA variantId → resolvePriceAndStock throw VARIANT_REQUIRED
  await assert.rejects(
    () =>
      cartAuthority.executeOps(
        [{ type: 'add', product: 'ProdukFU2', qty: 1 } as any],
        storeId,
        CUSTOMER_ID,
        convId,
      ),
    (err: any) => err instanceof CartInvariantError && err.code === ErrorCodes.VARIANT_REQUIRED,
  );
});

// ============================================================
// (g) Malformed variantOverrides (price <= 0) → 400 ERR_VALIDATION, no product
//     (Part 1.2: reject merchant data, don't silently drop)
// ============================================================
test('g. malformed variantOverrides (price <= 0) → 400 ERR_VALIDATION, no product created', async () => {
  stubLLM({
    name: 'BadU2',
    price: 1000,
    stock: null,
    categoryName: null,
    unit: null,
    description: null,
    weight: 100,
    confidence: 0.9,
  });

  let err: any;
  try {
    await productService.magicPaste(storeId, 'BadU2 1000 gram 100', {
      preview: false,
      variantOverrides: [{ attributes: { size: 'm' }, price: 0, stock: 5, sku: 'SKU-G-BAD' }],
    });
  } catch (e: any) {
    err = e;
  }
  assert.ok(err, 'expected throw for malformed override (price <= 0)');
  assert.ok(err instanceof ApiError, `expected ApiError, got ${err?.constructor?.name}`);
  assert.equal(err.code, ErrorCodes.ERR_VALIDATION);
  assert.equal(err.statusCode, 400);

  // Strict validation happens BEFORE the transaction → no partial product
  const p = await prisma.product.findFirst({ where: { storeId, name: 'BadU2' } });
  assert.equal(p, null, 'no product created on validation failure');
});
