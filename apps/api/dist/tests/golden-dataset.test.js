/**
 * Golden Dataset Integration Test
 *
 * Runner: npx tsx --env-file=../../.env --test --test-force-exit src/tests/golden-dataset.test.ts
 *
 * 10 permanent test cases covering the 5-stage chat-flow pipeline:
 *   Stage 1 — Resolver (pending-clarification, 0 LLM)
 *   Stage 2 — Normalizer (typo + I12 product-preservation guard, 0 LLM)
 *   Stage 3 — Tier (rule-based fast-path, 0 LLM)
 *   Stage 4 — Interpreter (≤1 LLM via groqAdapter.generate)
 *   Stage 5 — Dead-end (HUMAN fallback)
 *
 * Mocks:
 *   - groqAdapter.generate → canned JSON (I8: max 1 LLM per turn)
 *   - orderService.detectDoneOrdering → false (prevents finalizeDraftOrder side-effects)
 *   - adapters.logger.info → captures 'Pipeline audit' entries
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../infrastructure/prisma.js';
import { conversationService } from '../business/conversation.service.js';
import { orderService } from '../business/order.service.js';
import { conversationContextService } from '../business/conversation-context.service.js';
import { groqAdapter } from '../adapters/ai/groq.adapter.js';
import { adapters } from '../adapters/container.js';
import { normalize } from '../services/chat/normalizer.js';
import { ResponseSource } from '../domain/types.js';
import { setStoreEngine } from '../services/chat/engine-config.js';
// ──────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────
const STORE_ID = 'store-golden-test';
// Base products — always present in the DB.
// Note: "berasss" is added only for Case 6 and removed afterwards
// to avoid substring-match ambiguity with "beras" in tryProduct.
const BASE_PRODUCTS = [
    { id: 'prod-beras', name: 'beras', price: 12000, stock: 50 },
    { id: 'prod-woltel', name: 'woltel', price: 10000, stock: 50 },
    { id: 'prod-brambang', name: 'brambang', price: 8000, stock: 50 },
];
const BERASSS_PRODUCT = { id: 'prod-berasss', name: 'berasss', price: 15000, stock: 50 };
// ──────────────────────────────────────────────────────────
// Mock state
// ──────────────────────────────────────────────────────────
let llmCalls = 0;
let cannedContent = '';
let auditLogs = [];
// Save originals so we can restore in after()
const originalGenerate = groqAdapter.generate.bind(groqAdapter);
const originalLoggerInfo = adapters.logger.info;
const OrderProto = Object.getPrototypeOf(orderService);
const originalDetectDone = OrderProto.detectDoneOrdering;
// ──────────────────────────────────────────────────────────
// Mock implementations
// ──────────────────────────────────────────────────────────
const mockGenerate = async (_prompt, _options) => {
    llmCalls++;
    return {
        content: cannedContent,
        provider: 'groq',
        model: 'test-model',
        tokens: { input: 10, output: 10 },
        cost: 0,
    };
};
function getAudit(logs) {
    const log = logs[0] || {};
    return {
        stagesReached: log.stagesReached ?? [],
        llmCallCount: log.llmCallCount ?? 0,
        finalIntent: log.finalIntent ?? null,
        cartOpsExecuted: log.cartOpsExecuted ?? 0,
    };
}
// ──────────────────────────────────────────────────────────
// Canned LLM response builder
// ──────────────────────────────────────────────────────────
function canned(obj) {
    return JSON.stringify({
        intent: 'clarify',
        cart_ops: [],
        buy_signal: 'no',
        order_extract: null,
        missing_info: null,
        identity: null,
        reply_draft: null,
        confidence: 0.9,
        clarification: null,
        ...obj,
    });
}
// ──────────────────────────────────────────────────────────
// DB helpers
// ──────────────────────────────────────────────────────────
async function setupStore() {
    await prisma.store.upsert({
        where: { id: STORE_ID },
        update: { name: 'Golden Dataset Test Store' },
        create: { id: STORE_ID, name: 'Golden Dataset Test Store' },
    });
    for (const p of BASE_PRODUCTS) {
        await prisma.product.upsert({
            where: { id: p.id },
            update: {
                name: p.name,
                price: p.price,
                stock: p.stock,
                isActive: true,
                deletedAt: null,
            },
            create: {
                id: p.id,
                storeId: STORE_ID,
                name: p.name,
                price: p.price,
                stock: p.stock,
                isActive: true,
                currency: 'IDR',
            },
        });
    }
}
async function cleanupStoreData() {
    // Order matters: child tables first (FK constraints)
    await prisma.conversationHistory
        .deleteMany({ where: { conversation: { storeId: STORE_ID } } })
        .catch(() => { });
    await prisma.conversationContext
        .deleteMany({ where: { conversation: { storeId: STORE_ID } } })
        .catch(() => { });
    await prisma.order.deleteMany({ where: { storeId: STORE_ID } }).catch(() => { });
    await prisma.conversation
        .deleteMany({ where: { storeId: STORE_ID } })
        .catch(() => { });
    await prisma.product
        .deleteMany({ where: { storeId: STORE_ID } })
        .catch(() => { });
    await prisma.store.deleteMany({ where: { id: STORE_ID } }).catch(() => { });
}
async function createConv(convId, customerId) {
    await prisma.conversation.create({
        data: {
            id: convId,
            storeId: STORE_ID,
            customerId,
            customerPhone: customerId,
            channel: 'whatsapp',
            status: 'open',
        },
    });
    await conversationContextService.initializeContext({
        storeId: STORE_ID,
        customerId,
        conversationId: convId,
    });
}
/**
 * Set pendingClarification (and optionally previousMutation.cartSnapshot)
 * directly in extractedEntities, simulating what the interpreter /
 * orchestrator would have stored.
 */
async function setPendingInDb(convId, question, options, snapshot) {
    const entities = {
        discussedItems: [],
        confirmedItems: [],
        lastAmbiguousPrompt: null,
        pendingClarification: {
            question,
            options,
            expected_type: 'affirmative',
            asked_at: new Date().toISOString(),
            retry_count: 0,
        },
        previousMutation: snapshot
            ? { cartSnapshot: snapshot, message: 'test-pending' }
            : null,
    };
    await prisma.conversationContext.update({
        where: { conversationId: convId },
        data: { extractedEntities: entities },
    });
}
async function processMsg(convId, customerId, message) {
    // Reset per-call state
    llmCalls = 0;
    auditLogs = [];
    const result = await conversationService.processCustomerMessage(STORE_ID, customerId, convId, message);
    const audit = getAudit(auditLogs);
    return { result, audit, llmCalls };
}
// ──────────────────────────────────────────────────────────
// Lifecycle hooks
// ──────────────────────────────────────────────────────────
before(async () => {
    // Mock groqAdapter.generate — intercepts interpreter LLM calls
    groqAdapter.generate = mockGenerate;
    // Mock orderService to prevent finalizeDraftOrder side-effects (detectDoneOrdering)
    OrderProto.detectDoneOrdering = () => false;
    // Capture audit logs instead of forwarding to winston
    adapters.logger.info = (msg, meta) => {
        if (msg === 'Pipeline audit' && meta && typeof meta === 'object') {
            auditLogs.push(meta);
        }
    };
    // Seed DB
    await cleanupStoreData();
    await setupStore();
});
after(async () => {
    // Restore originals
    groqAdapter.generate = originalGenerate;
    OrderProto.detectDoneOrdering = originalDetectDone;
    adapters.logger.info = originalLoggerInfo;
    // Tear down
    await cleanupStoreData();
    await prisma.$disconnect();
});
beforeEach(async () => {
    // Reset mock state
    llmCalls = 0;
    cannedContent = '';
    auditLogs = [];
    // Clean conversation-level data (keep store + base products)
    await prisma.conversationHistory
        .deleteMany({ where: { conversation: { storeId: STORE_ID } } })
        .catch(() => { });
    await prisma.conversationContext
        .deleteMany({ where: { conversation: { storeId: STORE_ID } } })
        .catch(() => { });
    await prisma.order.deleteMany({ where: { storeId: STORE_ID } }).catch(() => { });
    await prisma.conversation
        .deleteMany({ where: { storeId: STORE_ID } })
        .catch(() => { });
});
// ──────────────────────────────────────────────────────────
// Test Cases
// ──────────────────────────────────────────────────────────
test('Case 1: resolver EXECUTE — "dua duanya" resolves pending clarification (0 LLM)', async () => {
    const convId = 'conv-case1';
    await createConv(convId, 'cust-1');
    // Simulate what the interpreter would have produced in Turn 1
    await setPendingInDb(convId, 'Berat 1 kg untuk woltel dan brambang ya?', [
        {
            id: 'opt-1',
            label: 'woltel 1kg & brambang 1kg',
            cartOps: [
                { type: 'add', product: 'woltel', qty: 1, price: 10000 },
                { type: 'add', product: 'brambang', qty: 1, price: 8000 },
            ],
        },
    ]);
    const { result, audit, llmCalls: calls } = await processMsg(convId, 'cust-1', 'dua duanya');
    assert.ok(result, 'processCustomerMessage must return a response');
    assert.equal(calls, 0, 'resolver stage must not call LLM (I8)');
    assert.deepEqual(audit.stagesReached, ['resolver']);
    assert.equal(audit.llmCallCount, 0);
    assert.equal(audit.finalIntent, 'execute_pending');
    assert.equal(audit.cartOpsExecuted, 2);
    assert.ok(result.message.content.includes('woltel'), 'response should mention woltel');
    assert.ok(result.message.content.includes('brambang'), 'response should mention brambang');
});
test('Case 2: normalizer → "total berapa" → tryTotal tier (0 LLM)', async () => {
    const convId = 'conv-case2';
    await createConv(convId, 'cust-2');
    // Verify normalization first (I12 / typo dictionary)
    assert.equal(normalize('toralin brp', ['beras']), 'total berapa', 'toralin → total, brp → berapa');
    const { result, audit, llmCalls: calls } = await processMsg(convId, 'cust-2', 'toralin brp');
    assert.ok(result, 'must return a response');
    assert.equal(calls, 0, 'tryTotal is a 0-LLM fast-path tier');
    assert.deepEqual(audit.stagesReached, ['normalizer', 'tier3']);
    assert.equal(audit.llmCallCount, 0);
    assert.equal(audit.finalIntent, 'fastpath');
    assert.equal(audit.cartOpsExecuted, 0);
});
test('Case 3: resolver EXECUTE — "semua" resolves pending (0 LLM)', async () => {
    const convId = 'conv-case3';
    await createConv(convId, 'cust-3');
    await setPendingInDb(convId, 'Mau semua produk?', [
        {
            id: 'opt-1',
            label: 'semua',
            cartOps: [{ type: 'add', product: 'beras', qty: 1, price: 12000 }],
        },
    ]);
    const { result, audit, llmCalls: calls } = await processMsg(convId, 'cust-3', 'semua');
    assert.ok(result, 'must return a response');
    assert.equal(calls, 0);
    assert.deepEqual(audit.stagesReached, ['resolver']);
    assert.equal(audit.llmCallCount, 0);
    assert.equal(audit.finalIntent, 'execute_pending');
    assert.equal(audit.cartOpsExecuted, 1);
    assert.ok(result.message.content.includes('beras'), 'cart should contain beras');
});
test('Case 4: resolver ROLLBACK — "ga jadi" cancels pending (0 LLM)', async () => {
    const convId = 'conv-case4';
    await createConv(convId, 'cust-4');
    // Need a cartSnapshot so ROLLBACK can restore
    const snapshot = [
        {
            product: 'beras',
            qty: 1,
            price: 12000,
            confirmedAt: new Date().toISOString(),
            mentionedAt: new Date().toISOString(),
        },
    ];
    await setPendingInDb(convId, 'Mau pesan beras 1kg?', [
        {
            id: 'opt-1',
            label: 'beras',
            cartOps: [{ type: 'add', product: 'beras', qty: 1, price: 12000 }],
        },
    ], snapshot);
    const { result, audit, llmCalls: calls } = await processMsg(convId, 'cust-4', 'ga jadi');
    assert.ok(result, 'must return a response');
    assert.equal(calls, 0);
    assert.deepEqual(audit.stagesReached, ['resolver']);
    assert.equal(audit.llmCallCount, 0);
    assert.equal(audit.finalIntent, 'rollback');
    assert.equal(audit.cartOpsExecuted, 0);
    assert.ok(result.message.content.includes('batal'), 'ROLLBACK response must say "dibatalkan"');
});
test('Case 5: tryProduct tier — "ada beras" returns price from DB (0 LLM)', async () => {
    const convId = 'conv-case5';
    await createConv(convId, 'cust-5');
    const { result, audit, llmCalls: calls } = await processMsg(convId, 'cust-5', 'ada beras');
    assert.ok(result, 'must return a response');
    assert.equal(calls, 0, 'tryProduct is a 0-LLM tier');
    assert.deepEqual(audit.stagesReached, ['normalizer', 'tier3']);
    assert.equal(audit.llmCallCount, 0);
    assert.equal(audit.finalIntent, 'fastpath');
    assert.ok(result.message.content.includes('beras'), 'should mention the product');
    // Price must come from DB (Rp 12.000), not from LLM
    assert.match(result.message.content, /Rp\s*12[.,]000/);
});
test('Case 6: normalizer preserves "berasss" (I12 guard), tryProduct returns DB price (0 LLM)', async () => {
    // Add "berasss" product temporarily — excluded from Case 5 to avoid
    // substring-match ambiguity (searchProducts: name contains "beras"
    // matches both "beras" and "berasss").
    await prisma.product.create({
        data: {
            id: BERASSS_PRODUCT.id,
            storeId: STORE_ID,
            name: BERASSS_PRODUCT.name,
            price: BERASSS_PRODUCT.price,
            stock: BERASSS_PRODUCT.stock,
            isActive: true,
            currency: 'IDR',
        },
    });
    try {
        // Direct normalization check — I12: product tokens are never mutated
        const normInput = normalize('berasss ada', ['beras', 'berasss']);
        assert.ok(normInput.includes('berasss'), 'I12 guard: "berasss" must NOT be mutated to "beras"');
        const convId = 'conv-case6';
        await createConv(convId, 'cust-6');
        const { result, audit, llmCalls: calls } = await processMsg(convId, 'cust-6', 'berasss ada');
        assert.ok(result, 'must return a response');
        assert.equal(calls, 0);
        assert.deepEqual(audit.stagesReached, ['normalizer', 'tier3']);
        assert.equal(audit.llmCallCount, 0);
        assert.equal(audit.finalIntent, 'fastpath');
        assert.ok(result.message.content.includes('berasss'), 'response should use the original product name "berasss"');
        assert.match(result.message.content, /Rp\s*15[.,]000/);
    }
    finally {
        await prisma.product
            .delete({ where: { id: BERASSS_PRODUCT.id } })
            .catch(() => { });
    }
});
test('Case 7: resolver EXECUTE — "iya" resolves pending (0 LLM)', async () => {
    const convId = 'conv-case7';
    await createConv(convId, 'cust-7');
    await setPendingInDb(convId, 'Mau pesan beras?', [
        {
            id: 'opt-1',
            label: 'iya',
            cartOps: [{ type: 'add', product: 'beras', qty: 1, price: 12000 }],
        },
    ]);
    const { result, audit, llmCalls: calls } = await processMsg(convId, 'cust-7', 'iya');
    assert.ok(result, 'must return a response');
    assert.equal(calls, 0);
    assert.deepEqual(audit.stagesReached, ['resolver']);
    assert.equal(audit.llmCallCount, 0);
    assert.equal(audit.finalIntent, 'execute_pending');
    assert.equal(audit.cartOpsExecuted, 1);
});
test('Case 8: interpreter — LLM called once, reply_draft ≤ 2 sentences', async () => {
    const convId = 'conv-case8';
    await createConv(convId, 'cust-8');
    cannedContent = canned({
        intent: 'smalltalk',
        cart_ops: [],
        reply_draft: 'Kami punya beras dan sayuran segar. Silakan pilih ya.',
        confidence: 0.9,
    });
    const { result, audit, llmCalls: calls } = await processMsg(convId, 'cust-8', 'rekomendasi apa ya?');
    assert.ok(result, 'must return a response');
    assert.equal(calls, 1, 'interpreter must call LLM exactly once (I8)');
    assert.equal(audit.llmCallCount, 1);
    assert.deepEqual(audit.stagesReached, [
        'normalizer',
        'tier3',
        'llm',
    ]);
    assert.equal(audit.finalIntent, 'smalltalk');
    assert.equal(audit.cartOpsExecuted, 0);
    // Validate reply_draft is truncated to max 2 sentences
    assert.ok(result.message.content, 'response must have content');
    const sentences = result.message.content
        .split(/(?<=[.!?])\s+/)
        .filter((s) => s.trim().length > 0);
    assert.ok(sentences.length <= 2, `reply_draft harus maks 2 kalimat, dapat ${sentences.length}`);
});
test('Case 9: interpreter → clarification → pending saved in DB', async () => {
    const convId = 'conv-case9';
    await createConv(convId, 'cust-9');
    cannedContent = canned({
        intent: 'clarify',
        clarification: {
            question: 'Maaf Kak, iPhone 15 belum tersedia di toko kami. Ada alternatif lain?',
            options: [],
            expected_type: 'affirmative',
        },
        confidence: 0.85,
    });
    const { result, audit, llmCalls: calls } = await processMsg(convId, 'cust-9', 'iphone 15');
    assert.ok(result, 'must return a response');
    assert.equal(calls, 1);
    assert.equal(audit.llmCallCount, 1);
    assert.deepEqual(audit.stagesReached, [
        'normalizer',
        'tier3',
        'llm',
    ]);
    assert.equal(audit.finalIntent, 'clarify');
    // Verify pending clarification was persisted to DB
    const ctxRow = await prisma.conversationContext.findUnique({
        where: { conversationId: convId },
        select: { extractedEntities: true },
    });
    const entities = conversationContextService.parseExtractedEntities(ctxRow?.extractedEntities);
    assert.ok(entities.pendingClarification, 'pending clarification must be saved');
    assert.equal(entities.pendingClarification?.question, 'Maaf Kak, iPhone 15 belum tersedia di toko kami. Ada alternatif lain?');
});
test('Case 10: interpreter — harga dari DB via cart_ops, not customer "50rb" (I13)', async () => {
    const convId = 'conv-case10';
    await createConv(convId, 'cust-10');
    // LLM returns the correct DB price (12000) for beras — not the
    // customer's "50rb" (50000).  validateCartOps verifies product
    // existence against storeProducts (I15).
    cannedContent = canned({
        intent: 'buy',
        cart_ops: [{ type: 'add', product: 'beras', qty: 1, price: 12000 }],
        buy_signal: 'yes',
        confidence: 0.95,
    });
    const { result, audit, llmCalls: calls } = await processMsg(convId, 'cust-10', 'harganya 50rb ya?');
    assert.ok(result, 'must return a response');
    assert.equal(calls, 1);
    assert.equal(audit.llmCallCount, 1);
    assert.deepEqual(audit.stagesReached, [
        'normalizer',
        'tier3',
        'llm',
    ]);
    assert.equal(audit.finalIntent, 'buy');
    assert.equal(audit.cartOpsExecuted, 1);
    // Price from DB (Rp 12.000), NOT the customer's "50rb" (50.000)
    assert.ok(result.message.content.includes('beras'), 'should mention beras');
    assert.match(result.message.content, /Rp\s*12[.,]000/);
    assert.ok(!result.message.content.includes('50.000'), 'customer-stated price "50rb" must NOT appear in response (I13)');
    assert.ok(!result.message.content.includes('50rb'), 'customer-stated price "50rb" must NOT appear in response (I13)');
});
// ─────────────────────────────────────────────────────────────────────────────
// TASK B3 — tryTotal / tryPayment "bayar" overlap
// Skenario: "berapa bayar kangkung" seharusnya KE tryProduct (harga Kangkung),
// bukan terkurung oleh tryTotal ("keranjang kosong") atau tryPayment (daftar
// metode bayar). Harness ini pakai store-golden-test (produk: beras) + menambah
// sementara kangkung agar tryProduct bisa match. groq mock tetap (cannedContent)
// hanya dipakai kalau sampai interpreter.
// ─────────────────────────────────────────────────────────────────────────────
// Helper kecil: upsert + hapus satu product untuk satu test (FK-safe).
async function withProduct(id, name, price, stock, fn) {
    await prisma.product.upsert({
        where: { id },
        update: { storeId: STORE_ID, name, price, stock, isActive: true, deletedAt: null, currency: 'IDR' },
        create: { id, storeId: STORE_ID, name, price, stock, isActive: true, currency: 'IDR' },
    });
    try {
        await fn();
    }
    finally {
        await prisma.product.delete({ where: { id } }).catch(() => { });
    }
}
/**
 * Aktifkan engine V2 untuk STORE_ID via Redis (getStoreEngine → 'v2'),
 * jalankan fn, lalu kembalikan ke 'v1' di finally.
 * Diperlukan untuk golden case P3 (workspace_v2 persist antar-turn).
 */
async function withEngineV2(fn) {
    await setStoreEngine(STORE_ID, 'v2');
    try {
        await fn();
    }
    finally {
        await setStoreEngine(STORE_ID, 'v1');
    }
}
/**
 * Builder canned response untuk interpreter V2 (InterpreterResultV2 JSON).
 * Berbeda dengan `canned()` (V1 InterpreterResult) — V2 pakai acts[], confidence{v4}, draft_cart_ops.
 */
function cannedV2(obj) {
    return JSON.stringify({
        acts: [],
        unmatched_mentions: [],
        topic_switch: false,
        draft_cart_ops: [],
        reply_draft: null,
        confidence: { entities: 0.95, intent: 0.95, selection: 0.95, topic: 0.95 },
        ...obj,
    });
}
test('Case B3-a: "total berapa" (regresi) tetap di-jawab tryTotal (0 LLM)', async () => {
    const convId = 'conv-b3a';
    await createConv(convId, 'cust-b3a');
    try {
        const { result, audit, llmCalls: calls } = await processMsg(convId, 'cust-b3a', 'toralin brp');
        assert.ok(result, 'must return a response');
        assert.equal(calls, 0, '0 LLM — tryTotal fast path');
        assert.equal(audit.stagesReached[0], 'normalizer');
        assert.equal(audit.stagesReached[1], 'tier3');
        assert.equal(audit.finalIntent, 'fastpath');
        assert.equal(result.source, ResponseSource.TOTAL, 'harus dari tryTotal (TOTAL)');
    }
    finally {
        await prisma.conversation.delete({ where: { id: convId } }).catch(() => { });
    }
});
test('Case B3-b: "berapa bayar kangkung" -> tryProduct (harga), BUKAN tryTotal/tryPayment', async () => {
    const convId = 'conv-b3b';
    await createConv(convId, 'cust-b3b');
    await withProduct('prod-kangkung-b3', 'kangkung', 8000, 100, async () => {
        const { result, audit, llmCalls: calls } = await processMsg(convId, 'cust-b3b', 'berapa bayar kangkung');
        assert.ok(result, 'must return a response');
        // Harus dari tryProduct (PRODUCT), BUKAN tryTotal (TOTAL) atau tryPayment (PAYMENT)
        assert.equal(result.source, ResponseSource.PRODUCT, `expected tryProduct, got ${result.source}`);
        assert.match(result.message.content, /kangkung/i, 'harus sebut kangkung');
        assert.match(result.message.content, /8\.?000|8000/, 'harus sebut harga 8000');
        assert.equal(calls, 0, '0 LLM — tryProduct fast path (bukan interpreter)');
        assert.deepEqual(audit.stagesReached, ['normalizer', 'tier3']);
        assert.equal(audit.finalIntent, 'fastpath');
        // Bukti: TIDAK pernah menyentuh tryTotal/tryPayment (content bukan keranjang-bayar)
        assert.ok(!result.message.content.includes('keranjang belanja Kakak masih kosong'), 'must not be tryTotal empty-cart reply');
        assert.ok(!result.message.content.includes('metode pembayaran'), 'must not be tryPayment reply');
    });
    await prisma.conversation.delete({ where: { id: convId } }).catch(() => { });
});
test('Case B3-c: "bisa cod ga?" -> tryPayment masih jawab (regression)', async () => {
    const convId = 'conv-b3c';
    await createConv(convId, 'cust-b3c');
    // canary-style: butuh acceptsCod supaya tryPayment menjawab
    await prisma.store.update({ where: { id: STORE_ID }, data: { acceptsCod: true } });
    try {
        const { result, audit, llmCalls: calls } = await processMsg(convId, 'cust-b3c', 'bisa cod ga?');
        assert.ok(result);
        assert.equal(result.source, ResponseSource.PAYMENT, `expected tryPayment, got ${result.source}`);
        assert.match(result.message.content, /cod|COD|metode pembayaran/i);
        assert.equal(calls, 0, '0 LLM');
        assert.equal(audit.finalIntent, 'fastpath');
    }
    finally {
        await prisma.store.update({ where: { id: STORE_ID }, data: { acceptsCod: false } }).catch(() => { });
        await prisma.conversation.delete({ where: { id: convId } }).catch(() => { });
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// TASK P2 — I13 truth boundary (permanent regression): harga cart wajib dari DB,
// bukan dari pending-option yang mensimulasikan output LLM (price salah).
// Seed pending clarification dengan cartOp WRONG price (99999) untuk 'beras'
// (DB=12000), resolve "dua duanya" → resolver-EXECUTE memakai
// validateCartOpsAgainstDb → modifyCart dengan harga DB. Readback mentah
// confirmed_items membuktikan price=12000 (bukan 99999).
// ─────────────────────────────────────────────────────────────────────────────
test('Case P2-I13: wrong price in pending (sim LLM) -> DB price in cart (raw readback)', async () => {
    const convId = 'conv-p2-throwaway';
    await createConv(convId, 'cust-p2');
    await setPendingInDb(convId, 'beli beras?', [
        { id: 'opt-yes', label: 'iya', cartOps: [{ type: 'add', product: 'beras', qty: 1, price: 99999 }] },
    ]);
    const { result, audit, llmCalls: calls } = await processMsg(convId, 'cust-p2', 'dua duanya');
    // RAW DB readback (query DB mentah)
    const ctxRow = await prisma.conversationContext.findUnique({
        where: { conversationId: convId },
        select: { extractedEntities: true },
    });
    const confirmedItems = (ctxRow?.extractedEntities?.confirmedItems) || [];
    console.log('P2_RAW_CONFIRMED_ITEMS:', JSON.stringify(confirmedItems));
    console.log('P2_RAW_LLM_CALLS:', calls, 'finalIntent:', audit.finalIntent, 'cartOpsExecuted:', audit.cartOpsExecuted);
    const berasItem = confirmedItems.find((i) => String(i.product || i.name || '').toLowerCase().includes('beras'));
    assert.ok(result, 'must respond');
    assert.equal(calls, 0, '0 LLM (resolver path)');
    assert.ok(berasItem, 'beras must be in cart');
    assert.equal(berasItem.price, 12000, `expected DB price 12000, got ${berasItem.price}`);
    assert.notEqual(berasItem.price, 99999, 'LLM wrong price 99999 must NOT survive');
    assert.ok(result.message.content.includes('beras'));
    await prisma.conversation.delete({ where: { id: convId } }).catch(() => { });
});
// ─────────────────────────────────────────────────────────────────────────────
// TASK P6.4a — Golden case: workspace_v2 persist antar-turn (P3 architecture gate)
//
// Skenario: engine V2 aktif, turn 1 menambahkan 'beras' ke keranjang via
// LLM interpreter (act buy), turn 2 menanyakan 'total berapa'. Jika kolom
// workspace_v2 tidak persisten (NO-OP bug P3-audit §2, conversation.service.ts:233),
// turn 2 V2 akan gagal membaca state turn 1 (workspace_v2 kosong → migrasi ulang
// legacy empty). Dua bukti persist:
//  (a) turn 2 'total berapa' berhasil jawab Rp 12.000 (cart persist via executeCartOps→modifyCart)
//  (b) kolom DB `workspace_v2` tidak null setelah turn 1 (direct DB check)
// ─────────────────────────────────────────────────────────────────────────────
test('Case P3: engine v2 — workspace_v2 persist antar-turn (P3 gate)', async () => {
    const convId = 'conv-p3';
    await createConv(convId, 'cust-p3');
    await withEngineV2(async () => {
        try {
            // --- Turn 1: beli beras 1kg via V2 interpreter ---
            cannedContent = cannedV2({
                acts: [
                    {
                        act_id: 'a1',
                        intent: 'buy',
                        entities: [{ type: 'product', value: 'beras', confidence: 0.95 }],
                        qty: 1,
                        qty_source: 'explicit',
                        confidence: 0.95,
                        supersedes: null,
                    },
                ],
                reply_draft: 'Ditambahkan beras ke keranjang ya.',
            });
            const t1 = await processMsg(convId, 'cust-p3', 'saya mau beli beras 1');
            assert.ok(t1.result, 'turn 1 must return a response');
            // V2 path tidak pakai 'Pipeline audit' logger — pakai llmcalls counter + direct DB check
            assert.equal(t1.llmCalls, 1, 'turn 1 V2: 1 LLM call (intent buy)');
            // Direct DB check: kolom workspace_v2 HARUS terisi (bukan null/NO-OP)
            const ctxAfterT1 = await prisma.conversationContext.findUnique({
                where: { conversationId: convId },
                select: { workspace_v2: true },
            });
            const wsRaw = ctxAfterT1?.workspace_v2;
            assert.ok(wsRaw !== null && wsRaw !== undefined, 'workspace_v2 column must be populated (P3.1 persist, bukan NO-OP)');
            // --- Turn 2: tanya total — bila workspace/cart persist OK, cukup 0 LLM ---
            cannedContent = cannedV2({
                acts: [],
                reply_draft: 'Total belanja Anda adalah Rp 12.000.',
            });
            const t2 = await processMsg(convId, 'cust-p3', 'total berapa');
            assert.ok(t2.result, 'turn 2 must return a response');
            // Jika cart (confirmedItems di extractedEntities) persisten dari turn 1,
            // tryTotal akan menghitung Rp 12.000 (beras 1x12000).
            // Jika persist gagal, tryTotal akan balas 'keranjang kosong' → RED.
            assert.ok(t2.result.message.content.match(/12\.?000|12000/), `turn 2 must show Rp 12.000 from persisted cart, got: ${t2.result.message.content}`);
            // Persist verifikasi: workspace_v2 kolom masih ada di turn 2
            const ctxAfterT2 = await prisma.conversationContext.findUnique({
                where: { conversationId: convId },
                select: { workspace_v2: true },
            });
            assert.ok(ctxAfterT2?.workspace_v2 !== null && ctxAfterT2?.workspace_v2 !== undefined, 'workspace_v2 must still be populated on turn 2');
        }
        finally {
            await prisma.conversation.delete({ where: { id: convId } }).catch(() => { });
        }
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// TASK P6.4b — Golden case: activeOrder draft vs pending discrimination (P4 gate)
//
// Reproduce manual test dari P4.2 (commit 947fdaf). Seed 2 baris order untuk
// 1 conversationId:
//   - order 'draft'   @harga A (12.000)  — harus dipilih oleh activeOrder/tryTotal
//   - order 'pending' @harga B (24.000)  — HANYA dipilih bila tidak ada draft
// Tanya "total berapa" → assert balasan match draft (A), BUKAN pending (B).
// Kalau fix P4.2 di-revert (query lama notIn shipped/delivered/cancelled
// tanpa prefer-draft-first), pending yang lebih baru bisa terpilih → RED.
// ─────────────────────────────────────────────────────────────────────────────
test('Case P4: activeOrder/tryTotal memilih draft (Rp 12.000) bukan pending (Rp 24.000) (P4 gate)', async () => {
    const convId = 'conv-p4';
    await createConv(convId, 'cust-p4');
    try {
        // Seed order 'draft' (harga A = 12.000, beras 1x) — HARUS dipilih
        await prisma.order.create({
            data: {
                id: 'ord-draft-p4',
                storeId: STORE_ID,
                conversationId: convId,
                customerId: 'cust-p4',
                items: [{ product: 'beras', qty: 1, price: 12000, mentionedAt: new Date().toISOString(), confirmedAt: new Date().toISOString() }],
                totalPrice: 12000,
                orderStatus: 'draft',
                currency: 'IDR',
                deletedAt: null,
            },
        });
        // Seed order 'pending' (harga B = 24.000, beras 2x) — HARUS tdk dipilih
        await new Promise(r => setTimeout(r, 10)); // pastikan createdAt lebih baru
        await prisma.order.create({
            data: {
                id: 'ord-pending-p4',
                storeId: STORE_ID,
                conversationId: convId,
                customerId: 'cust-p4',
                items: [{ product: 'beras', qty: 2, price: 12000, mentionedAt: new Date().toISOString(), confirmedAt: new Date().toISOString() }],
                totalPrice: 24000,
                orderStatus: 'pending',
                currency: 'IDR',
                deletedAt: null,
            },
        });
        const { result, llmCalls: calls } = await processMsg(convId, 'cust-p4', 'total berapa');
        assert.ok(result, 'must return a response');
        assert.equal(calls, 0, 'tryTotal is a 0-LLM fast-path (bukan interpreter)');
        // Assert: balasan HARUS berisi harga draft (12.000), BUKAN pending (24.000)
        assert.ok(/12\.?000|12000/.test(result.message.content), `reply must contain draft price 12000, got: ${result.message.content}`);
        assert.ok(!/24\.?000|24000/.test(result.message.content), `reply must NOT contain pending price 24000 (draft-first discrimination), got: ${result.message.content}`);
    }
    finally {
        await prisma.conversation.delete({ where: { id: convId } }).catch(() => { });
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// TASK P6.4c — Golden case: reply composition invariants (P5 gate)
//
// (a) Subtotal HANYA menghitung item qty > 0 — qty=0 (mis. "Brambang (0x)")
//     tidak boleh menyumbang ke subtotal. Verifikasi via tryTotal draft order
//     yang seed items [beras qty=1 price=12000, brambang qty=0 price=8000]
//     → subtotal harus 12.000 (bukan 20.000). P5.1 fix I-1a
//     (conversation.service.ts:254, fallback.service.ts:694).
//
// (b) Interpreter reply_draft dengan 3+ kalimat → hasil akhir ≤ 2 kalimat.
//     Memastikan truncateTo2Sentences applied (interpreter.ts:233 /
//     conversation.service.ts:350 safety-net). Regresi P5.1 I-2.
//
// CATATAN (bukan bug, hanya keterbatasan golden dataset):
// (c) item qty<=0 display "x1" (composer-v2.ts:79-81) — hanya dapat di-test
//     di V2 composer unit test, BUKAN di golden dataset integration karena
//     V2 engine flow belum menghubungkan draft_cart_ops qty=0 ke display
//     di level golden dataset. Lihat composer-v2.test.ts:P5.1 #4 untuk unit test.
// ─────────────────────────────────────────────────────────────────────────────
test('Case P5: reply composition subtotal qty-filter + truncate (P5 gate)', async () => {
    const convId = 'conv-p5';
    await createConv(convId, 'cust-p5');
    try {
        // (a) Subtotal hanya item qty > 0
        await prisma.order.create({
            data: {
                id: 'ord-p5',
                storeId: STORE_ID,
                conversationId: convId,
                customerId: 'cust-p5',
                items: [
                    { product: 'beras', qty: 1, price: 12000, mentionedAt: new Date().toISOString(), confirmedAt: new Date().toISOString() },
                    { product: 'brambang', qty: 0, price: 8000, mentionedAt: new Date().toISOString(), confirmedAt: new Date().toISOString() },
                ],
                totalPrice: 12000,
                orderStatus: 'draft',
                currency: 'IDR',
                deletedAt: null,
            },
        });
        const { result: r1 } = await processMsg(convId, 'cust-p5', 'total berapa');
        assert.ok(r1, 'must return a response for subtotal');
        // beras 1x12000 = 12.000; brambang qty=0 harus DIFILTER (bukan 20.000)
        assert.ok(/12\.?000|12000/.test(r1.message.content), `subtotal harus 12.000 (qty=0 terfilter), got: ${r1.message.content}`);
        assert.ok(!/20\.?000|20000/.test(r1.message.content), `subtotal tidak boleh 20.000 (qty=0 tidak boleh dihitung), got: ${r1.message.content}`);
        // (b) Interpreter reply_draft 3+ kalimat → truncate ≤ 2 kalimat
        const convId2 = 'conv-p5b';
        await createConv(convId2, 'cust-p5b');
        try {
            cannedContent = canned({
                intent: 'smalltalk',
                cart_ops: [],
                reply_draft: 'Kami punya beras murni. Silakan pesan ya. Terima kasih!',
                confidence: 0.9,
            });
            const { result: r2 } = await processMsg(convId2, 'cust-p5b', 'rekomendasi apa ya?');
            assert.ok(r2, 'must return a response for truncate');
            assert.ok(r2.message.content, 'reply must have content');
            const sentences = r2.message.content
                .split(/(?<=[.!?])\s+/)
                .filter((s) => s.trim().length > 0);
            assert.ok(sentences.length <= 2, `reply_draft harus maks 2 kalimat (truncate), dapat ${sentences.length}: ${r2.message.content}`);
        }
        finally {
            await prisma.conversation.delete({ where: { id: convId2 } }).catch(() => { });
        }
    }
    finally {
        await prisma.conversation.delete({ where: { id: convId } }).catch(() => { });
    }
});
//# sourceMappingURL=golden-dataset.test.js.map