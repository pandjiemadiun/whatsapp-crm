import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { prisma } from '../infrastructure/prisma.js';
// Route yang diuji (sama seperti yang di-mount di index.ts)
import productsRouter from '../routes/products.js';
import adminProductsRoutes from '../routes/admin/products.js';
// ============================================================
// E2E Tests — Product Routes (Phase 1.9.2b)
// Runner: npx tsx --test --test-force-exit src/tests/products-routes.e2e.test.ts
// ============================================================
const PREFIX = 'e2e-1.9.2';
let server;
let baseUrl = '';
let storeId = '';
let categoryId = '';
let adminToken = '';
let createdProductId = '';
function jsonFetch(path, options = {}) {
    return fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });
}
/** Parse response JSON dengan type assertion (Res.json() = unknown di Node 22) */
async function parseJson(res) {
    return (await res.json());
}
async function cleanup() {
    await prisma.product.deleteMany({ where: { storeId: { startsWith: PREFIX } } }).catch(() => { });
    await prisma.productCategory.deleteMany({ where: { storeId: { startsWith: PREFIX } } }).catch(() => { });
    await prisma.conversation.deleteMany({ where: { storeId: { startsWith: PREFIX } } }).catch(() => { });
    await prisma.store.deleteMany({ where: { id: { startsWith: PREFIX } } }).catch(() => { });
    await prisma.adminAuthToken.deleteMany({ where: { adminUser: { email: { startsWith: PREFIX } } } }).catch(() => { });
    await prisma.adminUser.deleteMany({ where: { email: { startsWith: PREFIX } } }).catch(() => { });
}
before(async () => {
    await cleanup();
    // ── Seed data test ──
    const store = await prisma.store.create({
        data: { id: `${PREFIX}-store`, name: 'E2E Store', email: `${PREFIX}@store.test` },
    });
    storeId = store.id;
    const category = await prisma.productCategory.create({
        data: { storeId, name: 'Sayuran', displayOrder: 1 },
    });
    categoryId = category.id;
    const product = await prisma.product.create({
        data: {
            storeId,
            categoryId,
            name: 'Kangkung Segar',
            price: 3000,
            stock: 50,
            sku: 'SKU-E2E-1',
        },
    });
    createdProductId = product.id;
    // Admin user + token
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
    // ── Express app dengan routes yang diuji ──
    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminProductsRoutes);
    app.use('/api', productsRouter);
    // 404 handler agar konsisten dengan produksi
    app.use((_req, res) => {
        res.status(404).json({ error: 'Route not found', code: 'ERR_NOT_FOUND' });
    });
    server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    if (server)
        await new Promise((r) => server.close(r));
    await cleanup();
    await prisma.$disconnect();
});
// ─────────────────────────────────────────────────────────────
// CONSUMER ROUTES
// ─────────────────────────────────────────────────────────────
test('1. GET list products — 200 OK + pagination', async () => {
    const res = await jsonFetch(`/api/stores/${storeId}/products`);
    assert.equal(res.status, 200);
    const body = await parseJson(res);
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data.products));
    assert.equal(body.data.products.length, 1);
    assert.equal(body.data.products[0].name, 'Kangkung Segar');
    assert.equal(body.data.pagination.total, 1);
    assert.equal(body.data.pagination.hasMore, false);
});
test('2. GET list products — 404 store not found', async () => {
    const res = await jsonFetch('/api/stores/nonexistent-store/products');
    assert.equal(res.status, 404);
    const body = await parseJson(res);
    assert.match(body.error, /Store not found/i);
});
test('3. GET list products — 400 invalid pagination (limit > 100)', async () => {
    const res = await jsonFetch(`/api/stores/${storeId}/products?limit=999`);
    assert.equal(res.status, 400);
    const body = await parseJson(res);
    assert.equal(body.error, 'Validation failed');
});
test('4. GET search products — 200 OK + pagination', async () => {
    const res = await jsonFetch(`/api/stores/${storeId}/products/search?q=kangkung`);
    assert.equal(res.status, 200);
    const body = await parseJson(res);
    assert.equal(body.success, true);
    assert.equal(body.data.query, 'kangkung');
    assert.equal(body.data.results.length, 1);
    assert.equal(body.data.pagination.total, 1);
    assert.equal(body.data.results[0].name, 'Kangkung Segar');
});
test('5. GET search products — 400 q < 2 chars', async () => {
    const res = await jsonFetch(`/api/stores/${storeId}/products/search?q=a`);
    assert.equal(res.status, 400);
    const body = await parseJson(res);
    assert.equal(body.error, 'Validation failed');
});
test('6. GET search products — 404 store not found', async () => {
    const res = await jsonFetch('/api/stores/nonexistent-store/products/search?q=kangkung');
    assert.equal(res.status, 404);
});
test('7. GET product detail — 200 OK', async () => {
    const res = await jsonFetch(`/api/products/${createdProductId}`);
    assert.equal(res.status, 200);
    const body = await parseJson(res);
    assert.equal(body.success, true);
    assert.equal(body.data.id, createdProductId);
    assert.equal(body.data.name, 'Kangkung Segar');
    assert.equal(body.data.category.name, 'Sayuran');
});
test('8. GET product detail — 404 not found', async () => {
    const res = await jsonFetch('/api/products/nonexistent-id');
    assert.equal(res.status, 404);
});
// ─────────────────────────────────────────────────────────────
// ADMIN ROUTES
// ─────────────────────────────────────────────────────────────
test('9. POST create product — 201 OK (admin)', async () => {
    const res = await jsonFetch(`/api/admin/stores/${storeId}/products`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
            name: 'Bayam Hijau',
            price: 2500,
            stock: 30,
            sku: 'SKU-E2E-2',
            categoryId,
        }),
    });
    assert.equal(res.status, 201);
    const body = await parseJson(res);
    assert.equal(body.success, true);
    assert.equal(body.data.name, 'Bayam Hijau');
    assert.equal(body.data.price, 2500);
});
test('10. POST create product — 400 validation error (missing name/price/sku)', async () => {
    const res = await jsonFetch(`/api/admin/stores/${storeId}/products`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ name: '', price: -5 }),
    });
    assert.equal(res.status, 400);
    const body = await parseJson(res);
    assert.equal(body.error, 'Validation failed');
    assert.ok(Array.isArray(body.details));
});
test('11. POST create product — 400 SKU duplicate per store', async () => {
    const res = await jsonFetch(`/api/admin/stores/${storeId}/products`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
            name: 'Kangkung Lain',
            price: 1000,
            sku: 'SKU-E2E-1', // sudah dipakai
            categoryId,
        }),
    });
    assert.equal(res.status, 400);
    const body = await parseJson(res);
    assert.match(body.error, /already exists/i);
});
test('12. POST create product — 401 unauthorized (no token)', async () => {
    const res = await jsonFetch(`/api/admin/stores/${storeId}/products`, {
        method: 'POST',
        body: JSON.stringify({ name: 'X', price: 1, sku: 'SKU-NO-AUTH' }),
    });
    assert.equal(res.status, 401);
});
test('13. POST create product — 404 category not found', async () => {
    const res = await jsonFetch(`/api/admin/stores/${storeId}/products`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
            name: 'Produk Tanpa Kategori',
            price: 1000,
            sku: 'SKU-E2E-3',
            categoryId: '00000000-0000-0000-0000-000000000000',
        }),
    });
    assert.equal(res.status, 404);
    assert.match((await parseJson(res)).error, /Category not found/i);
});
test('14. PATCH update product — 200 OK (admin)', async () => {
    const res = await jsonFetch(`/api/admin/products/${createdProductId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ price: 3500, stock: 40 }),
    });
    assert.equal(res.status, 200);
    const body = await parseJson(res);
    assert.equal(body.data.price, 3500);
    assert.equal(body.data.stock, 40);
});
test('15. PATCH update product — 400 invalid categoryId (bukan UUID)', async () => {
    const res = await jsonFetch(`/api/admin/products/${createdProductId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ categoryId: 'not-a-uuid' }),
    });
    assert.equal(res.status, 400);
});
test('16. DELETE product — 204 OK (admin)', async () => {
    const res = await jsonFetch(`/api/admin/products/${createdProductId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 204);
});
test('17. GET deleted product — 404 (soft delete works)', async () => {
    const res = await jsonFetch(`/api/products/${createdProductId}`);
    assert.equal(res.status, 404);
});
test('18. DELETE product — 404 not found', async () => {
    const res = await jsonFetch('/api/admin/products/nonexistent-id', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 404);
});
//# sourceMappingURL=products-routes.e2e.test.js.map