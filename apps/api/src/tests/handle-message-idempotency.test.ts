/**
 * UNIT6-B Unit 1 — HTTP-level retry-sim for the /handle messageId fix (option a).
 *
 * Goal: prove the /handle messageId gap is closed END-TO-END. Before the fix, /handle
 * called processCustomerMessage with 4 args => messageId undefined => executeWaCartMutation
 * took the unlocked branch at action-registry.ts:1580 (a direct cartAuthority.executeOps
 * with NO claimAction / FOR UPDATE — no idempotency). After the fix, /handle always threads
 * a messageId, so a resent `clientMsgId` is deduped via claimAction (actionId
 * `wa:${convId}:${messageId}` from action-registry.ts:1593-1594) — a single mutation,
 * never a double-apply.
 *
 * This mirrors UNIT F-GAP1's web-message-idempotency.test.ts, adapted for:
 *   - routes/messages.ts /handle (auth-gated via store bearer token — routes/messages.ts:29)
 *     instead of pwa.ts /message (which is slug-based, no bearer auth).
 *   - /handle's body shape: { customerId, conversationId, message, clientMsgId }
 *     (routes/messages.ts:34).
 *   - channel left at its DEFAULT ('whatsapp') per the fix => actionId prefix `wa:`.
 * /handle does NOT echo conversationId in its response (messages.ts:89-96 returns
 * result.message.*), so the test uses the conversationId it sends in the body.
 *
 * The LLM is stubbed (llmGateway.generate — interpreter.ts routes ALL inference through it)
 * so free-text -> cart-op is deterministic. The idempotency under test
 * (actionIdempotency claim keyed `wa:${convId}:${clientMsgId}`) is downstream of, and
 * independent from, the LLM output.
 *
 * Runner:
 *   npx tsx --env-file=../../.env --test --test-force-exit src/tests/handle-message-idempotency.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { prisma } from '../infrastructure/prisma.js';
import messagesRouter from '../routes/messages.js';
import { requestIdMiddleware } from '../middleware/requestId.js';
import { llmGateway } from '../adapters/ai/llm-gateway.js';
import type { AIResponse } from '../adapters/ai/types.js';

const STORE_ID = 'store-gap1-handle';
const PREFIX = STORE_ID;
const AYAM_PRODUCT = 'ayam';
// /handle is auth-gated (routes/messages.ts:29 authMiddleware) -> seed a store bearer token.
const AUTH_TOKEN = 'handle-test-token';
const FUTURE = '2099-12-31T00:00:00.000Z';

// Free-text with no product-name token, no inquiry/order/shipping keywords => every
// Stage-3 tier misses => HUMAN dead-end => Stage 4 (runOneCall) runs.
// (Same BUY_MSG as web-message-idempotency.test.ts.)
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
  await prisma.storeSetting.deleteMany({ where: { storeId: { startsWith: PREFIX } } }).catch(() => {});
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
      name: 'GAP1-handle store',
      slug: STORE_ID,
      email: 'handle@garuda.test',
      phoneNumber: '6281200000099',
      address: 'Jl. handle No. 1',
      originProvinceId: 'prov-gap1-1',
      originProvinceName: 'Jawa Barat',
      originCityId: 'city-gap1-1',
      originCityName: 'Bandung',
      originSubdistrictId: 'sub-gap1-1',
      originSubdistrictName: 'Coblong',
    },
  });
  // Seed the store bearer token that authMiddleware (routes/messages.ts:29) validates.
  await prisma.storeSetting.upsert({
    where: { storeId_key: { storeId: STORE_ID, key: 'auth_token' } },
    update: { value: AUTH_TOKEN },
    create: { storeId: STORE_ID, key: 'auth_token', value: AUTH_TOKEN },
  });
  await prisma.storeSetting.upsert({
    where: { storeId_key: { storeId: STORE_ID, key: 'auth_token_expires_at' } },
    update: { value: FUTURE },
    create: { storeId: STORE_ID, key: 'auth_token_expires_at', value: FUTURE },
  });
  await prisma.product.upsert({
    where: { id: 'prod-gap1-ayam' },
    update: { name: AYAM_PRODUCT, price: 10000, stock: 100, isActive: true, deletedAt: null },
    create: { id: 'prod-gap1-ayam', storeId: STORE_ID, name: AYAM_PRODUCT, price: 10000, stock: 100, isActive: true, currency: 'IDR' },
  });
}

function freshUid(): string {
  return `${PREFIX}-${randomUUID().slice(0, 8)}`;
}

async function postHandle(customerId: string, conversationId: string, clientMsgId: string | null, messageText: string) {
  const res = await fetch(`${baseUrl}/api/messages/handle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AUTH_TOKEN}` },
    body: JSON.stringify({
      customerId,
      conversationId,
      message: messageText,
      ...(clientMsgId ? { clientMsgId } : {}),
    }),
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
      actionId: { startsWith: `wa:${conversationId}:` },
    },
  });
}

let server: any;
let baseUrl = '';

before(async () => {
  await cleanup();
  await setupStore();

  // Stub the LLM (interpreter.ts routes all inference through llmGateway.generate).
  llmGateway.generate = (async (_prompt: string, _opts?: any): Promise<AIResponse> => {
    llmCalls++;
    return { content: AI_CANNED, provider: 'groq', model: 'test-model', tokens: { input: 12, output: 8 }, cost: 0.0001 };
  }) as any;

  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware); // seeds req.requestId (backward-compat fallback)
  app.use('/api/messages', messagesRouter);
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

test('UNIT6-B Unit 1 — /handle messageId fix: stable clientMsgId dedupes (real HTTP retry-sim)', async () => {
  // ── Scenario 1: SAME clientMsgId resent (simulated lost-response retry) ──
  const conv1 = freshUid();
  const uid1 = freshUid();
  const cmk = `MSG-HANDLE-SAME-${randomUUID().slice(0, 8)}`;

  const r1 = await postHandle(uid1, conv1, cmk, BUY_MSG);
  assert.equal(r1.status, 200, `scenario1 POST1 should succeed (got ${r1.status}: ${JSON.stringify(r1.body)})`);
  assert.ok(llmCalls >= 1, 'scenario1: interpreter LLM path was exercised (msg reached Stage 4 via stub)');
  assert.equal(await ayamQty(conv1), 1, `scenario1 POST1 must add ayam once; resp=${JSON.stringify(r1.body)}`);

  // The retry: identical logical message, SAME clientMsgId. Simulates a client that never
  // saw the first response (timeout/lost) and resent the identical logical id.
  const r2 = await postHandle(uid1, conv1, cmk, BUY_MSG);
  assert.equal(r2.status, 200, 'scenario1 retry POST must return 200 (idempotent, not 5xx)');

  // ── The idempotency proof: cart NOT doubled, single claim row ──
  assert.equal(await ayamQty(conv1), 1, 'scenario1 retry with same clientMsgId must NOT double-add (expected qty 1)');
  assert.equal(await countClaim(`wa:${conv1}:${cmk}`), 1, 'scenario1: exactly ONE claim row for the stable clientMsgId (deduped, not a new mutation)');
  assert.equal(await countConvClaims(conv1), 1, 'scenario1: no orphaned second claim row for the same clientMsgId');

  // ── Scenario 2: DIFFERENT clientMsgId, identical text -> both apply ──
  const conv2 = freshUid();
  const uid2 = freshUid();
  const r3 = await postHandle(uid2, conv2, 'MSG-HANDLE-DIFF-A', BUY_MSG); // same text, DIFFERENT id
  assert.equal(r3.status, 200, `scenario2 POST1 should succeed (got ${r3.status}: ${JSON.stringify(r3.body)})`);
  assert.equal(await ayamQty(conv2), 1, 'scenario2 POST1 must add ayam once');

  const r4 = await postHandle(uid2, conv2, 'MSG-HANDLE-DIFF-B', BUY_MSG);
  assert.equal(r4.status, 200, 'scenario2 POST2 should return 200');
  assert.equal(await ayamQty(conv2), 2, 'scenario2: two distinct clientMsgIds + same text -> both apply (1 + 1 = 2; NOT over-deduped)');
  assert.equal(await countConvClaims(conv2), 2, 'scenario2: two distinct ids -> two claim rows (no over-dedupe)');

  // ── Scenario 3: ABSENT clientMsgId (legacy client) -> server uuid fallback ──
  const conv3 = freshUid();
  const uid3 = freshUid();
  const r5 = await postHandle(uid3, conv3, null, BUY_MSG); // NO clientMsgId -> crypto.randomUUID() fallback
  assert.equal(r5.status, 200, `scenario3 legacy (no clientMsgId) must not 4xx/5xx (got ${r3.status}: ${JSON.stringify(r5.body)})`);
  assert.equal(await ayamQty(conv3), 1, 'scenario3: fallback path still applies the cart add exactly once');
});
