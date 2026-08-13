/**
 * FASE 2 — Structured Message mapping tests.
 *
 * Runner: npx tsx --env-file=../../.env --test --test-force-exit src/tests/structured-message.test.ts
 *
 * HARD RULE #1/#5/#15: structured type TIDAK boleh ditentukan keyword/regex/AI-source.
 * Engine hanya mengekspor `result.metadata.reason` (authoritative) + content +
 * cartOpsExecuted. Product/cart/order/checkout/button/image/payment/notification
 * TIDAK ada authoritative payload di result → text. Tests ini membuktikan:
 *   - mapper pure authority-only (T1, T2 quick_reply, T4 cart, handoff, T6 text)
 *   - delivery UPDATE same row (T7 preserve metadata, T8 count=1, T9 id identity,
 *     T10 canonical HTTP=WS, T14 failure-safety) dan lock (T12).
 *
 * Engine (processCustomerMessage) distub — delivery yang diuji; baris conversation_history
 * di-seed manual agar UPDATE target ada (engine asli tidak dijalankan → tak ada INSERT
 * kedua; persis ruang lingkup FASE 2: delivery enrichment saja).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../infrastructure/prisma.js';
import { conversationService } from '../business/conversation.service.js';
import {
  conversationDeliveryService,
  type DeliveryResult,
  type MessageCreatedData,
} from '../services/conversation-delivery.service.js';
import { eventBus, type EventEnvelope } from '../services/event-bus.service.js';
import { mapStructured } from '../services/structured-message.mapper.js';
import { ResponseSource } from '../domain/types.js';
import type { ResponseResult } from '../domain/types.js';

// ── Deterministic fixture (idempotent via before/after cleanup) ──────────────
const STORE_SLUG = 'store-struct-2f';
const WEB_UID = 'webuid-struct-2f';
const STORE_ID = '11111111-1111-4111-8111-000000000001';
const CUST_ID = '11111111-1111-4111-8111-000000000002';
const CONV_ID = '11111111-1111-4111-8111-000000000003';

// Stub state — saved originals, restored after.
const origProcessCustomerMessage = conversationService.processCustomerMessage;
let origUpdate: typeof prisma.conversationHistory.update;

// Captured WS/Http canonical event. Dipakai wrapper object agar TS tidak menyempit
// (control-flow narrowing) tipe `env` jadi `null` ketika dibaca di subtest.
const capturedRef: { env: EventEnvelope<MessageCreatedData> | null } = { env: null };
let unsubMessageCreated: (() => void) | null = null;

function makeResult(opts: {
  id: string;
  reason?: string;
  content: string;
  source?: ResponseSource;
  cartOpsExecuted?: number;
}): ResponseResult {
  const metadata: Record<string, unknown> = { ...(opts.cartOpsExecuted !== undefined ? { cartOpsExecuted: opts.cartOpsExecuted } : {}) };
  if (opts.reason) metadata.reason = opts.reason;
  else metadata.intent = 'smalltalk'; // AI reply_draft path: NO reason, NO source-driven classification
  return {
    conversationId: CONV_ID,
    message: {
      id: opts.id,
      conversationId: CONV_ID,
      sender: 'assistant',
      content: opts.content,
      source: opts.source ?? ResponseSource.AI,
      createdAt: new Date(),
    },
    source: opts.source ?? ResponseSource.AI,
    confidence: 0.9,
    cost: 0,
    requiresHumanReview: false,
    metadata,
  };
}

async function seedRow(result: ResponseResult, existingMeta: Record<string, unknown> | null = null) {
  // Clean slate per integration test (avoid cross-test row accumulation under CONV_ID).
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
    metadata: (r?.metadata && typeof r.metadata === 'object' ? (r.metadata as Record<string, unknown>) : null),
  };
}

test('FASE 2 structured-message', async (t) => {
  // ── setup: clean fixtures then upsert Store/Customer/Conversation ─────────
  await prisma.conversationHistory.deleteMany({ where: { conversationId: CONV_ID } });
  await prisma.conversation.deleteMany({ where: { id: CONV_ID } });
  await prisma.customer.deleteMany({ where: { webUid: WEB_UID } });
  await prisma.store.deleteMany({ where: { slug: STORE_SLUG } });

  await prisma.store.create({ data: { id: STORE_ID, name: 'Struct Test', slug: STORE_SLUG } });
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
    // ── T1: plain text (no authoritative reason; AI reply_draft) ─────────────
    await t.test('T1 mapStructured plain text content → text', async () => {
      const r = makeResult({ id: 'm-t1', content: 'Hai, ada info?' }); // reason undefined
      const s = mapStructured(r);
      assert.equal(s.messageType, 'text');
      assert.equal(s.messagePayload, null);
    });

    // ── T6: no authoritative source — "ada sosis?" must NOT become product ──
    await t.test('T6 "ada sosis?" (dead_end_fallback reason) → text, no product heuristic', async () => {
      const r = makeResult({ id: 'm-t6', reason: 'dead_end_fallback', content: 'ada sosis?', source: ResponseSource.HUMAN });
      const s = mapStructured(r);
      assert.equal(s.messageType, 'text');
      assert.equal(s.messagePayload, null);
    });
    await t.test('T6B AI reply_draft (intent, reason undefined) → text (no intent→type)', async () => {
      const r = makeResult({ id: 'm-t6b', content: 'berapa harga sosis?', source: ResponseSource.AI });
      const s = mapStructured(r);
      assert.equal(s.messageType, 'text');
      assert.equal(s.messagePayload, null);
      // intent/source TIDAK dipakai klasifikasi (HARD RULE #16: source==='ai' bukan bukti).
    });

    // ── T2: authoritative clarification_asked → quick_reply ─────────────────
    await t.test('T2 reason clarification_asked → quick_reply (no fabricated options)', async () => {
      const content = 'Mau sosis atau ayam?';
      const r = makeResult({ id: 'm-t2', reason: 'clarification_asked', content, source: ResponseSource.SOP });
      const s = mapStructured(r);
      assert.equal(s.messageType, 'quick_reply');
      assert.deepEqual(s.messagePayload, { reason: 'clarification_asked', content });
      // Negative: engine tidak expose opsi ke result → delivery TIDAK boleh fabricate.
      assert.equal((s.messagePayload as Record<string, unknown> | null)?.options, undefined);
    });

    // ── T4: authoritative modify_cart → cart ─────────────────────────────────
    await t.test('T4 reason modify_cart → cart payload', async () => {
      const r = makeResult({ id: 'm-t4', reason: 'modify_cart', content: 'Keranjang: sosis x2', source: ResponseSource.PRODUCT, cartOpsExecuted: 1 });
      const s = mapStructured(r);
      assert.equal(s.messageType, 'cart');
      assert.deepEqual(s.messagePayload, { reason: 'modify_cart', cartOpsExecuted: 1, content: 'Keranjang: sosis x2' });
    });

    await t.test('handoff: escalation reason → handoff', async () => {
      const r = makeResult({ id: 'm-ho', reason: 'escalation_clarification_retry_exceeded', content: 'Saya akan hubungkan ke admin', source: ResponseSource.HUMAN });
      const s = mapStructured(r);
      assert.equal(s.messageType, 'handoff');
      assert.equal(s.messagePayload?.reason, 'escalation_clarification_retry_exceeded');
    });

    // ── T7: existing metadata preserved on UPDATE (merge, NOT overwrite) ───
    await t.test('T7 existing metadata preserved + messagePayload attached', async () => {
      const r = makeResult({ id: 'm-t7', reason: 'clarification_asked', content: 'Mau sosis atau ayam?', source: ResponseSource.SOP });
      await seedRow(r, { foo: 'bar', existingField: true });
      capturedRef.env = null;
      stubEngine(r);
      try {
        const res = await conversationDeliveryService.processWebRequest({
          storeId: STORE_ID, customerId: CUST_ID, conversationId: CONV_ID, message: 'customer msg',
        });
        assert.equal(res.kind, 'ok');
        const row = await fetchRow(r.message.id);
        assert.equal(row.messageType, 'quick_reply'); // UPDATE applied
        assert.deepEqual(row.metadata, {
          foo: 'bar',
          existingField: true,
          messagePayload: { reason: 'clarification_asked', content: 'Mau sosis atau ayam?' },
        }); // HARD RULE #7: existing preserved
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
        const res = await conversationDeliveryService.processWebRequest({
          storeId: STORE_ID, customerId: CUST_ID, conversationId: CONV_ID, message: 'msg',
        });
        const httpId = res.kind === 'ok' ? res.messageId : null;
        const wsId = (capturedRef.env as EventEnvelope<MessageCreatedData> | null)?.data
        ?.id ?? null;
        const row = await fetchRow(dbId);
        assert.equal(httpId, dbId); // HTTP messageId = DB id
        assert.equal(wsId, dbId); // WS data.id = DB id
        assert.equal(row.messageType, 'quick_reply');
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
        const res = await conversationDeliveryService.processWebRequest({
          storeId: STORE_ID, customerId: CUST_ID, conversationId: CONV_ID, message: 'msg',
        });
        const http = res as Extract<DeliveryResult, { kind: 'ok' }>;
        const ws = (capturedRef.env as EventEnvelope<MessageCreatedData> | null)
          ?.data as MessageCreatedData | null;
        assert.equal(http.type, ws?.type);
        assert.equal(JSON.stringify(http.payload), JSON.stringify(ws?.payload));
        assert.equal(ws?.type, 'quick_reply');
      } finally {
        restoreEngine();
      }
    });

    // ── T12: lock — concurrent same-conv request → second gets locked (429) ───
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
        // Ekspektasi: tepat satu 'ok' + satu 'locked' (lock 429). Jangan pakai sort
        // (leksikografis 'locked' < 'ok' → asersi salah meski semantik benar).
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
    // cleanup fixtures (FK order)
    await prisma.conversationHistory.deleteMany({ where: { conversationId: CONV_ID } });
    await prisma.conversation.deleteMany({ where: { id: CONV_ID } });
    await prisma.customer.deleteMany({ where: { webUid: WEB_UID } });
    await prisma.store.deleteMany({ where: { slug: STORE_SLUG } });
  }
});
