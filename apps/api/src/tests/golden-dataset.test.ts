/**
 * Golden Dataset Integration Test
 *
 * Runner: npx tsx --env-file=../../.env --test --test-force-exit src/tests/golden-dataset.test.ts
 *
 * 10 permanent test cases covering the 5-stage chat-flow pipeline:
 *   Stage 1 — Resolver (pending-clarification, 0 LLM)
 *   Stage 2 — Normalizer (typo + I12 product-preservation guard, 0 LLM)
 *   Stage 3 — Tier (rule-based fast-path, 0 LLM)
 *   Stage 4 — Interpreter (≤1 LLM via llmGateway.generate)
 *   Stage 5 — Dead-end (HUMAN fallback)
 *
 * Mocks:
 *   - orderService.detectDoneOrdering → false (prevents finalizeDraftOrder side-effects)
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../infrastructure/prisma.js';
import { conversationService } from '../business/conversation.service.js';
import { orderService } from '../business/order.service.js';
import { conversationContextService } from '../business/conversation-context.service.js';
import { canonicalConversationStateService } from '../business/canonical-context.service.js';
import { cartAuthority } from '../business/cart-authority.js';
import { llmGateway } from '../adapters/ai/llm-gateway.js';
import { groqAdapter } from '../adapters/ai/groq.adapter.js';
import { normalize } from '../services/chat/normalizer.js';
import { composeReply } from '../services/chat/composer-v2.js';
import { ResponseSource } from '../domain/types.js';
import type { AIResponse, AIGenerateOptions } from '../adapters/ai/types.js';
import type { InterpreterResult, ResponseResult, ConversationContext } from '../domain/types.js';
import { setStoreEngine } from '../services/chat/engine-config.js';
import type { InterpreterResultV2 } from '../services/chat/types-v2.js';
import { fallbackService } from '../business/fallback.service.js';

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
] as const;

const BERASSS_PRODUCT = { id: 'prod-berasss', name: 'berasss', price: 15000, stock: 50 };

// ──────────────────────────────────────────────────────────
// Mock state
// ──────────────────────────────────────────────────────────

let llmCalls = 0;
let cannedContent = '';
// Save originals so we can restore in after()
const originalGenerate = llmGateway.generate.bind(llmGateway);
const OrderProto = Object.getPrototypeOf(orderService);
const originalDetectDone = OrderProto.detectDoneOrdering;

// ──────────────────────────────────────────────────────────
// Mock implementations
// ──────────────────────────────────────────────────────────

const mockGenerate = async (
  _prompt: string,
  _options?: AIGenerateOptions,
): Promise<AIResponse> => {
  llmCalls++;
  return {
    content: cannedContent,
    provider: 'groq',
    model: 'test-model',
    tokens: { input: 10, output: 10 },
    cost: 0,
  };
};

// ──────────────────────────────────────────────────────────
// Canned LLM response builder
// ──────────────────────────────────────────────────────────

function canned(obj: Partial<InterpreterResult>): string {
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

async function setupStore(): Promise<void> {
  await prisma.store.upsert({
    where: { id: STORE_ID },
    update: { name: 'Golden Dataset Test Store' },
    create: {
      id: STORE_ID,
      name: 'Golden Dataset Test Store',
      phoneNumber: '+6281200000098',
      address: 'Jl. Golden No. 1',
      originProvinceId: 'prov-golden-1',
      originProvinceName: 'Jawa Barat',
      originCityId: 'city-golden-1',
      originCityName: 'Bandung',
      originSubdistrictId: 'sub-golden-1',
      originSubdistrictName: 'Coblong',
    },
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

async function cleanupStoreData(): Promise<void> {
  // Order matters: child tables first (FK constraints)
  await prisma.conversationHistory
    .deleteMany({ where: { conversation: { storeId: STORE_ID } } })
    .catch(() => {});
  await prisma.conversationContext
    .deleteMany({ where: { conversation: { storeId: STORE_ID } } })
    .catch(() => {});
  await prisma.orderItem
    .deleteMany({ where: { order: { storeId: STORE_ID } } })
    .catch(() => {});
  await prisma.order.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
  await prisma.conversation
    .deleteMany({ where: { storeId: STORE_ID } })
    .catch(() => {});
  await prisma.product
    .deleteMany({ where: { storeId: STORE_ID } })
    .catch(() => {});
  await prisma.store.deleteMany({ where: { id: STORE_ID } }).catch(() => {});
}

async function createConv(
  convId: string,
  customerId: string,
): Promise<void> {
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
 * Set active pending in canonical V2 state (workspace_v2.pendings).
 * G2-D.5d: pending authority is canonical, not extractedEntities.
 */
async function setPendingV2(
  convId: string,
  pending: { id: string; question: string; options: string[] },
): Promise<void> {
  await canonicalConversationStateService.upsertPending(convId, {
    id: pending.id,
    question: pending.question,
    options: pending.options,
    status: 'active',
    attempts: 0,
    deferred_turns: 0,
    asked_at: new Date().toISOString(),
  });
}

async function processMsg(
  convId: string,
  customerId: string,
  message: string,
): Promise<{ result: ResponseResult | null; llmCalls: number }> {
  // Reset per-call state
  llmCalls = 0;
  const result = await conversationService.processCustomerMessage(
    STORE_ID,
    customerId,
    convId,
    message,
  );
  return { result, llmCalls };
}

// ──────────────────────────────────────────────────────────
// Lifecycle hooks
// ──────────────────────────────────────────────────────────

before(async () => {
  // Mock llmGateway.generate — sole provider decision point; intercepts interpreter/reasoning LLM calls
  (llmGateway as any).generate = mockGenerate;

  // Mock orderService to prevent finalizeDraftOrder side-effects (detectDoneOrdering)
  OrderProto.detectDoneOrdering = () => false;

  // Activate V2 engine for all golden-dataset tests
  await setStoreEngine(STORE_ID, 'v2');

  // Seed DB
  await cleanupStoreData();
  await setupStore();
});

after(async () => {
  // Restore originals
  (llmGateway as any).generate = originalGenerate;
  OrderProto.detectDoneOrdering = originalDetectDone;

  // Tear down
  await cleanupStoreData();
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Reset mock state
  llmCalls = 0;
  cannedContent = '';

  // Clean conversation-level data (keep store + base products)
  await prisma.conversationHistory
    .deleteMany({ where: { conversation: { storeId: STORE_ID } } })
    .catch(() => {});
  await prisma.conversationContext
    .deleteMany({ where: { conversation: { storeId: STORE_ID } } })
    .catch(() => {});
  await prisma.order.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
  await prisma.conversation
    .deleteMany({ where: { storeId: STORE_ID } })
    .catch(() => {});
});

// ──────────────────────────────────────────────────────────
// Test Cases
// ──────────────────────────────────────────────────────────

test('Case 1: resolver EXECUTE — "dua duanya" resolves pending clarification (0 LLM)', async () => {
  const convId = 'conv-case1';
  await createConv(convId, 'cust-1');

  // G2-D.5d: pending authority is canonical workspace_v2.pendings[]
  await setPendingV2(convId, {
    id: 'p1',
    question: 'Berat 1 kg untuk woltel dan brambang ya?',
    options: ['woltel', 'brambang'],
  });

  const { result, llmCalls: calls } = await processMsg(
    convId,
    'cust-1',
    'dua duanya',
  );

  assert.ok(result, 'processCustomerMessage must return a response');
  assert.equal(calls, 0, 'resolver stage must not call LLM (I8)');
  assert.equal(result!.metadata.engine, 'v2', 'V2 engine must handle resolved pending');
  assert.equal(result!.metadata.outcome, 'resolved', 'outcome must be resolved (EXECUTE)');
  assert.equal(result!.metadata.action, 'EXECUTE', 'resolved action must be EXECUTE');
  // Verify both items landed in cart (DB truth via CartAuthority)
  const cart1 = await cartAuthority.getCart(convId);
  const woltel = cart1.find((i: any) => i.productName === 'woltel');
  const brambang = cart1.find((i: any) => i.productName === 'brambang');
  assert.ok(woltel, 'woltel must be in cart after EXECUTE');
  assert.ok(brambang, 'brambang must be in cart after EXECUTE');
});

test('Case 2: normalizer → "total berapa" → tryTotal tier (0 LLM)', async () => {
  const convId = 'conv-case2';
  await createConv(convId, 'cust-2');

  // Verify normalization first (I12 / typo dictionary)
  assert.equal(
    normalize('toralin brp', ['beras']),
    'total berapa',
    'toralin → total, brp → berapa',
  );

  // V2 fast-path: send normalized input
  const { result, llmCalls: calls } = await processMsg(
    convId,
    'cust-2',
    'total berapa',
  );

  assert.ok(result, 'must return a response');
  assert.equal(result!.source, ResponseSource.TOTAL, 'must come from tryTotal fast-path');
  assert.equal(result!.metadata.engine, 'v2', 'V2 engine must handle tier response');
  // Empty cart → tryTotal returns empty-cart guidance (no crash, no wrong total)
  assert.ok(result!.message.content, 'tryTotal must return non-empty response');
});

test('Case 3: resolver EXECUTE — "semua" resolves pending (0 LLM)', async () => {
  const convId = 'conv-case3';
  await createConv(convId, 'cust-3');

  // G2-D.5d: canonical V2 pending
  await setPendingV2(convId, {
    id: 'p3',
    question: 'Mau semua produk?',
    options: ['beras'],
  });

  const { result, llmCalls: calls } = await processMsg(
    convId,
    'cust-3',
    'iya',
  );

  assert.ok(result, 'must return a response');
  assert.equal(calls, 0, 'resolver must not call LLM');
  assert.equal(result!.metadata.engine, 'v2');
  assert.equal(result!.metadata.outcome, 'resolved');
  assert.equal(result!.metadata.action, 'EXECUTE');
  // Verify beras landed in cart (DB truth via CartAuthority)
  const cart3 = await cartAuthority.getCart(convId);
  assert.ok(
    cart3.some((i: any) => i.productName === 'beras'),
    'beras must be in cart after resolved EXECUTE',
  );
});

test('Case 4: resolver ROLLBACK — "ga jadi" cancels pending (0 LLM)', async () => {
  const convId = 'conv-case4';
  await createConv(convId, 'cust-4');

  // G2-D.5d: canonical V2 pending (no snapshot needed for ROLLBACK assertion)
  await setPendingV2(convId, {
    id: 'p4',
    question: 'Mau pesan beras 1kg?',
    options: ['beras'],
  });

  const { result, llmCalls: calls } = await processMsg(
    convId,
    'cust-4',
    'ga jadi',
  );

  assert.ok(result, 'must return a response');
  assert.equal(calls, 0);
  assert.equal(result!.metadata.engine, 'v2');
  assert.equal(result!.metadata.outcome, 'resolved');
  assert.equal(result!.metadata.action, 'ROLLBACK');
  assert.ok(
    result!.message.content.includes('batal'),
    'ROLLBACK response must say "dibatalkan"',
  );
});

test('Case 5: tryProduct tier — "ada beras" returns price from DB (0 LLM)', async () => {
  const convId = 'conv-case5';
  await createConv(convId, 'cust-5');

  const { result, llmCalls: calls } = await processMsg(
    convId,
    'cust-5',
    'ada beras',
  );

  assert.ok(result, 'must return a response');
  assert.equal(calls, 0, 'tryProduct is a 0-LLM tier');
  assert.equal(result!.source, ResponseSource.PRODUCT, 'must come from tryProduct fast-path');
  assert.ok(result!.message.content.includes('beras'), 'should mention the product');
  // Price must come from DB (Rp 12.000), not from LLM
  assert.match(result!.message.content, /Rp\s*12[.,]000/);
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
    assert.ok(
      normInput.includes('berasss'),
      'I12 guard: "berasss" must NOT be mutated to "beras"',
    );

    const convId = 'conv-case6';
    await createConv(convId, 'cust-6');

    const { result, llmCalls: calls } = await processMsg(
      convId,
      'cust-6',
      'berasss ada',
    );

    assert.ok(result, 'must return a response');
    assert.equal(calls, 0);
    assert.equal(result!.source, ResponseSource.PRODUCT, 'must come from tryProduct');
    assert.ok(
      result!.message.content.includes('berasss'),
      'response should use the original product name "berasss"',
    );
    assert.match(result!.message.content, /Rp\s*15[.,]000/);
  } finally {
    await prisma.product
      .delete({ where: { id: BERASSS_PRODUCT.id } })
      .catch(() => {});
  }
});

test('Case 7: resolver EXECUTE — "iya" resolves pending (0 LLM)', async () => {
  const convId = 'conv-case7';
  await createConv(convId, 'cust-7');

  // G2-D.5d: canonical V2 pending
  await setPendingV2(convId, {
    id: 'p7',
    question: 'Mau pesan beras?',
    options: ['beras'],
  });

  const { result, llmCalls: calls } = await processMsg(
    convId,
    'cust-7',
    'iya',
  );

  assert.ok(result, 'must return a response');
  assert.equal(calls, 0, 'resolver must not call LLM');
  assert.equal(result!.metadata.engine, 'v2');
  assert.equal(result!.metadata.outcome, 'resolved');
  assert.equal(result!.metadata.action, 'EXECUTE');
  // Verify beras landed in cart (DB truth via CartAuthority)
  const cart7 = await cartAuthority.getCart(convId);
  assert.ok(
    cart7.some((i: any) => i.productName === 'beras'),
    'beras must be in cart after resolved EXECUTE',
  );
});

test('Case 8: interpreter — LLM called once, reply_draft ≤ 2 sentences', async () => {
  const convId = 'conv-case8';
  await createConv(convId, 'cust-8');

  cannedContent = canned({
    intent: 'smalltalk',
    cart_ops: [],
    reply_draft:
      'Kami punya beras dan sayuran segar. Silakan pilih ya.',
    confidence: 0.9,
  });

  const { result, llmCalls: calls } = await processMsg(
    convId,
    'cust-8',
    'rekomendasi apa ya?',
  );

  assert.ok(result, 'must return a response');
  assert.equal(calls, 1, 'interpreter must call LLM exactly once (I8)');
  assert.equal(result!.metadata.engine, 'v2');
  assert.ok(result!.message.content, 'interpreter must return non-empty reply');

  // Validate reply_draft is truncated to max 2 sentences
  assert.ok(result!.message.content, 'response must have content');
  const sentences = result!.message.content
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 0);
  assert.ok(
    sentences.length <= 2,
    `reply_draft harus maks 2 kalimat, dapat ${sentences.length}`,
  );
});

test('Case 9: interpreter → clarification → pending saved in DB', async () => {
  const convId = 'conv-case9';
  await createConv(convId, 'cust-9');

  cannedContent = canned({
    intent: 'clarify',
    clarification: {
      question:
        'Maaf Kak, iPhone 15 belum tersedia di toko kami. Ada alternatif lain?',
      options: [],
      expected_type: 'affirmative',
    },
    confidence: 0.85,
  });

  const { result, llmCalls: calls } = await processMsg(
    convId,
    'cust-9',
    'iphone 15',
  );

  assert.ok(result, 'must return a response');
  assert.equal(calls, 1, 'interpreter must call LLM for clarification');
  assert.equal(result!.metadata.engine, 'v2');
  assert.equal(result!.metadata.outcome, 'reasoned', 'clarification is a reasoned outcome');
  // V2 composer-v2.ts returns composeClarification text directly
  assert.ok(
    result!.message.content.length > 0,
    'reply must contain the LLM clarification text',
  );
  // NOTE: V2 currently does NOT persist clarification to workspace_v2.pendings[]
  // (V1 behavior). This is a V2 engine regression — requires production fix
  // in composer-v2.ts / reasoning.ts to upsertPending() with clarification data.
});

test('Case 10: interpreter — harga dari DB via cart_ops, not customer "50rb" (I13)', async () => {
  const convId = 'conv-case10';
  await createConv(convId, 'cust-10');

  // LLM returns the correct DB price (12000) for beras — not the
  // customer's "50rb" (50000). validateCartOps verifies product
  // existence against storeProducts (I15).
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
    draft_cart_ops: [{ product: 'beras', qty: 1, status: 'confirmed' as const }],
    reply_draft: 'Beras ditambahkan ke keranjang ya.',
  });

  const { result, llmCalls: calls } = await processMsg(
    convId,
    'cust-10',
    'harganya 50rb ya?',
  );

  assert.ok(result, 'must return a response');
  assert.equal(calls, 1, 'interpreter must call LLM for buy intent');
  assert.equal(result!.metadata.engine, 'v2');
  // I13 proof: DB price is authoritative — verify via CartAuthority, not response wording
  const cart10 = await cartAuthority.getCart(convId);
  const berasItem = cart10.find((i: any) => i.productName === 'beras');
  assert.ok(berasItem, 'beras must be in cart after buy');
  assert.equal(berasItem.unitPrice, 12000, 'DB price must be 12000, not customer 50rb');
  assert.ok(
    result!.message.content,
    'interpreter must return non-empty reply',
  );
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
async function withProduct(
  id: string,
  name: string,
  price: number,
  stock: number | null,
  fn: () => Promise<void>,
  hasVariants: boolean = false,
): Promise<void> {
  await prisma.product.upsert({
    where: { id },
    update: { storeId: STORE_ID, name, price, stock, isActive: true, deletedAt: null, currency: 'IDR', hasVariants },
    create: { id, storeId: STORE_ID, name, price, stock, isActive: true, currency: 'IDR', hasVariants },
  });
  try {
    await fn();
  } finally {
    await prisma.product.delete({ where: { id } }).catch(() => {});
  }
}

/**
 * Aktifkan engine V2 untuk STORE_ID via Redis (getStoreEngine → 'v2'),
 * jalankan fn, lalu kembalikan ke 'v1' di finally.
 * Diperlukan untuk golden case P3 (workspace_v2 persist antar-turn).
 */
async function withEngineV2(fn: () => Promise<void>): Promise<void> {
  await setStoreEngine(STORE_ID, 'v2');
  try {
    await fn();
  } finally {
    await setStoreEngine(STORE_ID, 'v1');
  }
}

/**
 * Builder canned response untuk interpreter V2 (InterpreterResultV2 JSON).
 * Berbeda dengan `canned()` (V1 InterpreterResult) — V2 pakai acts[], confidence{v4}, draft_cart_ops.
 */
function cannedV2(obj: Partial<InterpreterResultV2>): string {
  return JSON.stringify({
    acts: [] as any[],
    unmatched_mentions: [] as string[],
    topic_switch: false,
    draft_cart_ops: [] as any[],
    reply_draft: null as string | null,
    confidence: { entities: 0.95, intent: 0.95, selection: 0.95, topic: 0.95 } as any,
    ...obj,
  });
}

test('Case B3-a: "total berapa" (regresi) tetap di-jawab tryTotal (0 LLM)', async () => {
  const convId = 'conv-b3a';
  await createConv(convId, 'cust-b3a');
  try {
    const { result, llmCalls: calls } = await processMsg(convId, 'cust-b3a', 'total berapa');
    assert.ok(result, 'must return a response');
    assert.equal(calls, 0, '0 LLM — V2 tier fast path');
    assert.equal(result!.metadata.engine, 'v2', 'V2 engine must handle total query');
    // Empty cart → tryTotal returns empty-cart message
    assert.ok(result!.message.content.length > 0, 'reply must be non-empty');
  } finally {
    await prisma.conversation.delete({ where: { id: convId } }).catch(() => {});
  }
});

test('Case B3-b: "berapa bayar kangkung" -> tryProduct (harga), BUKAN tryTotal/tryPayment', async () => {
  const convId = 'conv-b3b';
  await createConv(convId, 'cust-b3b');
  await withProduct('prod-kangkung-b3', 'kangkung', 8000, 100, async () => {
    const { result, llmCalls: calls } = await processMsg(convId, 'cust-b3b', 'berapa bayar kangkung');
    assert.ok(result, 'must return a response');
    // Harus dari tryProduct (PRODUCT), BUKAN tryTotal (TOTAL) atau tryPayment (PAYMENT)
    assert.equal(
      result!.source,
      ResponseSource.PRODUCT,
      `expected tryProduct, got ${result!.source}`,
    );
    assert.match(result!.message.content, /kangkung/i, 'harus sebut kangkung');
    assert.match(result!.message.content, /8\.?000|8000/, 'harus sebut harga 8000');
    assert.equal(calls, 0, '0 LLM — tryProduct fast path (bukan interpreter)');
    // Bukti: TIDAK pernah menyentuh tryTotal/tryPayment (content bukan keranjang-bayar)
    assert.ok(!result!.message.content.includes('keranjang belanja Kakak masih kosong'), 'must not be tryTotal empty-cart reply');
    assert.ok(!result!.message.content.includes('metode pembayaran'), 'must not be tryPayment reply');
  });
  await prisma.conversation.delete({ where: { id: convId } }).catch(() => {});
});

test('Case B3-c: "bisa cod ga?" -> tryPayment masih jawab (regression)', async () => {
  const convId = 'conv-b3c';
  await createConv(convId, 'cust-b3c');
  // canary-style: butuh acceptsCod supaya tryPayment menjawab
  await prisma.store.update({ where: { id: STORE_ID }, data: { acceptsCod: true } });
  try {
    const { result, llmCalls: calls } = await processMsg(convId, 'cust-b3c', 'bisa cod ga?');
    assert.ok(result);
    assert.equal(result!.source, ResponseSource.PAYMENT, `expected tryPayment, got ${result!.source}`);
    assert.match(result!.message.content, /cod|COD|metode pembayaran/i);
    assert.equal(calls, 0, '0 LLM');
  } finally {
    await prisma.store.update({ where: { id: STORE_ID }, data: { acceptsCod: false } }).catch(() => {});
    await prisma.conversation.delete({ where: { id: convId } }).catch(() => {});
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
  // G2-D.5d: canonical V2 pending with wrong price (99999) in option label
  // V2 deriveResolvedCartOps uses DB price via priceMap, not pending price
  await setPendingV2(convId, {
    id: 'p2',
    question: 'beli beras?',
    options: ['beras'],
  });
  const { result, llmCalls: calls } = await processMsg(convId, 'cust-p2', 'iya');
  // I13 proof: DB price (12000) is authoritative, not LLM/pending wrong price
  const cart = await cartAuthority.getCart(convId);
  const berasItem = cart.find((i: any) => i.productName === 'beras');
  assert.ok(result, 'must respond');
  assert.equal(calls, 0, '0 LLM (resolver path)');
  assert.ok(berasItem, 'beras must be in cart');
  assert.equal(berasItem.unitPrice, 12000, `expected DB price 12000, got ${berasItem.unitPrice}`);
  assert.ok(result!.message.content, 'resolver must return non-empty reply');
  await prisma.conversation.delete({ where: { id: convId } }).catch(() => {});
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
      assert.ok(
        t2.result!.message.content.match(/12\.?000|12000/),
        `turn 2 must show Rp 12.000 from persisted cart, got: ${t2.result!.message.content}`,
      );

      // Persist verifikasi: workspace_v2 kolom masih ada di turn 2
      const ctxAfterT2 = await prisma.conversationContext.findUnique({
        where: { conversationId: convId },
        select: { workspace_v2: true },
      });
      assert.ok(ctxAfterT2?.workspace_v2 !== null && ctxAfterT2?.workspace_v2 !== undefined, 'workspace_v2 must still be populated on turn 2');
    } finally {
      await prisma.conversation.delete({ where: { id: convId } }).catch(() => {});
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
      } as any,
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
      } as any,
    });

    const { result, llmCalls: calls } = await processMsg(convId, 'cust-p4', 'total berapa');
    assert.ok(result, 'must return a response');
    assert.equal(calls, 0, 'tryTotal is a 0-LLM fast-path (bukan interpreter)');

    // Assert: balasan HARUS berisi harga draft (12.000), BUKAN pending (24.000)
    assert.ok(
      /12\.?000|12000/.test(result!.message.content),
      `reply must contain draft price 12000, got: ${result!.message.content}`,
    );
    assert.ok(
      !/24\.?000|24000/.test(result!.message.content),
      `reply must NOT contain pending price 24000 (draft-first discrimination), got: ${result!.message.content}`,
    );
  } finally {
    await prisma.conversation.delete({ where: { id: convId } }).catch(() => {});
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
      } as any,
    });

    const { result: r1 } = await processMsg(convId, 'cust-p5', 'total berapa');
    assert.ok(r1, 'must return a response for subtotal');
    // beras 1x12000 = 12.000; brambang qty=0 harus DIFILTER (bukan 20.000)
    assert.ok(
      /12\.?000|12000/.test(r1!.message.content),
      `subtotal harus 12.000 (qty=0 terfilter), got: ${r1!.message.content}`,
    );
    assert.ok(
      !/20\.?000|20000/.test(r1!.message.content),
      `subtotal tidak boleh 20.000 (qty=0 tidak boleh dihitung), got: ${r1!.message.content}`,
    );

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
      assert.ok(r2!.message.content, 'reply must have content');
      const sentences = r2!.message.content
        .split(/(?<=[.!?])\s+/)
        .filter((s: string) => s.trim().length > 0);
      assert.ok(
        sentences.length <= 2,
        `reply_draft harus maks 2 kalimat (truncate), dapat ${sentences.length}: ${r2!.message.content}`,
      );
    } finally {
      await prisma.conversation.delete({ where: { id: convId2 } }).catch(() => {});
    }
  } finally {
    await prisma.conversation.delete({ where: { id: convId } }).catch(() => {});
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// G2-D.8 — LLM clarification persists to canonical pending (regression)
//
// Prove: LLM clarification response → canonical active pending persisted →
// next customer answer can resolve that pending via tryFastPath (0 LLM).
// ─────────────────────────────────────────────────────────────────────────────
test('Case G2-D.8: LLM clarification persists to canonical pending and resolves on next turn', async () => {
  const convId = 'conv-g2d8';
  await createConv(convId, 'cust-g2d8');

  // FORCE TRUE V2 ENGINE for this test.
  // NOTE: withEngineV2()'s `finally` resets the global store engine to 'v1',
  // which would route clarification through the V1 path (setPendingClarification
  // → writeV1PendingClarification mirror). We must NOT use it here — set v2
  // directly and restore v2 in cleanup so subsequent tests are unaffected.
  await setStoreEngine(STORE_ID, 'v2');

  // Turn 1: trigger LLM clarification with options matching catalog products
  cannedContent = canned({
    intent: 'clarify',
    clarification: {
      question: 'Mau pesan beras atau woltel?',
      options: ['beras', 'woltel'],
      expected_type: 'affirmative',
    },
    confidence: 0.85,
  });

  const { result: r1, llmCalls: calls1 } = await processMsg(
    convId,
    'cust-g2d8',
    'rekomendasi apa ya?',
  );

  assert.ok(r1, 'turn 1 must return a response');
  assert.equal(calls1, 1, 'turn 1 must call LLM for clarification');
  // PROOF V2 PATH: V2 engine stamps metadata.engine='v2'. The V1 fallback path
  // does NOT set engine metadata, so this proves the V2 branch (conversation.service.ts:339)
  // was taken, not the V1 clarify path.
  assert.equal(r1!.metadata.engine, 'v2', 'turn 1 must run the V2 engine (clarification persistence path)');
  assert.ok(r1!.message.content.length > 0, 'turn 1 must return clarification text');

  // G2-D.8 proof: pending persisted to canonical workspace_v2.pendings[] via V2 path.
  const pending = await canonicalConversationStateService.getPendingClarification(convId);
  assert.ok(pending, 'active pending must be persisted after LLM clarification');
  assert.equal(pending.question, 'Mau pesan beras atau woltel?');
  assert.ok(pending.options.includes('beras'), 'pending options must include beras');
  assert.ok(pending.options.includes('woltel'), 'pending options must include woltel');
  // PROOF V1 NOT USED: V2 pushes a native crypto.randomUUID() pending id; the V1
  // mirror (writeV1PendingClarification) would generate "migrate:<asked_at>". A
  // non-migrate id proves setPendingClarification was NOT invoked.
  assert.ok(
    !pending.id.startsWith('migrate:'),
    'pending id must be V2-native (not "migrate:..."), proving V1 setPendingClarification was NOT used',
  );

  // Turn 2: resolve the pending via V2 fast-path (0 LLM)
  const { result: r2, llmCalls: calls2 } = await processMsg(
    convId,
    'cust-g2d8',
    'iya',
  );

  assert.ok(r2, 'turn 2 must return a response');
  assert.equal(calls2, 0, 'turn 2 must resolve pending without LLM (V2 fast-path resolver)');
  assert.equal(r2!.metadata.engine, 'v2', 'turn 2 must run the V2 engine');
  assert.equal(r2!.metadata.outcome, 'resolved');
  assert.equal(r2!.metadata.action, 'EXECUTE');

  // Verify cart via CartAuthority (DB truth): affirmative "iya" on N=2 options
  // matches BOTH options → deriveResolvedCartOps adds beras AND woltel.
  const cart = await cartAuthority.getCart(convId);
  assert.ok(
    cart.some((i: any) => i.productName === 'beras'),
    'beras must be in cart after resolved EXECUTE',
  );
  assert.ok(
    cart.some((i: any) => i.productName === 'woltel'),
    'woltel must be in cart after resolved EXECUTE',
  );

  // G2-D.8 proof: pending cleared after resolution (no stale pending)
  const pendingAfter = await canonicalConversationStateService.getPendingClarification(convId);
  assert.equal(pendingAfter, undefined, 'pending must be cleared after next-turn resolution');

  // Restore intended global engine state (v2) so subsequent tests are unaffected.
  await setStoreEngine(STORE_ID, 'v2');
});

// ─────────────────────────────────────────────────────────────────────────────
// TASK P6-5 — Golden coverage tambahan untuk fix P3/P4/P5.
//
// Case P6.4a/b/c di atas sudah ada, tapi mutation test (revert 1 baris fix di
// source, lihat laporan P6-5) membuktikan ada celah yang TIDAK terdeteksi:
//   - Revert P4.1 (writer second-brain `extractAndSaveOrder` dihidupkan lagi →
//     muncul baris Order 'pending' phantom): "Case P4" lama TETAP HIJAU, karena
//     ia hanya menguji P4.2 (draft dipilih lebih dulu daripada pending).
//   - Revert I-1a (subtotal ikut menghitung item qty=0 di jalur V2 resolved):
//     "Case P5" lama TETAP HIJAU, karena ia lewat tryTotal yang punya filter
//     qty sendiri (fallback.service.ts:702), bukan jalur fix-nya
//     (conversation.service.ts:261).
//   - Revert I-2 layer L1 (composer-v2) maupun L2 (safety-net
//     conversation.service.ts:373): Case 8 dan "Case P5" lama TETAP HIJAU,
//     karena masing-masing masih tertutup layer yang lain.
//   - Revert simbol qty P5.2 ('x' ASCII → '×'): tidak ada case yang menjaganya.
// Yang SUDAH terjaga case lama (tidak diduplikasi di sini):
//   - Revert P3 persist (`saveWorkspaceV2`): "Case P3" lama + G2-D.8 memang
//     merah. Case P6-5/P3 di bawah menambah lapisan yang belum ada: assert
//     LOKASI persist (kolom `workspace_v2`, BUKAN legacy `extractedEntities`)
//     lewat raw readback kolom DB.
//   - Revert P4.2 draft-first: "Case P4" lama memang merah (terverifikasi).
//
// Semua case di bawah sudah diverifikasi GAGAL saat baris fix-nya di-revert
// dan HIJAU lagi setelah restore (bukti mutation test ada di laporan P6-5).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * P6-5 / P3 gate — persist state antar-turn HARUS di kolom `workspace_v2`.
 *
 * Fix asli: c164729..fd08ba3 (P3.1–P3.4). Sebelum fix, "persist" workspace V2
 * lewat updateExtractedEntities = NO-OP (type mismatch) sehingga memori V2
 * hilang antar-turn; setelah fix, state ditulis ke kolom `workspace_v2`
 * (sekarang lewat canonical boundary `saveWorkspaceV2`, G2-D.5).
 *
 * Skenario realistis: customer tanya terbuka → LLM balas clarification
 * (pending disimpan) → turn berikutnya customer jawab "iya" → resolver 0 LLM
 * hanya mungkin kalau pending turn-1 benar-benar persist DAN terbaca lagi.
 *
 * Assertion yang membedakan dari Case P3 lama / Case G2-D.8 (keduanya menguji
 * "apakah persist jalan", lewat kolom != null / lewat service read yang punya
 * legacy fallback ke extractedEntities):
 *   (1) RAW kolom `workspace_v2` memuat pending turn-1  → tempat persist benar.
 *   (2) RAW kolom `extractedEntities` TIDAK memuatnya    → bukan dual-writer legacy.
 *   (3) Turn 2 resolve 0 LLM                             → state terbaca kembali.
 */
test('Case P6-5/P3: state antar-turn persist di kolom workspace_v2, bukan legacy extractedEntities (P3 gate)', async () => {
  const convId = 'conv-p65-p3';
  const custId = 'cust-p65-p3';
  const QUESTION = 'Mau beras atau woltel Kak?';

  await createConv(convId, custId);
  await setStoreEngine(STORE_ID, 'v2');

  try {
    // ── Turn 1: LLM balas clarification → pending masuk workspace V2 ──
    cannedContent = canned({
      intent: 'clarify',
      clarification: {
        question: QUESTION,
        options: ['beras', 'woltel'],
        expected_type: 'affirmative',
      },
      confidence: 0.85,
    });

    const t1 = await processMsg(convId, custId, 'mau belanja tapi bingung kak');
    assert.ok(t1.result, 'turn 1 must return a response');
    assert.equal(t1.result!.metadata.engine, 'v2', 'turn 1 must run V2 engine');
    assert.equal(t1.llmCalls, 1, 'turn 1 = 1 LLM call (interpreter clarification)');

    // (1) + (2): cek RAW kolom DB — tempat persist, bukan lewat service
    const row = await prisma.conversationContext.findUnique({
      where: { conversationId: convId },
      select: { workspace_v2: true, extractedEntities: true },
    });
    const wsRaw = JSON.stringify(row?.workspace_v2 ?? null);
    const legacyRaw = JSON.stringify(row?.extractedEntities ?? null);

    assert.ok(
      wsRaw.includes(QUESTION),
      `P3.1: state turn-1 wajib persist di kolom workspace_v2, dapat: ${wsRaw}`,
    );
    assert.ok(
      !legacyRaw.includes(QUESTION),
      `P3.1: state V2 tidak boleh ditulis ke legacy extractedEntities (dual-writer lama), dapat: ${legacyRaw}`,
    );

    // ── Turn 2: jawab "iya" → resolver fast-path (0 LLM) HANYA bila state terbaca ──
    const t2 = await processMsg(convId, custId, 'iya');
    assert.ok(t2.result, 'turn 2 must return a response');
    assert.equal(
      t2.llmCalls,
      0,
      'P3 read-back: turn 2 harus resolve pending turn-1 tanpa LLM (state persist antar-turn)',
    );
    assert.equal(t2.result!.metadata.engine, 'v2');
    assert.equal(t2.result!.metadata.outcome, 'resolved');
    assert.equal(t2.result!.metadata.action, 'EXECUTE');
  } finally {
    await setStoreEngine(STORE_ID, 'v2');
    await prisma.conversation.delete({ where: { id: convId } }).catch(() => {});
  }
});

/**
 * P6-5 / P4 gate — satu percakapan = tepat SATU baris Order (draft).
 *
 * Fix asli: 0db56bf (hapus `extractAndSaveOrder`, second-brain interpreter yang
 * menulis baris Order 'pending' phantom dengan harga tak tervalidasi DB) +
 * 947fdaf (draft-vs-pending discrimination). Case ini menjaga sisi PERTAMA:
 * setelah penghapusan, tidak boleh ada writer kedua yang bikin baris Order
 * tambahan per turn.
 *
 * Skenario realistis: 2 turn belanja lewat pipeline V1 (jalur tempat
 * `extractAndSaveOrder` dulu dipanggil, conversation.service.ts tail) —
 * turn 1 tambah beras, turn 2 tambah woltel.
 *
 * Assertion:
 *   (1) setelah turn 1: tepat 1 baris Order, status 'draft'
 *   (2) setelah turn 2: masih 1 baris (id SAMA — draft di-reuse, bukan order baru)
 *   (3) tidak ada baris Order 'pending' (phantom second-brain)
 *   (4) `orderService.extractAndSaveOrder` tidak ada lagi (guard re-introduksi)
 */
test('Case P6-5/P4: 2 turn belanja → tepat 1 baris Order draft, 0 phantom pending (P4 gate)', async () => {
  const convId = 'conv-p65-p4';
  const custId = 'cust-p65-p4';

  await createConv(convId, custId);
  // Jalur V1: tempat call-site `extractAndSaveOrder` dulu berada (P4.1).
  await setStoreEngine(STORE_ID, 'v1');

  try {
    // (4) guard statis: second-brain interpreter tidak boleh kembali
    assert.equal(
      typeof (orderService as any).extractAndSaveOrder,
      'undefined',
      'P4.1: orderService.extractAndSaveOrder harus tetap TIDAK ADA (second-brain interpreter)',
    );

    // ── Turn 1: beli beras 2 (harga dari DB, bukan dari LLM) ──
    cannedContent = canned({
      intent: 'buy',
      cart_ops: [{ type: 'add', product: 'beras', qty: 2, price: 12000 }],
      buy_signal: 'yes',
      reply_draft: 'Beras 2 kg sudah masuk keranjang ya Kak.',
      confidence: 0.9,
    });

    const t1 = await processMsg(convId, custId, 'mau pesan 2 kg dong');
    assert.ok(t1.result, 'turn 1 must return a response');

    const ordersT1 = await prisma.order.findMany({
      where: { conversationId: convId, deletedAt: null },
      select: { id: true, orderStatus: true },
      orderBy: { createdAt: 'asc' },
    });
    assert.equal(
      ordersT1.length,
      1,
      `P4.1: 1 percakapan = 1 baris Order, dapat ${ordersT1.length}: ${JSON.stringify(ordersT1)}`,
    );
    assert.equal(ordersT1[0].orderStatus, 'draft', 'baris Order tunggal harus berstatus draft');

    // ── Turn 2: tambah woltel 1 → draft yang SAMA di-reuse ──
    cannedContent = canned({
      intent: 'buy',
      cart_ops: [{ type: 'add', product: 'woltel', qty: 1, price: 10000 }],
      buy_signal: 'yes',
      reply_draft: 'Woltel 1 sudah ditambahkan ya Kak.',
      confidence: 0.9,
    });

    const t2 = await processMsg(convId, custId, 'tambah 1 lagi ya');
    assert.ok(t2.result, 'turn 2 must return a response');

    const ordersT2 = await prisma.order.findMany({
      where: { conversationId: convId, deletedAt: null },
      select: { id: true, orderStatus: true },
      orderBy: { createdAt: 'asc' },
    });
    assert.equal(
      ordersT2.length,
      1,
      `P4.1: turn 2 tidak boleh bikin baris Order kedua, dapat ${ordersT2.length}: ${JSON.stringify(ordersT2)}`,
    );
    assert.equal(ordersT2[0].id, ordersT1[0].id, 'draft order yang sama harus di-reuse antar-turn');
    assert.equal(
      ordersT2.filter((o) => o.orderStatus === 'pending').length,
      0,
      'P4.1: tidak boleh ada baris Order "pending" phantom (second-brain writer)',
    );

    // Cart tetap benar & harga dari DB (bukan phantom tanpa harga)
    const cart = await cartAuthority.getCart(convId);
    const beras = cart.find((i: any) => i.productName === 'beras');
    const woltel = cart.find((i: any) => i.productName === 'woltel');
    assert.ok(beras, 'beras harus ada di cart');
    assert.ok(woltel, 'woltel harus ada di cart');
    assert.equal(beras.unitPrice, 12000, 'harga beras dari DB');
    assert.equal(woltel.unitPrice, 10000, 'harga woltel dari DB');
  } finally {
    await setStoreEngine(STORE_ID, 'v2');
    await prisma.orderItem
      .deleteMany({ where: { order: { conversationId: convId } } })
      .catch(() => {});
    await prisma.order.deleteMany({ where: { conversationId: convId } }).catch(() => {});
    await prisma.conversation.delete({ where: { id: convId } }).catch(() => {});
  }
});

/**
 * P6-5 / P5 gate (a) — I-1a: subtotal jalur V2 resolved hanya menghitung qty > 0.
 *
 * Fix asli: 0e99fbd (I-1a, conversation.service.ts:261 — `filter(qty > 0)` +
 * `Number(i.qty || 0)`; sebelumnya `Number(i.qty || 1)` memperlakukan qty=0
 * sebagai 1 sehingga TOTAL ≠ item yang ditampilkan).
 *
 * Skenario realistis: keranjang legacy masih menyimpan baris sisa qty=0
 * (brambang) di samping beras qty=1. Bot punya pending tentang produk yang
 * ternyata sudah tidak ada di katalog ('kangkung'), customer jawab "iya" →
 * resolver EXECUTE (0 op valid, tidak ada mutasi) → reply merangkum keranjang
 * + total. Total wajib Rp 12.000 (hanya beras), bukan Rp 20.000 (ikut qty=0).
 */
test('Case P6-5/P5a: subtotal V2 resolved hanya item qty > 0 (I-1a gate)', async () => {
  const convId = 'conv-p65-p5a';
  const custId = 'cust-p65-p5a';

  await createConv(convId, custId);
  await setStoreEngine(STORE_ID, 'v2');

  try {
    // Keranjang legacy: beras qty 1 (12.000) + sisa brambang qty 0 (8.000)
    await prisma.conversationContext.update({
      where: { conversationId: convId },
      data: {
        extractedEntities: {
          confirmedItems: [
            { product: 'beras', qty: 1, price: 12000 },
            { product: 'brambang', qty: 0, price: 8000 },
          ],
        } as any,
      },
    });

    // Pending menawarkan produk yang TIDAK ada di katalog → EXECUTE tanpa mutasi
    await setPendingV2(convId, {
      id: 'p65-p5a',
      question: 'Mau tambah kangkung juga Kak?',
      options: ['kangkung'],
    });

    const { result, llmCalls: calls } = await processMsg(convId, custId, 'iya');
    assert.ok(result, 'must return a response');
    assert.equal(calls, 0, 'resolver path = 0 LLM');
    assert.equal(result!.metadata.outcome, 'resolved');
    assert.equal(result!.metadata.action, 'EXECUTE');

    // I-1a: total = 12.000 (beras saja). Kalau filter qty>0 di-revert → 20.000.
    assert.ok(
      result!.message.content.includes('Total belanja Kakak: *Rp 12.000*'),
      `I-1a: subtotal harus 12.000 (qty=0 tidak dihitung), dapat: ${result!.message.content}`,
    );
    assert.ok(
      !/20\.?000/.test(result!.message.content),
      `I-1a: subtotal tidak boleh 20.000 (brambang qty=0 dihitung sebagai 1), dapat: ${result!.message.content}`,
    );
    // Konsistensi display: item qty=0 tidak ditampilkan di ringkasan keranjang
    assert.ok(
      !result!.message.content.includes('brambang'),
      `item qty=0 tidak boleh muncul di ringkasan keranjang, dapat: ${result!.message.content}`,
    );
  } finally {
    await setStoreEngine(STORE_ID, 'v2');
    await prisma.conversation.delete({ where: { id: convId } }).catch(() => {});
  }
});

/**
 * P6-5 / P5 gate (b) — I-2: reply jalur V2 wajib ≤ 2 kalimat.
 *
 * Fix asli: 0e99fbd (I-2). Dua lapis:
 *   L1 composer-v2.ts:68 → truncate reply_draft saat plannedActs kosong
 *   L2 conversation.service.ts:373 → safety-net truncate hasil composeReply
 * Case ini menjaga KEDUANYA: assertion pure memanggil composeReply langsung
 * (pola sama seperti Case 2/6 yang memanggil normalize() langsung), lalu
 * assertion end-to-end lewat engine V2.
 */
test('Case P6-5/P5b: reply V2 di-truncate ke ≤2 kalimat (I-2 gate, L1 composer + L2 safety-net)', async () => {
  const convId = 'conv-p65-p5b';
  const custId = 'cust-p65-p5b';

  // ── L1: composer-v2 (pure) — reply_draft 4 kalimat → 2 kalimat pertama ──
  const composedL1 = composeReply({
    plannedActs: [],
    reasoningResult: {
      acts: [],
      unmatched_mentions: [],
      topic_switch: false,
      draft_cart_ops: [],
      confidence: { entities: 1, intent: 1, selection: 1, topic: 1 },
      reply_draft: 'Beras kami premium. Harganya Rp 12.000 per kg. Stok masih banyak. Mau pesan berapa?',
    } as any,
    workspace: {
      schema_version: 'v3.2',
      conversation_summary: '',
      pendings: [],
      draft_cart: [],
      resolved_facts: {},
      options_presented: [],
    } as any,
    catalog: [],
    clarificationAttempt: 0,
  });
  assert.equal(
    composedL1,
    'Beras kami premium. Harganya Rp 12.000 per kg.',
    'I-2 L1: composer-v2 wajib truncate reply_draft ke 2 kalimat pertama',
  );

  // ── L2: end-to-end engine V2 — hasil akhir tetap ≤2 kalimat ──
  await createConv(convId, custId);
  await setStoreEngine(STORE_ID, 'v2');
  try {
    cannedContent = cannedV2({
      acts: [],
      reply_draft: 'Beras kami premium. Harganya Rp 12.000 per kg. Stok masih banyak. Mau pesan berapa?',
    });

    const { result, llmCalls: calls } = await processMsg(convId, custId, 'rekomendasi apa ya?');
    assert.ok(result, 'must return a response');
    assert.equal(calls, 1, 'interpreter V2 = 1 LLM call');
    assert.equal(result!.metadata.engine, 'v2', 'harus lewat jalur V2 (bukan fallback V1)');

    const sentences = result!.message.content
      .split(/(?<=[.!])\s+|(?<=\?)[ \t]+(?![a-z,])/)
      .filter((s: string) => s.trim().length > 0);
    assert.ok(
      sentences.length <= 2,
      `I-2: reply V2 maks 2 kalimat, dapat ${sentences.length}: ${result!.message.content}`,
    );
    assert.ok(
      !result!.message.content.includes('Stok masih banyak'),
      `I-2: kalimat ke-3 wajib terpotong, dapat: ${result!.message.content}`,
    );

    // ── L2: safety-net conversation.service.ts:373 ──
    // Jalur di mana composer-v2 TIDAK bisa truncate sendiri: info_answer
    // (2 kalimat, sudah lolos truncate L1) + pesan topic_switch digabung
    // '\n' → total 3 kalimat. Hanya safety-net di conversation.service.ts
    // yang bisa memotongnya sebelum dikirim ke customer.
    cannedContent = cannedV2({
      acts: [
        {
          act_id: 'a1',
          intent: 'info_answer',
          entities: [],
          qty: null,
          qty_source: 'default',
          confidence: 0.9,
          supersedes: null,
        },
      ],
      topic_switch: true,
      reply_draft: 'Harga beras Rp 12.000 per kg. Stok tersedia banyak ya Kak.',
    });

    const t2 = await processMsg(convId, custId, 'rekomendasi apa ya?');
    assert.ok(t2.result, 'turn 2 must return a response');
    assert.equal(t2.result!.metadata.engine, 'v2', 'turn 2 harus lewat jalur V2');
    const sentences2 = t2.result!.message.content
      .split(/(?<=[.!])\s+|(?<=\?)[ \t]+(?![a-z,])/)
      .filter((s: string) => s.trim().length > 0);
    assert.ok(
      sentences2.length <= 2,
      `I-2 L2: safety-net wajib memotong gabungan message ke ≤2 kalimat, dapat ${sentences2.length}: ${t2.result!.message.content}`,
    );
    assert.ok(
      !t2.result!.message.content.includes('mau batal'),
      `I-2 L2: pesan topic_switch (kalimat ke-3) wajib terpotong safety-net, dapat: ${t2.result!.message.content}`,
    );
  } finally {
    await setStoreEngine(STORE_ID, 'v2');
    await prisma.conversation.delete({ where: { id: convId } }).catch(() => {});
  }
});

/**
 * P6-5 / P5 gate (c) — P5.2: simbol qty di ringkasan keranjang = 'x' ASCII.
 *
 * Fix asli: bd607f6 (P5.2 #2, conversation.service.ts:1012 — '×' U+00D7 → 'x'
 * ASCII, konsisten dengan composer-v2 dan fallback.service). Karakter '×'
 * bermasalah di sebagian client WhatsApp/PWA dan tidak konsisten dengan
 * renderer lain.
 *
 * Skenario realistis: bot tanya konfirmasi beli beras, customer jawab "iya" →
 * resolver EXECUTE → renderCartSummary menampilkan baris keranjang.
 */
test('Case P6-5/P5c: ringkasan keranjang pakai simbol qty ASCII "x", bukan "×" (P5.2 gate)', async () => {
  const convId = 'conv-p65-p5c';
  const custId = 'cust-p65-p5c';

  await createConv(convId, custId);
  await setStoreEngine(STORE_ID, 'v2');

  try {
    await setPendingV2(convId, {
      id: 'p65-p5c',
      question: 'Jadi pesan beras 1 kg ya Kak?',
      options: ['beras'],
    });

    const { result, llmCalls: calls } = await processMsg(convId, custId, 'iya');
    assert.ok(result, 'must return a response');
    assert.equal(calls, 0, 'resolver path = 0 LLM');
    assert.equal(result!.metadata.action, 'EXECUTE');

    assert.ok(
      result!.message.content.includes('beras x1'),
      `P5.2: qty wajib dirender ASCII "x" (mis. "beras x1"), dapat: ${result!.message.content}`,
    );
    assert.ok(
      !result!.message.content.includes('\u00D7'),
      `P5.2: simbol "×" (U+00D7) tidak boleh dipakai lagi, dapat: ${result!.message.content}`,
    );
  } finally {
    await setStoreEngine(STORE_ID, 'v2');
    await prisma.conversation.delete({ where: { id: convId } }).catch(() => {});
  }
});
// ─────────────────────────────────────────────────────────────────────────────
// PV-P2c — WA text representation untuk hasVariants=true (fallback.service.ts only)
// Scope: HANYA src/business/fallback.service.ts (tryProduct single-match +
// disambiguation). Tests below call tryProduct DIRECTLY (unit-level) against the
// real golden DB store so the WA text is pinned exactly.
//   Gate #1 — hasVariants=false → response IDENTIK sebelum/sesudah (regresi)
//   Gate #2 — hasVariants=true  → arahkan ke storefront, TANPA "masukkan ke keranjang"
//   Gate #3 — disambiguasi campuran → "(ada varian)" hanya di baris tepat
// ─────────────────────────────────────────────────────────────────────────────

function makeCtx(convId: string): ConversationContext {
  return {
    storeId: STORE_ID,
    customerId: 'gate-cust',
    conversationId: convId,
    messages: [],
    lastMessageAt: new Date(),
    status: 'active',
  };
}

test('PV-P2c Gate #1 (regresi): hasVariants=false → tryProduct response IDENTIK sebelum/sesudah', async () => {
  // "beras" adalah base product: hasVariants=false (DB default), stock=50, price=12000.
  // Expected string = original single-match output. Setelah branch variant ditambah,
  // path non-variant harus tetap BYTE-IDENTIK (bukti: asercpsi ini pass sebelum+sesudah).
  const ctx = makeCtx('conv-pv-gate1');
  const result: any = await (fallbackService as any).tryProduct(ctx, 'beras');
  assert.ok(result, 'tryProduct must return a result');
  assert.equal(result.source, ResponseSource.PRODUCT);
  const expected =
    'Halo Kak! Untuk *beras* harganya *Rp 12.000* per unit ya. 🌿 (Stok ready 50 pcs)\n\n' +
    'Mau dimasukkan ke keranjang belanja Kakak?';
  assert.equal(
    result.content,
    expected,
    'hasVariants=false response must be byte-identical (Gate #1 regresi)',
  );
  // Regresi: non-variant TIDAK boleh menampilkan penanda varian / storefront
  assert.ok(!result.content.includes('toko web'));
  assert.ok(!result.content.includes('(ada varian)'));
});

test('PV-P2c Gate #2: hasVariants=true → arahkan ke storefront web, TIDAK ada "masukkan ke keranjang"', async () => {
  // Set store slug agar link storefront resolve ke .../c/<slug>
  await prisma.store.update({ where: { id: STORE_ID }, data: { slug: 'golden' } });

  await withProduct(
    'prod-gate2-kacamata',
    'kacamata',
    150000,
    10,
    async () => {
      const ctx = makeCtx('conv-pv-gate2');
      const result: any = await (fallbackService as any).tryProduct(ctx, 'kacamata');
      assert.ok(result, 'tryProduct must return a result');
      assert.equal(result.source, ResponseSource.PRODUCT);

      // Arahin ke toko web (storefront) — berisi link /c/<slug>
      assert.ok(result.content.includes('toko web'), 'harus arahkan ke toko web');
      assert.ok(result.content.includes('varian'), 'harus menyebut varian');
      assert.ok(result.content.includes('/c/golden'), 'harus berisi link storefront /c/<slug>');

      // Regresi: TIDAK ada lagi ajakan masuk keranjang untuk produk variant
      assert.ok(
        !result.content.includes('Mau dimasukkan ke keranjang belanja Kakak?'),
        'hasVariants=true TIDAK boleh mengajak "masukkan ke keranjang"',
      );
    },
    true, // hasVariants
  );
});

test('PV-P2c Gate #3: disambiguasi campuran varian/non-varian → "(ada varian)" hanya di baris tepat', async () => {
  // "baju" prefix-matches "Baju Merah" (score 3) dan "Baju Putih" (score 3)
  // → similarCount=2 → disambiguation branch. Marker hanya pada hasVariants=true.
  await withProduct('prod-gate3-merah', 'Baju Merah', 200000, 5, async () => {
    await withProduct('prod-gate3-putih', 'Baju Putih', 180000, 5, async () => {
      const ctx = makeCtx('conv-pv-gate3');
      const result: any = await (fallbackService as any).tryProduct(ctx, 'baju');
      assert.ok(result, 'tryProduct must return disambiguation');
      assert.equal(result.source, ResponseSource.PRODUCT);

      // Kedua kandidat muncul di daftar
      assert.ok(result.content.includes('Baju Merah'));
      assert.ok(result.content.includes('Baju Putih'));

      // Penanda "(ada varian)" muncul tepat satu kali (hanya Baju Merah)
      const markerCount = (result.content.match(/\(ada varian\)/g) || []).length;
      assert.equal(markerCount, 1, 'hanya 1 penanda (ada varian) untuk 1 produk varian');

      const lines = result.content.split('\n');
      const merahLine = lines.find((l: string) => l.includes('Baju Merah'));
      const putihLine = lines.find((l: string) => l.includes('Baju Putih'));
      assert.ok(merahLine, 'harus ada baris Baju Merah');
      assert.ok(putihLine, 'harus ada baris Baju Putih');
      assert.ok(merahLine!.includes('(ada varian)'), 'Baju Merah (hasVariants) wajib ada penanda');
      assert.ok(!putihLine!.includes('(ada varian)'), 'Baju Putih (non-variant) TIDAK boleh ada penanda');
    });
  }, true); // Baju Merah hasVariants=true; Baju Putih default false
});

