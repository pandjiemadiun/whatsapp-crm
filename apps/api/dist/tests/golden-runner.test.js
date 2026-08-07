/**
 * Golden Conversation Tests — runner memakai decideRoute (single source of truth)
 * Runner: npx tsx --env-file=../../.env --test --test-force-exit src/tests/golden-runner.test.ts
 *
 * Memanggil decideRoute + tier terkait TANPA mengirim WA.
 * Dataset: tests/golden-conversations.json
 *
 * Jumlah case: 7 (lihat golden-conversations.json)
 * Bug masa depan = case baru WAJIB masuk file JSON ini.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decideRoute } from '../business/route-decider.js';
import { fallbackService } from '../business/fallback.service.js';
import { prisma } from '../infrastructure/prisma.js';
import { adapters } from '../adapters/container.js';
const goldenPath = join(process.cwd(), 'tests/golden-conversations.json');
const rawDataset = JSON.parse(readFileSync(goldenPath, 'utf-8'));
// Filter: only single-turn cases go to golden runner; multi-turn handled by multi-turn-invariants.test.ts
const dataset = rawDataset.filter(c => !c.turns);
const TOTAL_CASES = dataset.length;
function buildTestCtx(testCase, convId) {
    return {
        conversationId: convId,
        storeId: testCase.context.storeId || 'store-1',
        cart: testCase.context.cart || [],
        activeOrder: testCase.context.activeOrder || null,
        customerCity: testCase.context.customerCity || null,
        lowerMsg: testCase.input.trim().toLowerCase(),
    };
}
async function buildTestCtxNormalized(testCase, convId) {
    const ctx = buildTestCtx(testCase, convId);
    const { normalizeMessage } = await import('../services/chat/normalizer.js');
    const productNames = (testCase.context.cart || []).map(c => c.product);
    const { normalized } = await normalizeMessage(testCase.input, ctx.storeId, productNames);
    ctx.lowerMsg = normalized.toLowerCase();
    return ctx;
}
async function setupDb(testCase, convId) {
    const storeId = testCase.context.storeId || 'store-1';
    // Create conversation
    await prisma.conversation.upsert({
        where: { id: convId },
        update: { status: 'open', deletedAt: null },
        create: {
            id: convId,
            storeId,
            customerId: 'golden-tester',
            customerPhone: 'golden-tester',
            status: 'open',
            channel: 'whatsapp',
            lastMessageAt: new Date(),
            aiResponseCount: 0,
            faqResponseCount: 0,
            metadata: {},
        },
    });
    // Create conversation context with cart
    const cart = testCase.context.cart || [];
    await prisma.conversationContext.upsert({
        where: { conversationId: convId },
        update: { extractedEntities: { confirmedItems: cart, discussedItems: [], lastAmbiguousPrompt: null } },
        create: {
            id: 'ctx-' + convId,
            conversationId: convId,
            lastMessages: [],
            extractedEntities: { confirmedItems: cart, discussedItems: [], lastAmbiguousPrompt: null },
            userIntent: null,
            sessionKey: 'sess-' + convId,
            sessionExpireAt: new Date(Date.now() + 3600000),
        },
    });
    // Create active order if specified
    if (testCase.context.activeOrder) {
        const ao = testCase.context.activeOrder;
        await prisma.order.upsert({
            where: { id: ao.id },
            update: { orderStatus: ao.orderStatus, deletedAt: null },
            create: {
                id: ao.id,
                storeId,
                conversationId: convId,
                customerId: 'golden-tester',
                items: ao.items,
                totalPrice: 15000,
                orderStatus: ao.orderStatus,
                createdAt: new Date(Date.now() - 3600000),
                updatedAt: new Date(),
                deletedAt: null,
            },
        });
    }
}
async function cleanupDb(testCase, convId) {
    try {
        if (testCase.context.activeOrder) {
            await prisma.order.deleteMany({ where: { id: testCase.context.activeOrder.id } }).catch(() => { });
        }
    }
    catch { }
    await prisma.conversationContext.deleteMany({ where: { conversationId: convId } }).catch(() => { });
    await prisma.conversationHistory.deleteMany({ where: { conversationId: convId } }).catch(() => { });
    await prisma.conversation.deleteMany({ where: { id: convId } }).catch(() => { });
}
function makeCtx(testCase, convId) {
    const storeId = testCase.context.storeId || 'store-1';
    return {
        storeId,
        customerId: 'golden-tester',
        conversationId: convId,
        messages: [],
        lastMessageAt: new Date(),
        status: 'active',
    };
}
describe('Golden Dataset — ' + TOTAL_CASES + ' cases', () => {
    before(async () => {
        // Flush Redis cache
        try {
            const redis = await import('redis');
            const client = redis.createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' });
            await client.connect();
            await client.flushAll();
            await client.quit();
        }
        catch (e) {
            adapters.logger.warn('Redis flush failed (non-critical)', { error: e.message });
        }
    });
    after(async () => {
        // Cleanup all golden conversations
        for (const tc of dataset) {
            const convId = 'golden-' + tc.name;
            await cleanupDb(tc, convId);
        }
        await prisma.$disconnect();
    });
    for (const testCase of dataset) {
        const convId = 'golden-' + testCase.name;
        test(testCase.name + ' — ' + testCase.description, async () => {
            // 1. Build context (no DB) and call decideRoute — with normalizer step
            const routeCtx = await buildTestCtxNormalized(testCase, convId);
            const route = await decideRoute(routeCtx);
            // 2. Verify route kind
            const expectedKind = testCase.expect.routeKind;
            assert.equal(route.kind, expectedKind, `Route: expected "${expectedKind}" but got "${route.kind}" for input: "${testCase.input}"`);
            // 3. Setup DB for response verification
            await setupDb(testCase, convId);
            try {
                if (testCase.expect.skipResponse)
                    return;
                const mockCtx = makeCtx(testCase, convId);
                const storeId = testCase.context.storeId || 'store-1';
                const customerCity = testCase.context.customerCity || null;
                let responseContent = '';
                let responseSource;
                switch (route.kind) {
                    case 'order_change':
                        if (testCase.context.activeOrder) {
                            const result = await fallbackService.handleOrderChangeRequest(mockCtx, testCase.input, testCase.context.activeOrder.orderStatus);
                            responseContent = result.content;
                            responseSource = result.source;
                        }
                        break;
                    case 'cart_modify':
                        // Verify route has remove items matching expected
                        if (testCase.expect.cartAfter !== undefined) {
                            const removeItems = route.remove || [];
                            const cartItems = testCase.context.cart || [];
                            const remaining = cartItems.filter(ci => !removeItems.some(rm => ci.product.toLowerCase().includes(rm.toLowerCase())));
                            // Cart should have items removed
                            assert.ok(remaining.length < cartItems.length, `Cart should have fewer items after remove. remove=${JSON.stringify(removeItems)}`);
                        }
                        break;
                    case 'total':
                    case 'order_status':
                    case 'waterfall':
                        const wfResult = await fallbackService.getResponse(testCase.input, { ...mockCtx, customerCity });
                        responseContent = wfResult.message.content;
                        responseSource = wfResult.source;
                        break;
                }
                // 4. Verify source
                if (testCase.expect.source && responseSource) {
                    assert.equal(responseSource, testCase.expect.source, `Source: expected "${testCase.expect.source}" but got "${responseSource}" for input: "${testCase.input}"`);
                }
                // 5. Verify mustContain
                if (testCase.expect.mustContain && responseContent) {
                    for (const expected of testCase.expect.mustContain) {
                        assert.ok(responseContent.toLowerCase().includes(expected.toLowerCase()), `Response must contain "${expected}" but got: "${responseContent.slice(0, 200)}"`);
                    }
                }
                // 6. Verify mustNotContain
                if (testCase.expect.mustNotContain && responseContent) {
                    for (const notExpected of testCase.expect.mustNotContain) {
                        assert.ok(!responseContent.toLowerCase().includes(notExpected.toLowerCase()), `Response must NOT contain "${notExpected}" but got: "${responseContent.slice(0, 200)}"`);
                    }
                }
            }
            finally {
                await cleanupDb(testCase, convId);
            }
        });
    }
});
//# sourceMappingURL=golden-runner.test.js.map