/**
 * FASE 2 (patch) — Structured Message mapping tests.
 *
 * Runner: npx tsx --env-file=../../.env --test --test-force-exit src/tests/structured-message.test.ts
 *
 * HARD RULE #1/#5/#15/#16: structured type TIDAK boleh ditentukan keyword/regex/AI-source.
 * Engine mengekspor (otoritatif):
 *   - result.metadata.reason            → quick_reply | cart | handoff | text-fallback
 *   - result.source === PRODUCT + result.metadata.{matchedNames,matchedPrices,productIds}
 *                                        → product | product_list (DB searchProducts, bukan keyword)
 * Enrichment DB-read (FASE 2 patch) hanya untuk melengkapi payload dari state engine yang
 * sudah persisted:
 *   - quick_reply.options ← conversationContextService.getPendingClarification
 *   - cart.items/total   ← orderService.getOrdersByConversation (draft order)
 *   - product stock/imageUrl ← productService.getProductById
 *
 * Engine (processCustomerMessage) distub; baris conversation_history di-seed manual agar
 * UPDATE target ada (engine asli tidak dijalankan → tidak ada INSERT kedua — ruang lingkup
 * FASE 2: delivery enrichment saja). Read-services (getContext/getOrdersByConversation/
 * getProductById) distub untuk deterministic payload; DB row UPDATE tetap real.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../infrastructure/prisma.js';
import { conversationService } from '../business/conversation.service.js';
import { conversationContextService } from '../business/conversation-context.service.js';
import { canonicalConversationStateService } from '../business/canonical-context.service.js';
import { orderService } from '../business/order.service.js';
import { productService } from '../business/product.service.js';
import {
  conversationDeliveryService,
  type DeliveryResult,
  type MessageCreatedData,
} from '../services/conversation-delivery.service.js';
import { eventBus, type EventEnvelope } from '../services/event-bus.service.js';
import { classifyStructured } from '../services/structured-message.mapper.js';
import { ResponseSource } from '../domain/types.js';
import type { ResponseResult } from '../domain/types.js';

// ── Deterministic fixture (idempoten: full cleanup on teardown) ──────────────
const STORE_SLUG = 'store-struct-2f';
const WEB_UID = 'webuid-struct-2f';
const STORE_ID = '11111111-1111-4111-8111-000000000001';
const CUST_ID = '11111111-1111-4111-8111-000000000002';
const CONV_ID = '11111111-1111-4111-8111-000000000003';

const origProcessCustomerMessage = conversationService.processCustomerMessage;
let origUpdate: typeof prisma.conversationHistory.update;

const capturedRef: { env: EventEnvelope<MessageCreatedData> | null } = { env: null };
let unsubMessageCreated: (() => void) | null = null;

// Authoritative clarification options (stubbed context) untuk T2-int/T7/T9/T10.
const TEST_OPTIONS = [{ id: 'opt-1', label: 'Sosis', cartOps: [], action: 'add' }];
const testPendingClarification: any = {
  question: 'Mau sosis atau ayam?',
  options: TEST_OPTIONS,
  expected_type: 'choice',
  retry_count: 0,
};
const contextWithOptions: any = {
  extractedEntities: {
    pendingClarification: testPendingClarification,
  },
};

function makeResult(opts: {
  id: string;
  content: string;
  source?: ResponseSource;
  reason?: string;
  cartOpsExecuted?: number;
  matchedNames?: string[];
  productIds?: string[];
  matchedPrices?: number[];
}): ResponseResult {
  const metadata: Record<string, unknown> = {};
  if (opts.reason) metadata.reason = opts.reason;
  if (opts.cartOpsExecuted !== undefined) metadata.cartOpsExecuted = opts.cartOpsExecuted;
  if (opts.matchedNames) {
    metadata.matchedNames = opts.matchedNames;
    metadata.productIds = opts.productIds ?? [];
    metadata.matchedPrices = opts.matchedPrices ?? [];
  }
  // AI reply_draft path: tidak ada reason, tidak ada matchedNames → intent saja (tidak dipakai klasifikasi)
  if (!opts.reason && !opts.matchedNames) metadata.intent = 'smalltalk';

  const source = opts.source ?? (opts.matchedNames ? ResponseSource.PRODUCT : ResponseSource.AI);
  return {
    conversationId: CONV_ID,
    message: {
      id: opts.id,
      conversationId: CONV_ID,
      sender: 'assistant',
      content: opts.content,
      source,
      createdAt: new Date(),
    },
    source,
    confidence: 0.9,
    cost: 0,
    requiresHumanReview: false,
    metadata,
  };
}

async function seedRow(result: ResponseResult, existingMeta: Record<string, unknown> | null = null) {
  await prisma.conversationHistory.deleteMany({ where: { conversationId: CONV_ID } });
  await prisma.conversationHistory.create({
    data: {
      id: result.message.id,
      conversationId: CONV_ID,
      role: 'assistant',
      content: result.message.content,
      source: String(result.source),
      metadata: existingMeta as any,
      createdAt: result.message.createdAt,
    },
  });
}

async function countRows(): Promise<number> {
  return prisma.conversationHistory.count({ where: { conversationId: CONV_ID } });
}

async function fetchRow(id: string): Promise<{ messageType: string | null; metadata: Record<string, unknown> | null }> {
  const r = await prisma.conversationHistory.findUnique({
    where: { id },
    select: { messageType: true, metadata: true },
  });
  return {
    messageType: r?.messageType ?? null,
    metadata: r?.metadata && typeof r.metadata === 'object' ? (r.metadata as Record<string, unknown>) : null,
  };
}

/** Monkeypatch singleton method; restore on finally (repo pattern: golden stubs groqAdapter). */
function withStub<T extends object, K extends keyof T>(obj: T, k: K, stub: T[K], fn: () => Promise<void>): Promise<void> {
  const orig = obj[k];
  (obj as any)[k] = stub;
  return fn().finally(() => { (obj as any)[k] = orig; });
}

function payloadOf(res: { kind: string; payload?: unknown }): any {
  return res.payload;
}

test('FASE 2 structured-message', async (t) => {
  // ── setup: clean fixtures, upsert Store/Customer/Conversation ────────────
  await prisma.conversationHistory.deleteMany({ where: { conversationId: CONV_ID } });
  await prisma.conversation.deleteMany({ where: { id: CONV_ID } });
  await prisma.customer.deleteMany({ where: { webUid: WEB_UID } });
  await prisma.store.deleteMany({ where: { slug: STORE_SLUG } });

  await prisma.store.create({
    data: {
      id: STORE_ID,
      name: 'Struct Test',
      slug: STORE_SLUG,
      phoneNumber: '+6281200000007',
      address: 'Jl. Test No. 7',
      originProvinceId: 'prov-test-7',
      originProvinceName: 'Jawa Barat',
      originCityId: 'city-test-7',
      originCityName: 'Bandung',
      originSubdistrictId: 'sub-test-7',
      originSubdistrictName: 'Coblong',
    },
  });
  await prisma.customer.create({ data: { id: CUST_ID, storeId: STORE_ID, webUid: WEB_UID, phone: null } });
  await prisma.conversation.create({
    data: { id: CONV_ID, storeId: STORE_ID, customerId: CUST_ID, channel: 'web', customerPhone: null },
  });

  origUpdate = prisma.conversationHistory.update;
  unsubMessageCreated = eventBus.subscribe<MessageCreatedData>('message.created', (env) => {
    capturedRef.env = env;
  });

  const stubEngine = (result: ResponseResult | null) => {
    conversationService.processCustomerMessage = (async () => result) as typeof conversationService.processCustomerMessage;
  };
  const restoreEngine = () => {
    conversationService.processCustomerMessage = origProcessCustomerMessage;
  };
  const restoreUpdate = () => {
    prisma.conversationHistory.update = origUpdate;
  };

  try {
    // ══════════════════════════════════════════════════════════════════════════
    // PURE TYPE-DECISION (sync classifyStructured — tidak ada DB read)
    // ══════════════════════════════════════════════════════════════════════════

    // ── T1: plain text (reason undefined; AI reply_draft) ─────────────────────
    await t.test('T1 classifyStructured plain text (reason undefined) → text', () => {
      const r = makeResult({ id: 'm-t1', content: 'Hai, ada info?' }); // reason undefined
      const s = classifyStructured(r);
      assert.equal(s.messageType, 'text');
      assert.equal(s.basePayload, null);
    });

    // ── T6: "ada sosis?" tidak boleh jadi product via keyword/regex ───────────
    await t.test('T6 dead_end_fallback reason → text, NO product heuristic', () => {
      const r = makeResult({ id: 'm-t6', reason: 'dead_end_fallback', content: 'ada sosis?', source: ResponseSource.HUMAN });
      const s = classifyStructured(r);
      assert.equal(s.messageType, 'text');
      assert.equal(s.basePayload, null);
    });
    await t.test('T6B AI reply_draft (intent, reason undefined) → text (source==="ai" bukan bukti)', () => {
      const r = makeResult({ id: 'm-t6b', content: 'berapa harga sosis?', source: ResponseSource.AI });
      const s = classifyStructured(r);
      assert.equal(s.messageType, 'text');
      assert.equal(s.basePayload, null);
    });

    // ── T2: authoritative clarification_asked → quick_reply (pure type only) ──
    await t.test('T2 classifyStructured clarification_asked → quick_reply (basePayload: reason+question, NO options)', () => {
      const content = 'Mau sosis atau ayam?';
      const r = makeResult({ id: 'm-t2', reason: 'clarification_asked', content, source: ResponseSource.SOP });
      const s = classifyStructured(r);
      assert.equal(s.messageType, 'quick_reply');
      assert.deepEqual(s.basePayload, { reason: 'clarification_asked', question: content });
      // Engine TIDAK expose opsi ke result → classify punya NO options (enrichment baru menambah).
      assert.equal(Object.keys(s.basePayload ?? {}).includes('options'), false);
    });

    // ── T4: authoritative modify_cart → cart (pure type only; items via enrichment) ─
    await t.test('T4 classifyStructured modify_cart → cart (basePayload: reason+cartOpsExecuted, NO items yet)', () => {
      const r = makeResult({ id: 'm-t4', reason: 'modify_cart', content: 'Keranjang: sosis x2', source: ResponseSource.PRODUCT, cartOpsExecuted: 1 });
      const s = classifyStructured(r);
      assert.equal(s.messageType, 'cart');
      assert.deepEqual(s.basePayload, { reason: 'modify_cart', cartOpsExecuted: 1 });
      assert.equal(Object.keys(s.basePayload ?? {}).includes('items'), false);
    });

    // ── handoff: engine eskalasi setelah clarification retry melebihi ─────────
    await t.test('handoff classifyStructured escalation reason → handoff', () => {
      const r = makeResult({ id: 'm-ho', reason: 'escalation_clarification_retry_exceeded', content: 'Saya akan hubungkan ke admin', source: ResponseSource.HUMAN });
      const s = classifyStructured(r);
      assert.equal(s.messageType, 'handoff');
      assert.equal(s.basePayload?.reason, 'escalation_clarification_retry_exceeded');
    });

    // ── T3: product authoritatif (source=PRODUCT + matchedNames dari DB search) ─
    await t.test('T3 classifyStructured PRODUCT + 1 matchedName → product (pure, no heuristic)', () => {
      const r = makeResult({ id: 'm-t3', source: ResponseSource.PRODUCT, content: 'Harga sosis Rp 15.000', matchedNames: ['Sosis'], productIds: ['p-sosis'], matchedPrices: [15000] });
      const s = classifyStructured(r);
      assert.equal(s.messageType, 'product');
      assert.deepEqual(s.basePayload, { id: 'p-sosis', name: 'Sosis', price: 15000 });
    });
    await t.test('T3-list classifyStructured PRODUCT + 2 matchedNames → product_list', () => {
      const r = makeResult({ id: 'm-t3l', source: ResponseSource.PRODUCT, content: 'Pilih: sosis / kentang', matchedNames: ['Sosis', 'Kentang'], productIds: ['p1', 'p2'], matchedPrices: [15000, 12000] });
      const s = classifyStructured(r);
      assert.equal(s.messageType, 'product_list');
      assert.equal((s.basePayload?.items as Array<Record<string, unknown>>).length, 2);
    });

    // ── Evidence: tiada authoritative source → text (HARD RULE #5/#16) ────────
    // BUTTON: composer-v2 grep (action|button|quick_reply|suggestion|payload) = kosong.
    await t.test('BUTTON/order/checkout/catalog → text (no authoritative source)', () => {
      const orderStatus = makeResult({ id: 'm-btn1', reason: undefined, content: 'status?', source: ResponseSource.ORDER_STATUS });
      const checkout = makeResult({ id: 'm-btn2', reason: undefined, content: 'checkout', source: ResponseSource.PAYMENT });
      const catalog = makeResult({ id: 'm-btn3', reason: undefined, content: 'daftar', source: ResponseSource.CATALOG, matchedNames: undefined });
      // CATALOG tanpa matchedNames (hanya productCount) → tidak ada item array authoritatif → text
      assert.equal(classifyStructured(orderStatus).messageType, 'text');
      assert.equal(classifyStructured(checkout).messageType, 'text');
      assert.equal(classifyStructured(catalog).messageType, 'text');
      assert.equal(catalog.metadata?.matchedNames, undefined, 'catalog metadata tidak punya matchedNames');
    });

    // ══════════════════════════════════════════════════════════════════════════
    // INTEGRATION via delivery (enrichment DB-read, row UPDATE real)
    // ══════════════════════════════════════════════════════════════════════════

    // ── T2-int: quick_reply options authoritative (stubbed context getState) ─
    await t.test('T2-int quick_reply payload.options == authoritative context options', async () => {
      const options = [
        { id: 'opt-sosis', label: 'Sosis', cartOps: [{ productId: 'p1', quantity: 1, action: 'add' }], action: 'add' },
        { id: 'opt-ayam', label: 'Ayam', action: 'add' },
      ];
      const pendingStub: any = {
        question: 'Mau sosis atau ayam?',
        options,
        expected_type: 'choice',
        retry_count: 0,
      };
      const r = makeResult({ id: 'm-t2i', reason: 'clarification_asked', content: 'Mau sosis atau ayam?', source: ResponseSource.SOP });
      await seedRow(r);
      stubEngine(r);
      capturedRef.env = null;
      try {
        await withStub(canonicalConversationStateService, 'getV1PendingClarification', (async () => pendingStub) as any, async () => {
          const res = await conversationDeliveryService.processWebRequest({
            storeId: STORE_ID, customerId: CUST_ID, conversationId: CONV_ID, message: 'msg',
          });
          assert.equal(res.kind, 'ok');
          assert.equal((res as Extract<DeliveryResult, { kind: 'ok' }>).type, 'quick_reply');
          assert.deepEqual(payloadOf(res)?.options, options); // options == authoritative context options

          const row = await fetchRow(r.message.id);
          assert.equal(row.messageType, 'quick_reply');
          assert.deepEqual((row.metadata?.messagePayload as Record<string, unknown> | undefined)?.options, options);

          const ws = (capturedRef.env as EventEnvelope<MessageCreatedData> | null)?.data as MessageCreatedData;
          assert.equal(ws?.type, 'quick_reply');
          assert.deepEqual(ws?.payload?.options, options);
        });
      } finally {
        restoreEngine();
      }
    });

    // ── T2b-int: clarification_asked BUT authoritative options unavailable → text (HARD RULE) ────
    await t.test('T2b-int clarification_asked but NO options → text (empty quick_reply disallowed)', async () => {
      const r = makeResult({ id: 'm-t2b', reason: 'clarification_asked', content: 'Mau sosis atau ayam?', source: ResponseSource.SOP });
      await seedRow(r);
      stubEngine(r);
      capturedRef.env = null;
      try {
        // Stub: tidak ada pending clarification (G2-D.2: canonical read returns null)
        await withStub(canonicalConversationStateService, 'getV1PendingClarification', (async () => null) as any, async () => {
          const res = await conversationDeliveryService.processWebRequest({
            storeId: STORE_ID, customerId: CUST_ID, conversationId: CONV_ID, message: 'msg',
          });
          assert.equal(res.kind, 'ok');
          assert.equal((res as Extract<DeliveryResult, { kind: 'ok' }>).type, 'text'); // downgrade: tidak boleh quick_reply kosong
          assert.equal((res as Extract<DeliveryResult, { kind: 'ok' }>).payload, null);
        });
        // also explicit: pendingClarification ada tapi options kosong
        await withStub(canonicalConversationStateService, 'getV1PendingClarification', (async () => ({ question: 'q', options: [], expected_type: 'choice', retry_count: 0 } as any)) as any, async () => {
          const res = await conversationDeliveryService.processWebRequest({
            storeId: STORE_ID, customerId: CUST_ID, conversationId: CONV_ID, message: 'msg',
          });
          assert.equal((res as Extract<DeliveryResult, { kind: 'ok' }>).type, 'text'); // [] juga → text
        });
      } finally {
        restoreEngine();
      }
    });

    // ── T4-int: cart items + total authoritative (stubbed orderService) ──────
    await t.test('T4-int cart payload.items + total == authoritative draft order', async () => {
      const orders = [
        {
          orderStatus: 'draft',
          totalPrice: 123000,
          items: [
            { id: 'oi1', productName: 'Sosis', quantity: 2, unitPrice: 50000, subtotal: 100000 },
            { id: 'oi2', productName: 'Kentang', quantity: 1, unitPrice: 23000, subtotal: 23000 },
          ],
        },
      ];
      const r = makeResult({ id: 'm-t4i', reason: 'modify_cart', content: 'Keranjang: sosis x2, kentang x1', source: ResponseSource.PRODUCT, cartOpsExecuted: 3 });
      await seedRow(r);
      stubEngine(r);
      capturedRef.env = null;
      try {
        await withStub(orderService, 'getOrdersByConversation', (async () => orders) as any, async () => {
          const res = await conversationDeliveryService.processWebRequest({
            storeId: STORE_ID, customerId: CUST_ID, conversationId: CONV_ID, message: 'msg',
          });
          assert.equal(res.kind, 'ok');
          assert.equal((res as Extract<DeliveryResult, { kind: 'ok' }>).type, 'cart');
          const payload = payloadOf(res);
          assert.equal(payload?.total, 123000); // total == authoritative order.totalPrice
          assert.deepEqual(payload?.items, orders[0].items); // items == authoritative order items
          assert.equal(payload?.cartOpsExecuted, 3);

          const row = await fetchRow(r.message.id);
          assert.equal(row.messageType, 'cart');
          assert.deepEqual((row.metadata?.messagePayload as Record<string, unknown> | undefined)?.items, orders[0].items);
        });
      } finally {
        restoreEngine();
      }
    });

    // ── T4b-int: keranjang kosong (no draft items) → DOWNGRADE ke text ───────
    await t.test('T4b-int modify_cart but empty cart → downgrade to text', async () => {
      const r = makeResult({ id: 'm-t4b', reason: 'modify_cart', content: 'Keranjang kosong', source: ResponseSource.PRODUCT, cartOpsExecuted: 1 });
      await seedRow(r);
      stubEngine(r);
      capturedRef.env = null;
      try {
        await withStub(orderService, 'getOrdersByConversation', (async () => [{ orderStatus: 'draft', totalPrice: 0, items: [] }]) as any, async () => {
          const res = await conversationDeliveryService.processWebRequest({
            storeId: STORE_ID, customerId: CUST_ID, conversationId: CONV_ID, message: 'msg',
          });
          assert.equal(res.kind, 'ok');
          assert.equal((res as Extract<DeliveryResult, { kind: 'ok' }>).type, 'text');
          assert.equal((res as Extract<DeliveryResult, { kind: 'ok' }>).payload, null);
        });
      } finally {
        restoreEngine();
      }
    });

    // ── T3-int: product payload {id,name,price,stock,imageUrl} (stubbed product) ──
    await t.test('T3-int product payload == {id,name,price,stock,imageUrl} from authoritative match + DB', async () => {
      const prod = { id: 'p-sosis', name: 'Sosis', price: 15000, stock: 5, primaryImageUrl: 'http://x/s.png', currency: 'IDR' };
      const r = makeResult({ id: 'm-t3i', source: ResponseSource.PRODUCT, content: 'Harga sosis Rp 15.000', matchedNames: ['Sosis'], productIds: ['p-sosis'], matchedPrices: [15000] });
      await seedRow(r);
      stubEngine(r);
      capturedRef.env = null;
      try {
        await withStub(productService, 'getProductById', (async (_id: string) => prod) as any, async () => {
          const res = await conversationDeliveryService.processWebRequest({
            storeId: STORE_ID, customerId: CUST_ID, conversationId: CONV_ID, message: 'msg',
          });
          assert.equal(res.kind, 'ok');
          assert.equal((res as Extract<DeliveryResult, { kind: 'ok' }>).type, 'product');
          assert.deepEqual(payloadOf(res), { id: 'p-sosis', name: 'Sosis', price: 15000, stock: 5, imageUrl: 'http://x/s.png' });
          // pastikan field internal TIDAK expose
          assert.equal(Object.keys(payloadOf(res) ?? {}).includes('costUSD'), false);
          assert.equal(Object.keys(payloadOf(res) ?? {}).includes('margin'), false);
        });
      } finally {
        restoreEngine();
      }
    });

    // ── T3-list-int: product_list enrichment (stubbed product) ────────────────
    await t.test('T3-list-int product_list payload.items enriched with stock+imageUrl', async () => {
      const byId: Record<string, any> = {
        'p1': { id: 'p1', name: 'Sosis', price: 15000, stock: 3, primaryImageUrl: 'http://x/s.png' },
        'p2': { id: 'p2', name: 'Kentang', price: 12000, stock: 0, primaryImageUrl: null },
      };
      const r = makeResult({ id: 'm-t3li', source: ResponseSource.PRODUCT, content: 'Pilih: sosis / kentang', matchedNames: ['Sosis', 'Kentang'], productIds: ['p1', 'p2'], matchedPrices: [15000, 12000] });
      await seedRow(r);
      stubEngine(r);
      capturedRef.env = null;
      try {
        await withStub(productService, 'getProductById', (async (id: string) => byId[id]) as any, async () => {
          const res = await conversationDeliveryService.processWebRequest({
            storeId: STORE_ID, customerId: CUST_ID, conversationId: CONV_ID, message: 'msg',
          });
          assert.equal(res.kind, 'ok');
          assert.equal((res as Extract<DeliveryResult, { kind: 'ok' }>).type, 'product_list');
          assert.deepEqual(payloadOf(res)?.items, [
            { id: 'p1', name: 'Sosis', price: 15000, stock: 3, imageUrl: 'http://x/s.png' },
            { id: 'p2', name: 'Kentang', price: 12000, stock: 0, imageUrl: null },
          ]);
        });
      } finally {
        restoreEngine();
      }
    });

    // ═════ EXISTING persistence/dedup/lock/canonical tests (updated assertions) ═════

    // ── T7: existing metadata preserved on UPDATE (merge, NOT overwrite) ───
    await t.test('T7 existing metadata preserved + messagePayload attached', async () => {
      const r = makeResult({ id: 'm-t7', reason: 'clarification_asked', content: 'Mau sosis atau ayam?', source: ResponseSource.SOP });
      await seedRow(r, { foo: 'bar', existingField: true });
      capturedRef.env = null;
      stubEngine(r);
      try {
        await withStub(canonicalConversationStateService, 'getV1PendingClarification', (async () => testPendingClarification) as any, async () => {
          const res = await conversationDeliveryService.processWebRequest({
            storeId: STORE_ID, customerId: CUST_ID, conversationId: CONV_ID, message: 'customer msg',
          });
          assert.equal(res.kind, 'ok');
          const row = await fetchRow(r.message.id);
          assert.equal(row.messageType, 'quick_reply'); // UPDATE applied
          assert.deepEqual(row.metadata, {
            foo: 'bar',
            existingField: true,
            // enrichment: stubbed context → options == TEST_OPTIONS
            messagePayload: { reason: 'clarification_asked', question: 'Mau sosis atau ayam?', options: TEST_OPTIONS },
          }); // HARD RULE #7: existing preserved
        });
      } finally {
        restoreEngine();
      }
    });

    // ── T8: SAME ROW — no second INSERT (engine stubbed = no saveMessage) ─────
    await t.test('T8 same row — row count stays 1 (no second insert)', async () => {
      const r = makeResult({ id: 'm-t8', reason: 'modify_cart', content: 'cart', source: ResponseSource.PRODUCT, cartOpsExecuted: 2 });
      await seedRow(r); // exactly 1 row
      stubEngine(r);
      try {
        const before = await countRows();
        const res = await conversationDeliveryService.processWebRequest({
          storeId: STORE_ID, customerId: CUST_ID, conversationId: CONV_ID, message: 'msg',
        });
        assert.equal(res.kind, 'ok');
        const after = await countRows();
        assert.equal(before, 1);
        assert.equal(after, 1); // TIDAK bertambah → no second insert
      } finally {
        restoreEngine();
      }
    });

    // ── T9: message identity — DB id = HTTP messageId = WS event.data.id ─────
    await t.test('T9 DB id = HTTP messageId = WS data.id (same id)', async () => {
      const r = makeResult({ id: 'm-t9', reason: 'clarification_asked', content: 'q?', source: ResponseSource.SOP });
      await seedRow(r);
      const dbId = r.message.id;
      capturedRef.env = null;
      stubEngine(r);
      try {
        await withStub(canonicalConversationStateService, 'getV1PendingClarification', (async () => testPendingClarification) as any, async () => {
          const res = await conversationDeliveryService.processWebRequest({
            storeId: STORE_ID, customerId: CUST_ID, conversationId: CONV_ID, message: 'msg',
          });
          const httpId = res.kind === 'ok' ? res.messageId : null;
          const wsId = (capturedRef.env as EventEnvelope<MessageCreatedData> | null)?.data?.id ?? null;
          const row = await fetchRow(dbId);
          assert.equal(httpId, dbId); // HTTP messageId = DB id
          assert.equal(wsId, dbId); // WS data.id = DB id
          assert.equal(row.messageType, 'quick_reply');
        });
      } finally {
        restoreEngine();
      }
    });

    // ── T10: canonical representation — HTTP type/payload == WS type/payload ─
    await t.test('T10 HTTP type/payload == WS event data type/payload (canonical)', async () => {
      const r = makeResult({ id: 'm-t10', reason: 'clarification_asked', content: 'pilih?', source: ResponseSource.SOP });
      await seedRow(r);
      capturedRef.env = null;
      stubEngine(r);
      try {
        await withStub(canonicalConversationStateService, 'getV1PendingClarification', (async () => testPendingClarification) as any, async () => {
          const res = await conversationDeliveryService.processWebRequest({
            storeId: STORE_ID, customerId: CUST_ID, conversationId: CONV_ID, message: 'msg',
          });
          const http = res as Extract<DeliveryResult, { kind: 'ok' }>;
          const ws = (capturedRef.env as EventEnvelope<MessageCreatedData> | null)?.data as MessageCreatedData | null;
          assert.equal(http.type, ws?.type);
          assert.equal(JSON.stringify(http.payload), JSON.stringify(ws?.payload));
          assert.equal(ws?.type, 'quick_reply');
        });
      } finally {
        restoreEngine();
      }
    });

    // ── T12: lock — concurrent same-conv request → second gets locked (429) ────
    await t.test('T12 lock: concurrent same-conversation → one locked', async () => {
      const r = makeResult({ id: 'm-t12', content: 'x' }); // no reason → text
      await seedRow(r);
      stubEngine(r);
      try {
        const [a, b] = await Promise.all([
          conversationDeliveryService.processWebRequest({ storeId: STORE_ID, customerId: CUST_ID, conversationId: CONV_ID, message: 'a' }),
          conversationDeliveryService.processWebRequest({ storeId: STORE_ID, customerId: CUST_ID, conversationId: CONV_ID, message: 'b' }),
        ]);
        const kinds = [a.kind, b.kind];
        assert.equal(kinds.filter((k) => k === 'ok').length, 1, 'one ok');
        assert.equal(kinds.filter((k) => k === 'locked').length, 1, 'one locked');
      } finally {
        restoreEngine();
      }
    });

    // ── T14: failure safety — UPDATE throws → text, no second insert, no throw ─
    await t.test('T14 structured UPDATE fails → fallback text, no second insert', async () => {
      const r = makeResult({ id: 'm-t14', reason: 'clarification_asked', content: 'q?', source: ResponseSource.SOP });
      await seedRow(r);
      stubEngine(r);
      // Force the structured UPDATE to fail (HARD RULE #9: must fall back to text).
      prisma.conversationHistory.update = (async () => { throw new Error('PROBE_UPDATE_FAIL'); }) as unknown as typeof origUpdate;
      try {
        const res = await conversationDeliveryService.processWebRequest({
          storeId: STORE_ID, customerId: CUST_ID, conversationId: CONV_ID, message: 'msg',
        });
        assert.equal(res.kind, 'ok');
        assert.equal((res as Extract<DeliveryResult, { kind: 'ok' }>).type, 'text'); // fallback
        assert.equal((res as Extract<DeliveryResult, { kind: 'ok' }>).payload, null);
        const row = await fetchRow(r.message.id);
        assert.equal(row.messageType, null); // UPDATE tidak apply
        assert.equal(await countRows(), 1); // no second insert
      } finally {
        restoreEngine();
        restoreUpdate();
      }
    });

  } finally {
    if (unsubMessageCreated) unsubMessageCreated();
    // cleanup fixtures (hanya yang memang dibuat: history/conversation/customer/store)
    await prisma.conversationHistory.deleteMany({ where: { conversationId: CONV_ID } });
    await prisma.conversation.deleteMany({ where: { id: CONV_ID } });
    await prisma.customer.deleteMany({ where: { webUid: WEB_UID } });
    await prisma.store.deleteMany({ where: { slug: STORE_SLUG } });
  }
});
