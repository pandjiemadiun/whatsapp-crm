import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../infrastructure/prisma.js';
import { conversationContextService } from '../conversation-context.service.js';
import { productService } from '../product.service.js';
import { orderService } from '../order.service.js';
import { conversationService } from '../conversation.service.js';
// ============================================================
// Order + Context Integration Tests (Phase 1.9.2)
// Runner: npx tsx --test src/business/tests/order-context.integration.test.ts
// ============================================================
const TEST_PREFIX = 'test-1.9.2';
let storeId = '';
let categoryId = '';
let productA = '';
let productB = '';
let conversationId = '';
async function cleanup() {
    await prisma.orderItem.deleteMany({ where: { order: { storeId } } }).catch(() => { });
    await prisma.order.deleteMany({ where: { storeId } }).catch(() => { });
    await prisma.conversationContext.deleteMany({ where: { conversation: { storeId } } }).catch(() => { });
    await prisma.conversationHistory.deleteMany({ where: { conversation: { storeId } } }).catch(() => { });
    await prisma.conversation.deleteMany({ where: { storeId } }).catch(() => { });
    await prisma.product.deleteMany({ where: { storeId } }).catch(() => { });
    await prisma.productCategory.deleteMany({ where: { storeId } }).catch(() => { });
    await prisma.store.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => { });
}
before(async () => {
    await cleanup();
    const store = await prisma.store.create({
        data: { id: `${TEST_PREFIX}-store`, name: 'Test Store 1.9.2', email: 'test-1.9.2@garuda.test' },
    });
    storeId = store.id;
    const category = await prisma.productCategory.create({
        data: { storeId, name: 'Minuman', displayOrder: 1 },
    });
    categoryId = category.id;
    const pa = await prisma.product.create({
        data: { storeId, categoryId, name: 'Es Teh', price: 5000, sku: 'TEA-1', stock: 10 },
    });
    productA = pa.id;
    const pb = await prisma.product.create({
        data: { storeId, categoryId, name: 'Es Jeruk', price: 7000, sku: 'JERUK-1', stock: 0 },
    });
    productB = pb.id;
});
after(async () => {
    await cleanup();
    await prisma.$disconnect();
});
beforeEach(async () => {
    // Conversation baru per test
    const conv = await prisma.conversation.create({
        data: { storeId, customerId: `${TEST_PREFIX}-cust`, customerPhone: '+62812345678' },
    });
    conversationId = conv.id;
});
// ------------------------------------------------------------
test('1. Initialize conversation context', async () => {
    const ctx = await conversationContextService.initializeContext({
        storeId,
        customerId: `${TEST_PREFIX}-cust`,
        conversationId,
    });
    assert.ok(ctx.id);
    assert.equal(ctx.conversationId, conversationId);
    assert.match(ctx.sessionKey, /^[a-f0-9]{64}$/); // SHA256 hex
    assert.ok(ctx.sessionExpireAt > new Date());
    assert.deepEqual(ctx.extractedEntities, {
        discussedItems: [],
        confirmedItems: [],
        lastAmbiguousPrompt: null,
        recipientName: null,
        shippingAddress: null,
        pendingClarification: null,
        previousMutation: null,
        trackedEntities: [],
    });
    assert.deepEqual(ctx.lastMessages, []);
});
test('2. Append messages to context (trim to 10)', async () => {
    await conversationContextService.initializeContext({ storeId, customerId: `${TEST_PREFIX}-cust`, conversationId });
    for (let i = 1; i <= 15; i++) {
        const msg = {
            id: `msg-${i}`,
            conversationId,
            sender: i % 2 === 0 ? 'assistant' : 'customer',
            content: `Pesan ke-${i}`,
            createdAt: new Date(),
        };
        await conversationContextService.appendMessage(conversationId, msg);
    }
    const ctx = await conversationContextService.getContext(conversationId);
    assert.ok(ctx);
    assert.equal(ctx.lastMessages.length, 10); // dipangkas ke 10
    assert.equal(ctx.lastMessages[ctx.lastMessages.length - 1].content, 'Pesan ke-15');
});
test('3. Track extracted entities (merge + dedup, confidence wins)', async () => {
    await conversationContextService.initializeContext({ storeId, customerId: `${TEST_PREFIX}-cust`, conversationId });
    await conversationContextService.updateExtractedEntities(conversationId, [
        { type: 'product', value: 'Es Teh', confidence: 0.6 },
        { type: 'quantity', value: '2', confidence: 0.9 },
    ]);
    await conversationContextService.updateExtractedEntities(conversationId, [
        { type: 'product', value: 'Es Teh', confidence: 0.95 }, // lebih tinggi -> menang
        { type: 'destination', value: 'Jl. Merdeka', confidence: 0.8 },
    ]);
    const ctx = await conversationContextService.getContext(conversationId);
    assert.ok(ctx);
    assert.equal(ctx.extractedEntities.trackedEntities.length, 3); // dedup product
    const teh = ctx.extractedEntities.trackedEntities.find((e) => e.type === 'product' && e.value === 'Es Teh');
    assert.equal(teh?.confidence, 0.95); // confidence tertinggi tersimpan
});
test('4. Update user intent', async () => {
    await conversationContextService.initializeContext({ storeId, customerId: `${TEST_PREFIX}-cust`, conversationId });
    await conversationContextService.updateUserIntent(conversationId, 'purchase');
    const ctx = await conversationContextService.getContext(conversationId);
    assert.equal(ctx?.userIntent, 'purchase');
});
test('5. Create product via ProductService', async () => {
    const product = await productService.createProduct(storeId, categoryId, {
        name: 'Kopi Susu',
        price: 15000,
        sku: 'KOPI-1',
        stock: 5,
        weight: 500,
    });
    assert.ok(product.id);
    assert.equal(product.name, 'Kopi Susu');
    assert.equal(product.currency, 'IDR');
    assert.equal(product.stock, 5);
    assert.equal(product.categoryId, categoryId);
    const fetched = await productService.getProductById(product.id);
    assert.equal(fetched.sku, 'KOPI-1');
});
test('6. Search products (case-insensitive)', async () => {
    const results = await productService.searchProducts(storeId, 'es');
    assert.ok(results.length >= 2); // Es Teh + Es Jeruk
    assert.ok(results.every((p) => p.isActive));
    const empty = await productService.searchProducts(storeId, 'zzz-not-exist');
    assert.equal(empty.length, 0);
});
test('7. Create order with items (validates stock)', async () => {
    await conversationContextService.initializeContext({ storeId, customerId: `${TEST_PREFIX}-cust`, conversationId });
    const order = await orderService.createOrder(storeId, conversationId, `${TEST_PREFIX}-cust`, [
        { productId: productA, quantity: 2 },
    ]);
    assert.ok(order.id);
    assert.equal(order.totalPrice, 10000); // 5000 * 2
    assert.equal(order.orderStatus, 'pending');
    assert.equal(order.items.length, 1);
    assert.equal(order.items[0].productName, 'Es Teh');
    assert.equal(order.items[0].subtotal, 10000);
    // Context entity harus ter-update
    const ctx = await conversationContextService.getContext(conversationId);
    assert.ok(ctx);
    assert.ok(ctx.extractedEntities.trackedEntities.some((e) => e.type === 'order' && e.value === order.id));
    assert.ok(ctx.extractedEntities.trackedEntities.some((e) => e.type === 'product' && e.value === 'Es Teh'));
});
test('T2. Shape consistency: updateExtractedEntities (object) + setPendingClarification (object) → parseExtractedEntities readback preserves both', async () => {
    await conversationContextService.initializeContext({ storeId, customerId: `${TEST_PREFIX}-cust`, conversationId });
    // Penulis 1: updateExtractedEntities → trackedEntities (object shape)
    await conversationContextService.updateExtractedEntities(conversationId, [
        { type: 'product', value: 'Es Teh', confidence: 0.95 },
        { type: 'quantity', value: '2', confidence: 0.9 },
    ]);
    // Penulis 2: setPendingClarification → pendingClarification (object shape)
    await conversationContextService.setPendingClarification(conversationId, {
        question: 'Berapa banyak?',
        options: [{ id: '2', label: '2' }, { id: '3', label: '3' }],
        expected_type: 'choice',
    });
    // Baca lewat parseExtractedEntities (object) — data TIDAK boleh hilang
    const ctx = await conversationContextService.getContext(conversationId);
    assert.ok(ctx);
    assert.ok(ctx.extractedEntities.trackedEntities.length >= 2); // token tidak hilang
    assert.ok(ctx.extractedEntities.pendingClarification); // pendingClarification tidak hilang
    assert.equal(ctx.extractedEntities.pendingClarification?.question, 'Berapa banyak?');
});
test('8. Reject order when stock insufficient', async () => {
    await assert.rejects(() => orderService.createOrder(storeId, conversationId, `${TEST_PREFIX}-cust`, [
        { productId: productB, quantity: 1 }, // stock 0
    ]), (err) => {
        assert.match(String(err.message), /stock/i);
        return true;
    });
});
test('9. Update order status -> confirmed sets confirmedAt', async () => {
    const order = await orderService.createOrder(storeId, conversationId, `${TEST_PREFIX}-cust`, [
        { productId: productA, quantity: 1 },
    ]);
    const confirmed = await orderService.updateOrderStatus(order.id, 'confirmed');
    assert.equal(confirmed.orderStatus, 'confirmed');
    assert.ok(confirmed.confirmedAt);
});
test('10. Add and remove order items', async () => {
    const order = await orderService.createOrder(storeId, conversationId, `${TEST_PREFIX}-cust`, [
        { productId: productA, quantity: 1 },
    ]);
    assert.equal(order.totalPrice, 5000);
    const withAdded = await orderService.addOrderItem(order.id, productA, 2);
    assert.equal(withAdded.items.length, 2);
    assert.equal(withAdded.totalPrice, 5000 + 10000); // 15000
    const removed = await orderService.removeOrderItem(order.id, withAdded.items[1].id);
    assert.equal(removed.items.length, 1);
    assert.equal(removed.totalPrice, 5000);
});
test('11. Session expiry handling', async () => {
    const ctx = await conversationContextService.initializeContext({
        storeId,
        customerId: `${TEST_PREFIX}-cust`,
        conversationId,
        sessionExpireMinutes: 1,
    });
    assert.ok(ctx.sessionExpireAt > new Date());
    // Refresh sesi -> diperpanjang
    await conversationContextService.refreshSession(conversationId, 60);
    const refreshed = await conversationContextService.getContext(conversationId);
    assert.ok(refreshed);
    assert.ok(refreshed.sessionExpireAt.getTime() > ctx.sessionExpireAt.getTime());
});
test('12. Stock availability check (null = unlimited)', async () => {
    const unlimited = await prisma.product.create({
        data: { storeId, categoryId, name: 'Unlimited Item', price: 1000, stock: null },
    });
    assert.equal(await productService.checkStockAvailability(unlimited.id, 999), true);
    assert.equal(await productService.checkStockAvailability(productA, 3), true);
    assert.equal(await productService.checkStockAvailability(productA, 11), false);
});
test('13. Conversation with context + orders', async () => {
    await conversationContextService.initializeContext({ storeId, customerId: `${TEST_PREFIX}-cust`, conversationId });
    await orderService.createOrder(storeId, conversationId, `${TEST_PREFIX}-cust`, [
        { productId: productA, quantity: 1 },
    ]);
    const conv = await conversationService.getConversationWithContext(conversationId);
    assert.ok(conv);
    assert.ok(conv.context);
    assert.equal(conv.context.conversationId, conversationId);
    assert.equal(conv.orders.length, 1);
    assert.equal(conv.orders[0].items.length, 1);
});
test('14. createConversation initializes context automatically', async () => {
    const conv = await conversationService.createConversation(storeId, `${TEST_PREFIX}-cust2`, '+62811111111', 'Budi');
    assert.ok(conv.id);
    assert.ok(conv.context);
    assert.equal(conv.context.conversationId, conv.id);
    assert.deepEqual(conv.orders, []);
});
//# sourceMappingURL=order-context.integration.test.js.map