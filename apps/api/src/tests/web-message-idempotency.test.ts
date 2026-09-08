/**
 * UNIT F-GAP1-C — Retry-simulation (HTTP-level) for PWA /message idempotency.
 *
 * Goal: prove Gap #1 is closed END-TO-END. Two real HTTP POSTs to
 * /pwa/:slug/message carrying the SAME `clientMsgId` (simulating a client that
 * never saw the first response — timeout / lost response — and resent the
 * identical logical message) must result in exactly ONE cart mutation; two POSTs
 * with DIFFERENT `clientMsgId` but identical text must result in TWO mutations
 * (no over-dedupe of legitimate repeated messages).
 *
 * Why this is NOT the harness-fixed-key test (web-cart-idempotency.test.ts):
 *   - That test pinned the key IN THE HARNESS and called executeWaCartMutation()
 *     directly. It proved claimAction dedupes a stable key, but it did NOT prove
 *     the /message HTTP body `clientMsgId` flows through the real route
 *     (pwa.ts -> conversationDeliveryService.processWebRequest ->
 *     processCustomerMessage -> executeWaCartMutation -> actionId
 *     `web:${conv}:${clientMsgId}`) and becomes the dedup key. That is exactly
 *     what UNIT F-GAP1-A wires and this test exercises over the wire.
 *
 * The LLM is stubbed (llmGateway.generate). interpreter.ts routes ALL inference
 * through llmGateway.generate (the sole provider-decision point), so stubbing it
 * makes free-text -> cart-op deterministic. The idempotency under test
 * (actionIdempotency claim keyed by `web:${conv}:${clientMsgId}`) is downstream
 * of, and independent from, the LLM output.
 *
 * Why the message text is arbitrary: FREE TEXT is matched by the v1 Stage-3
 * fallback tiers (product-name card, inquiry, FAQ...). To reach Stage 4 (the LLM
 * path where executeWaCartMutation(:677) runs for v1), the message must miss
 * every Stage-3 tier -> fallbackService returns a HUMAN dead-end (a "miss",
 * conversation.service.ts:653 `source !== HUMAN` guard) -> runOneCall runs.
 * BUY_MSG contains NO product-name token (so shouldAnswerSingleProduct misses),
 * NO PRODUCT_INQUIRY_WORDS (ada/boleh/jual/beli/stok/ready/kosong/tersedia/punya),
 * and no order/shipping/payment/total/status keywords -> guaranteed Stage 4 hit.
 * The stub then forces product 'ayam' (seeded) -> validateCartOpsAgainstDb
 * passes -> executeWaCartMutation(messageId=clientMsgId, channel='web').
 *
 * Test isolation: each scenario uses a UNIQUE webUid, so the /message handler
 * (pwa.ts:354 `findFirst` by customer+channel 'web') creates a fresh
 * customer+conversation per scenario -> no cross-scenario conv/claim collision.
 * Scenarios run SEQUENTIALLY in one test() (shared store; no concurrent
 * subtests to race the reset).
 *
 * Runner:
 *   npx tsx --env-file=../../.env --test --test-force-exit src/tests/web-message-idempotency.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { prisma } from '../infrastructure/prisma.js';
import pwaRouter from '../routes/pwa.js';
import { requestIdMiddleware } from '../middleware/requestId.js';
import { llmGateway } from '../adapters/ai/llm-gateway.js';
import type { AIResponse } from '../adapters/ai/types.js';

const STORE_ID = 'store-gap1-idem';
const PREFIX = STORE_ID;
const AYAM_PRODUCT = 'ayam';

// Whole-token product name 'ayam' is NOT a token here (so shouldAnswerSingleProduct
// misses); no inquiry/order/shipping/payment keywords -> all Stage-3 tiers miss ->
// HUMAN dead-end -> Stage 4 (runOneCall) runs and the stub below adds 'ayam'.
const BUY_MSG = 'saya sedang melakukan uji coba sistem';

const originalGenerate = llmGateway.generate;
let llmCalls = 0;

// Deterministic InterpreterResult JSON (matches INTERPRETER_SCHEMA in interpreter.ts:39).
const AI_CANNED = JSON.stringify({
  intent: 'buy',
  cart_ops: [{ type: 'add', product: 'ayam', qty: 1, price: 10000, variant: null }],
  buy_signal: 'yes',
  order_extract: null,
  missing_info: null,
  identity: null,
  reply_draft: 'Ayam sudah dimasukkan ke keranjang.',
  confidence: 0.9,
  clarification: null,
});

// FK-safe, leaf-first cleanup. Errors tolerated (non-fatal between runs).
async function cleanup(): Promise<void> {
  await prisma.actionIdempotency.deleteMany({ where: { storeId: { startsWith: PREFIX } } }).catch(() => {});
  await prisma.orderItem.deleteMany({ where: { order: { storeId: { startsWith: PREFIX } } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { storeId: { startsWith: PREFIX } } }).catch(() => {});
  await prisma.conversationHistory.deleteMany({ where: { conversation: { storeId: { startsWith: PREFIX } } } }).catch(() => {});
  await prisma.conversationContext.deleteMany({ where: { conversation: { storeId: { startsWith: PREFIX } } } }).catch(() => {});
  await prisma.conversation.deleteMany({ where: { storeId: { startsWith: PREFIX } } }).catch(() => {});
  await prisma.product.deleteMany({ where: { storeId: { startsWith: PREFIX } } }).catch(() => {});
  await prisma.customer.deleteMany({ where: { storeId: { startsWith: PREFIX } } }).catch(() => {});
  await prisma.store.deleteMany({ where: { id: { startsWith: PREFIX } } }).catch(() => {});
}

async function setupStore(): Promise<void> {
  await prisma.store.upsert({
    where: { id: STORE_ID },
    update: {},
    create: {
      id: STORE_ID,
      name: 'GAP1 Idempotency Store',
      slug: STORE_ID,
      email: 'gap1@garuda.test',
      phoneNumber: '+6281200000098',
      address: 'Jl. Gap1 No. 1',
      originProvinceId: 'prov-gap1-1',
      originProvinceName: 'Jawa Barat',
      originCityId: 'city-gap1-1',
      originCityName: 'Bandung',
      originSubdistrictId: 'sub-gap1-1',
      originSubdistrictName: 'Coblong',
    },
  });
  await prisma.product.upsert({
    where: { id: 'prod-gap1-ayam' },
    update: { name: 'ayam', price: 10000, stock: 100, isActive: true, deletedAt: null },
    create: { id: 'prod-gap1-ayam', storeId: STORE_ID, name: 'ayam', price: 10000, stock: 100, isActive: true, currency: 'IDR' },
  });
}

function freshUid(): string {
  return `${PREFIX}-${randomUUID().slice(0, 8)}`;
}

async function postMessage(webUid: string, clientMsgId: string | null, messageText: string) {
  const res = await fetch(`${baseUrl}/api/pwa/${STORE_ID}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: webUid, message: messageText, ...(clientMsgId ? { clientMsgId } : {}) }),
  });
  const body = await res.json().catch(() => ({} as any));
  return { status: res.status, body };
}

async function ayamQty(conversationId: string): Promise<number> {
  const order = await prisma.order.findFirst({
    where: { conversationId, orderStatus: 'draft', deletedAt: null },
  });
  if (!order) return 0;
  const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
  const ayam = items.find((i: any) => (i.productName || '').toLowerCase() === AYAM_PRODUCT);
  return ayam ? Number(ayam.quantity) : 0;
}

async function countClaim(actionId: string): Promise<number> {
  return prisma.actionIdempotency.count({
    where: { storeId: STORE_ID, actionType: 'WA_CART_MUTATION', actionId },
  });
}

async function countConvClaims(conversationId: string): Promise<number> {
  return prisma.actionIdempotency.count({
    where: {
      storeId: STORE_ID,
      actionType: 'WA_CART_MUTATION',
      actionId: { startsWith: `web:${conversationId}:` },
    },
  });
}

let server: any;
let baseUrl = '';

before(async () => {
  await cleanup();
  await setupStore();

  // Stub the LLM (interpreter.ts:15 llmGateway.generate — sole inference provider).
  llmGateway.generate = (async (_prompt: string, _opts?: any): Promise<AIResponse> => {
    llmCalls++;
    return { content: AI_CANNED, provider: 'groq', model: 'test-model', tokens: { input: 12, output: 8 }, cost: 0.0001 };
  }) as any;

  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware); // seeds req.requestId (backward-compat fallback)
  app.use('/api/pwa', pwaRouter);
  app.use((_req, res) => {
    res.status(404).json({ error: 'Route not found', code: 'ERR_NOT_FOUND' });
  });
  server = await new Promise<any>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  llmGateway.generate = originalGenerate;
  if (server) await new Promise((r) => server.close(r));
  await cleanup();
  await prisma.$disconnect();
});

test('GAP1-C — PWA /message idempotency via stable clientMsgId (real HTTP retry-sim)', async () => {
  // ── Scenario 1: SAME clientMsgId resent (simulated lost-response retry) ──
  // Same uid -> handler reuses the same customer+conversation (pwa.ts:354).
  const uid1 = freshUid();
  const cmk = `MSG-RETRY-SAME-${randomUUID().slice(0, 8)}`;

  const r1 = await postMessage(uid1, cmk, BUY_MSG);
  assert.equal(r1.status, 200, `scenario1 POST1 should succeed (got ${r1.status}: ${JSON.stringify(r1.body)})`);
  assert.ok(llmCalls >= 1, 'scenario1: interpreter LLM path was exercised (msg reached Stage 4 via stub)');
  const conv1 = r1.body.conversationId as string;
  assert.ok(conv1, 'scenario1: response must carry conversationId');
  assert.equal(await ayamQty(conv1), 1, `scenario1 POST1 must add ayam once; resp=${JSON.stringify(r1.body)}`);

  // The retry: identical logical message, SAME clientMsgId. Simulates a client
  // that never saw the first response (timeout/lost) and resent the identical id.
  const r2 = await postMessage(uid1, cmk, BUY_MSG);
  assert.equal(r2.status, 200, 'scenario1 retry POST must return 200 (idempotent, not 5xx)');

  // ── The idempotency proof: cart NOT doubled, single claim row ──
  assert.equal(await ayamQty(conv1), 1, 'scenario1 retry with same clientMsgId must NOT double-add (expected qty 1)');
  assert.equal(await countClaim(`web:${conv1}:${cmk}`), 1, 'scenario1: exactly ONE claim row for the stable clientMsgId (deduped, not a new mutation)');
  assert.equal(await countConvClaims(conv1), 1, 'scenario1: no orphaned second claim row for the same clientMsgId');

  // ── Scenario 2: DIFFERENT clientMsgId, identical text -> both apply ──
  const uid2 = freshUid();
  const r3 = await postMessage(uid2, 'MSG-DIFF-A', BUY_MSG); // same text, DIFFERENT id
  const conv2 = r3.body.conversationId as string;
  assert.equal(r3.status, 200, `scenario2 POST1 should succeed (got ${r3.status}: ${JSON.stringify(r3.body)})`);
  assert.equal(await ayamQty(conv2), 1, `scenario2 POST1 must add ayam once; resp=${JSON.stringify(r3.body)}`);

  const r4 = await postMessage(uid2, 'MSG-DIFF-B', BUY_MSG);
  assert.equal(r4.status, 200, 'scenario2 POST2 should return 200');
  assert.equal(await ayamQty(conv2), 2, 'scenario2: two distinct clientMsgIds + same text -> both apply (1 + 1 = 2; NOT over-deduped)');
  assert.equal(await countConvClaims(conv2), 2, 'scenario2: two distinct ids -> two claim rows (no over-dedupe)');

  // ── Scenario 3: ABSENT clientMsgId (legacy client) -> server uuid fallback ──
  const uid3 = freshUid();
  const r5 = await postMessage(uid3, null, BUY_MSG); // NO clientMsgId -> req.requestId fallback
  const conv3 = r5.body.conversationId as string;
  assert.equal(r5.status, 200, `scenario3 legacy (no clientMsgId) must not 4xx/5xx (got ${r5.status}: ${JSON.stringify(r5.body)})`);
  assert.equal(await ayamQty(conv3), 1, 'scenario3: fallback path still applies the cart add exactly once');
});
