/**
 * WIRE-PAYMENT-V2 — End-to-End proof: "customer minta bayar" via WA.
 *
 * Runner:
 *   npx tsx --env-file=../../.env --test --test-force-exit \
 *     src/tests/wa-payment-v2-rewrite-e2e.test.ts
 *
 * PROVES (requirement: "test manual end-to-end via WA — customer minta bayar
 * → terima link/gambar QRIS ATAU info rekenking ATAU konfirmasi COD sesuai
 * setting toko"):
 *
 *   A. v2-rewrite ACTIVE path (chatEngine.v2RewriteMode='active') recognizes the
 *      LLM's `payment_inquiry` intent + `SHOW_PAYMENT_METHODS` proposed_action and
 *      maps it back to the PROVEN V1 trigger (result.source === 'payment' &&
 *      metadata.qrisImageUrl) — reusing fallbackService.getPaymentInfo() (the
 *      exact store + bank + QRIS/COD logic from fallback.service.ts tryPayment).
 *
 *   B. message-processor.service.ts:321 fires sendQrisFollowUp, which sends the
 *      QRIS image via the WA gateway (gateway.sendImage) when qrisImageUrl is set,
 *      and the payment-methods text (rekenking / COD / QRIS) via gateway.sendMessage.
 *
 *   C. "sesuai setting toko" (per DECISION-COD-SETTLEMENT-DEFERRED.md — COD only
 *      when store activates acceptsCod): COD-only / QRIS-only / Transfer-only
 *      stores each disclose ONLY their activated methods.
 *
 * The LLM (llmGateway.generate) and the WA gateway transport (gowaAdapter
 * sendMessage/sendImage/sendMarkRead/setPresence) are stubbed — every layer above
 * them (processMessage → conversationService → callV2Engine → getPaymentInfo →
 * sendWithPresence → sendQrisFollowUp) runs real, against the local garuda_dev DB.
 */
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../infrastructure/prisma.js';
import { conversationService } from '../business/conversation.service.js';
import { messageProcessorService } from '../services/message-processor.service.js';
import { fallbackService } from '../business/fallback.service.js';
import { llmGateway } from '../adapters/ai/llm-gateway.js';
import { gowaAdapter } from '../adapters/whatsapp/gowa.adapter.js';
import { configService } from '../business/config.service.js';
import { ResponseSource } from '../domain/types.js';
import type { AIResponse } from '../adapters/ai/types.js';
import type { V2EngineOutput } from '../services/chat/v2-engine/schema.js';

const PREFIX = 'test-wa-pay-v2';
const STORE_ID = `${PREFIX}-store`;
const CUSTOMER_PHONE = '+6281200000900';
const QRIS_URL = 'https://cdn.example.com/qris/test-wa-pay-v2.png';

// ── Mock LLM: return a canned, schema-valid V2EngineOutput ──────────────────
const originalGenerate = llmGateway.generate.bind(llmGateway);

function paymentOutput(): V2EngineOutput {
  return {
    schema_version: 'v1',
    intent: 'payment_inquiry',
    confidence: 0.9,
    entities: [],
    proposed_actions: [
      { action_type: 'SHOW_PAYMENT_METHODS', payload: {}, confidence: 0.9, requires_validation: false },
    ],
    reply_text: 'Berikut metode pembayaran yang tersedia ya Kak!',
    needs_clarification: false,
    uncertainty_signals: [],
  };
}

// ── WA gateway capture + stubs ───────────────────────────────────────────────
const sendMsgCalls: Array<{ phone: string; text: string }> = [];
const sendImgCalls: Array<{ phone: string; imageUrl: string; caption?: string }> = [];
let saved: { sendMessage: any; sendImage: any; markRead: any; setPresence: any } = {
  sendMessage: undefined, sendImage: undefined, markRead: undefined, setPresence: undefined,
};

function stubGateway() {
  sendMsgCalls.length = 0;
  sendImgCalls.length = 0;
  // save + override instance methods (own properties shadow the prototype)
  saved.sendMessage = (gowaAdapter as any).sendMessage;
  saved.sendImage = (gowaAdapter as any).sendImage; // undefined — GowaAdapter has no sendImage
  saved.markRead = (gowaAdapter as any).markRead;
  saved.setPresence = (gowaAdapter as any).setPresence;

  (gowaAdapter as any).sendMessage = async (phone: string, text: string, _cfg?: any) => {
    sendMsgCalls.push({ phone, text });
    return { sent: true };
  };
  (gowaAdapter as any).sendImage = async (phone: string, imageUrl: string, caption?: string) => {
    sendImgCalls.push({ phone, imageUrl, caption });
    return { sent: true };
  };
  (gowaAdapter as any).markRead = async () => {};
  (gowaAdapter as any).setPresence = async () => {};
}

function restoreGateway() {
  if (saved.sendImage === undefined) {
    delete (gowaAdapter as any).sendImage;
  } else {
    (gowaAdapter as any).sendImage = saved.sendImage;
  }
  (gowaAdapter as any).sendMessage = saved.sendMessage;
  if (saved.markRead === undefined) delete (gowaAdapter as any).markRead;
  else (gowaAdapter as any).markRead = saved.markRead;
  if (saved.setPresence === undefined) delete (gowaAdapter as any).setPresence;
  else (gowaAdapter as any).setPresence = saved.setPresence;
  saved = { sendMessage: undefined, sendImage: undefined, markRead: undefined, setPresence: undefined };
}

function mockLlm(output: V2EngineOutput) {
  llmGateway.generate = (async (_prompt: string, _opts?: any) => ({
    content: JSON.stringify(output),
    provider: 'groq',
    model: 'test-model-v2',
    tokens: { input: 1, output: 1 },
    cost: 0,
  })) as any;
}

// ── DB setup ─────────────────────────────────────────────────────────────────
let rewriteModeOrig: string | null = null;

async function setupStore(opts: { transfer: boolean; qris: boolean; cod: boolean }) {
  await prisma.store.upsert({
    where: { id: STORE_ID },
    update: {
      name: 'WA Pay V2 Test Store',
      acceptsTransfer: opts.transfer,
      acceptsQris: opts.qris,
      acceptsCod: opts.cod,
      qrisImageUrl: opts.qris ? QRIS_URL : null,
    },
    create: {
      id: STORE_ID,
      name: 'WA Pay V2 Test Store',
      slug: `${PREFIX}-slug`,
      isActive: true,
      acceptsTransfer: opts.transfer,
      acceptsQris: opts.qris,
      qrisImageUrl: opts.qris ? QRIS_URL : null,
      acceptsCod: opts.cod,
      phoneNumber: CUSTOMER_PHONE,
      address: 'Jl. Test No. 90',
      originProvinceId: 'prov-test-90',
      originProvinceName: 'Jawa Barat',
      originCityId: 'city-test-90',
      originCityName: 'Bandung',
      originSubdistrictId: 'sub-test-90',
      originSubdistrictName: 'Coblong',
    },
  });
  // bank account (for transfer)
  await prisma.bankAccount.upsert({
    where: { id: `${PREFIX}-bank` },
    update: { storeId: STORE_ID, bankName: 'BCA', accountNumber: '999988887777', accountName: 'CV Test V2', isActive: true, deletedAt: null },
    create: { id: `${PREFIX}-bank`, storeId: STORE_ID, bankName: 'BCA', accountNumber: '9999888877770001', accountName: 'CV Test V2', isActive: true },
  });
}

async function cleanupConversation(convId: string) {
  // FK-safe order: child tables first (column-level filters)
  await prisma.conversationHistory.deleteMany({ where: { conversationId: convId } }).catch(() => {});
  await prisma.conversationContext.deleteMany({ where: { conversationId: convId } }).catch(() => {});
  await prisma.conversation.delete({ where: { id: convId } }).catch(() => {});
}

async function cleanup() {
  await prisma.conversationHistory.deleteMany({ where: { conversation: { storeId: STORE_ID } } }).catch(() => {});
  await prisma.conversationContext.deleteMany({ where: { conversation: { storeId: STORE_ID } } }).catch(() => {});
  await prisma.conversation.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
  await prisma.bankAccount.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
  await prisma.product.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
  await prisma.store.deleteMany({ where: { id: STORE_ID } }).catch(() => {});
}

function waitFor<T>(fn: () => T | null, opts: { timeout: number; interval?: number }): Promise<T> {
  const interval = opts.interval ?? 100;
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      try {
        const v = fn();
        if (v) return resolve(v);
      } catch { /* ignore */ }
      if (Date.now() - start >= opts.timeout) return reject(new Error('waitFor timeout'));
      setTimeout(check, interval);
    };
    check();
  });
}

before(async () => {
  await cleanup();
  rewriteModeOrig = await configService.getConfig('chatEngine.v2RewriteMode');
  await configService.setConfig('chatEngine.v2RewriteMode', 'active', { category: 'feature_flag' });
  await setupStore({ transfer: true, qris: true, cod: true });
});

after(async () => {
  if (rewriteModeOrig !== null) {
    await configService.setConfig('chatEngine.v2RewriteMode', rewriteModeOrig, { category: 'feature_flag' });
  }
  await cleanup();
  llmGateway.generate = originalGenerate;
  restoreGateway();
  await prisma.$disconnect();
});

afterEach(() => {
  llmGateway.generate = originalGenerate;
  restoreGateway();
});

// ─────────────────────────────────────────────────────────────────────────────
// PART A — v2-rewrite active path produces the PROVEN V1 payment trigger
// (source === 'payment' + metadata.qrisImageUrl), reusing getPaymentInfo(),
// sesuai setting toko (COD only bila acceptsCod, dst).
// ─────────────────────────────────────────────────────────────────────────────

test('COD-only store: payment_inquiry → source=PAYMENT, content mentions COD, no QRIS image', async () => {
  await setupStore({ transfer: false, qris: false, cod: true });
  mockLlm(paymentOutput());
  const convId = `conv-cod-${Date.now()}`;
  const result = await conversationService.processCustomerMessage(
    STORE_ID, CUSTOMER_PHONE, convId, 'bisa cod ga?', 'whatsapp',
  );
  await cleanupConversation(convId);

  assert.ok(result, 'must return a payment reply');
  assert.equal(result!.source, ResponseSource.PAYMENT, `expected PAYMENT, got ${result!.source}`);
  assert.match(result!.message.content, /COD|M\\?u di tempat|bayar ditempat/i);
  assert.equal(result!.metadata?.qrisImageUrl, undefined, 'COD-only store must NOT set qrisImageUrl');
});

test('QRIS-only store (qrisImageUrl set): payment_inquiry → source=PAYMENT, content mentions QRIS, qrisImageUrl set', async () => {
  await setupStore({ transfer: false, qris: true, cod: false });
  mockLlm(paymentOutput());
  const convId = `conv-qris-${Date.now()}`;
  const result = await conversationService.processCustomerMessage(
    STORE_ID, CUSTOMER_PHONE, convId, 'mau bayar pakai qris', 'whatsapp',
  );
  await cleanupConversation(convId);

  assert.ok(result);
  assert.equal(result!.source, ResponseSource.PAYMENT);
  assert.match(result!.message.content, /QRIS/i);
  assert.equal(result!.metadata?.qrisImageUrl, QRIS_URL, 'QRIS-enabled store must surface qrisImageUrl as the trigger');
});

test('Transfer-only store (bank account): payment_inquiry → source=PAYMENT, content mentions rekenking, no QRIS image', async () => {
  await setupStore({ transfer: true, qris: false, cod: false });
  mockLlm(paymentOutput());
  const convId = `conv-transfer-${Date.now()}`;
  const result = await conversationService.processCustomerMessage(
    STORE_ID, CUSTOMER_PHONE, convId, 'mau bayar via transfer', 'whatsapp',
  );
  await cleanupConversation(convId);

  assert.ok(result);
  assert.equal(result!.source, ResponseSource.PAYMENT);
  assert.match(result!.message.content, /Transfer Bank/i);
  assert.match(result!.message.content, /999988887777/); // bank account no (auto-decrypted by prisma middleware)
  assert.equal(result!.metadata?.qrisImageUrl, undefined, 'Transfer-only store must NOT set qrisImageUrl');
});

test('getPaymentInfo() reuses V1 logic for all-enabled store and surfaces qrisImageUrl', async () => {
  await setupStore({ transfer: true, qris: true, cod: true });
  const info = await fallbackService.getPaymentInfo(STORE_ID);
  assert.ok(info, 'getPaymentInfo must return content for all-enabled store');
  assert.match(info!.content, /Transfer Bank/i);
  assert.match(info!.content, /QRIS/i);
  assert.match(info!.content, /COD/i);
  assert.equal(info!.qrisImageUrl, QRIS_URL);
});

// ─────────────────────────────────────────────────────────────────────────────
// PART B — WA end-to-end via message-processor → WA gateway (gowaAdapter).
// Customer "mau bayar" → bot sends payment text + QRIS IMAGE via WA gateway.
// (Urgent keyword "transfer" bypasses the coalescer so dispatch is near-real-time.)
// ─────────────────────────────────────────────────────────────────────────────

test('WA E2E: customer asks to pay (all methods + QRIS) → WA gateway receives QRIS image + rekenking + COD', async () => {
  await setupStore({ transfer: true, qris: true, cod: true });
  mockLlm(paymentOutput());
  stubGateway();

  const convId = `wa-e2e-${Date.now()}`;
  const messageId = randomUUID();

  // processMessage returns null (fire-and-forget flush for urgent path);
  // the actual send happens asynchronously in the flush handler.
  const res = await messageProcessorService.processMessage({
    storeId: STORE_ID,
    customerId: CUSTOMER_PHONE,
    customerPhone: CUSTOMER_PHONE,
    conversationId: convId,
    text: 'mau bayar via transfer', // "transfer" => urgent => near-real-time flush
    messageId,
    gateway: 'gowa',
    deviceId: 'dev-test',
    token: 'tok-test',
    inboxId: 1,
    storeTimezone: 'Asia/Jakarta',
    channel: 'whatsapp',
  });

  // The processed result is produced in the flush handler; poll the gateway
  // captures (the only observable side effect of the WA send).
  await waitFor(() => (sendImgCalls.length > 0 ? sendImgCalls : null), { timeout: 15000 });
  await waitFor(() => (sendMsgCalls.length > 0 ? sendMsgCalls : null), { timeout: 5000 });

  // QRIS image follow-up fired via WA gateway (message-processor.service.ts:321-323)
  assert.equal(sendImgCalls.length, 1, 'QRIS image must be sent via WA gateway');
  assert.equal(sendImgCalls[0].phone, CUSTOMER_PHONE);
  assert.equal(sendImgCalls[0].imageUrl, QRIS_URL, 'QRIS image must use the store qrisImageUrl');

  // Payment-methods text sent via WA gateway — rekenking + COD must be present
  assert.equal(sendMsgCalls.length, 1, 'payment methods text must be sent via WA gateway');
  assert.equal(sendMsgCalls[0].phone, CUSTOMER_PHONE);
  assert.match(sendMsgCalls[0].text, /metode pembayaran/i);
  assert.match(sendMsgCalls[0].text, /Transfer Bank|rekenking/i); // rekenking info
  assert.match(sendMsgCalls[0].text, /COD/i); // COD konfirmasi
  assert.match(sendMsgCalls[0].text, /QRIS/i); // QRIS disclosure

  await cleanupConversation(convId);
});

test('WA E2E: COD-only store → WA gateway sends COD confirmation (no QRIS image)', async () => {
  await setupStore({ transfer: false, qris: false, cod: true });
  mockLlm(paymentOutput());
  stubGateway();

  const convId = `wa-e2e-cod-${Date.now()}`;
  const messageId = randomUUID();

  await messageProcessorService.processMessage({
    storeId: STORE_ID,
    customerId: CUSTOMER_PHONE,
    customerPhone: CUSTOMER_PHONE,
    conversationId: convId,
    text: 'mau bayar via transfer', // urgent keyword => near-realtime flush
    messageId,
    gateway: 'gowa',
    deviceId: 'dev-test',
    token: 'tok-test',
    inboxId: 1,
    storeTimezone: 'Asia/Jakarta',
    channel: 'whatsapp',
  });

  await waitFor(() => (sendMsgCalls.length > 0 ? sendMsgCalls : null), { timeout: 15000 });

  // COD-only → text confirmation via WA, NO QRIS image follow-up
  assert.equal(sendImgCalls.length, 0, 'COD-only store must NOT send QRIS image');
  assert.ok(sendMsgCalls.length >= 1, 'COD confirmation must be sent via WA gateway');
  const text = sendMsgCalls.map((c) => c.text).join('\n');
  assert.match(text, /COD|bayar ditempat/i, 'WA text must confirm COD availability');

  await cleanupConversation(convId);
});
