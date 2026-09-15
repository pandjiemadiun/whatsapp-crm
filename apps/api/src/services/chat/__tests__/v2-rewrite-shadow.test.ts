/**
 * WIRE-V2ENGINE-ENTRYPOINT — Jest isolation unit test
 *
 * Memverifikasi:
 * 1. Flag chatEngine.v2RewriteMode='off' (default) → fireV2RewriteShadowCall NO-OP
 *    (tidak menulis ke v2_shadow_logs, tidak memanggil callV2Engine).
 * 2. Flag 'shadow' + V2EngineOutput dengan proposed_actions=ADD_TO_CART →
 *    - Log disimpan terpisah di v2_shadow_logs
 *    - v2Output mengandung intent + proposed_actions
 *    - v2DerivedReason = 'modify_cart'
 *    - v2MessageType = 'cart'
 * 3. Flag 'shadow' + V2EngineOutput needs_clarification=true + DB pending ada options →
 *    - v2QuickReply = {reason, question}
 *    - v2MessageType = 'quick_reply'
 * 4. Flag 'shadow' + V2EngineOutput intent='escalation' →
 *    - v2DerivedReason = 'escalation_clarification_retry_exceeded'
 *    - v2MessageType = 'handoff'
 * 5. Flag 'shadow' + V2 engine failure → log still saved with error, no
 *    translation-layer columns populated.
 * 6. Flag 'shadow' + wrong storeId → NO log (canary store isolation).
 *
 * Runner (Jest):
 *   npx node --experimental-vm-modules ./node_modules/.bin/jest \
 *     --config jest.config.cjs --forceExit \
 *     --testPathPattern="v2-rewrite-shadow"
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { configService } from '../../../business/config.service.js';
import { canonicalConversationStateService } from '../../../business/canonical-context.service.js';
import { productService } from '../../../business/product.service.js';
import { cartAuthority } from '../../../business/cart-authority.js';
import { prisma } from '../../../infrastructure/prisma.js';
import {
  fireV2RewriteShadowCall,
  type V2RewriteShadowParams,
} from '../v2-engine/shadow-wiring.js';
import { getV2RewriteMode, V2_REWRITE_MODE_FLAG_KEY } from '../v2-engine/rewrite-config.js';
import { SHADOW_STORE_ID } from '../v2-engine/shadow-wiring.js';
import { V2_INTENTS } from '../v2-engine/schema.js';
import type { V2EngineOutput, V2ProposedAction } from '../v2-engine/schema.js';
import type { V2EngineResult } from '../v2-engine/engine-call.js';
import type { Product } from '../../../domain/types.js';
import type { PendingClarification, ClarificationOption } from '../../../domain/types.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const TEST_CONV_ID = `test-v2rewrite-${Date.now()}`;
const TEST_STORE_ID = SHADOW_STORE_ID; // store-a3cd7205 (canary store)
const FLAG_KEY = V2_REWRITE_MODE_FLAG_KEY;

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeV2Output(overrides: Record<string, unknown> = {}): V2EngineOutput {
  return {
    schema_version: 'v1' as const,
    intent: V2_INTENTS.PRODUCT_INQUIRY,
    confidence: 0.9,
    entities: [],
    proposed_actions: [],
    reply_text: 'Ada ban dan oli tersedia.',
    needs_clarification: false,
    uncertainty_signals: [],
    ...overrides,
  } as V2EngineOutput;
}

function makeMockCallV2Engine(result: V2EngineResult): V2RewriteShadowParams['callV2EngineFn'] {
  return (async () => result) as V2RewriteShadowParams['callV2EngineFn'];
}

const MOCK_PRODUCTS: Product[] = [
  { id: 'prod-ban', name: 'Ban Dalam Motor', price: 50000, stock: 100, primaryImageUrl: 'http://img/ban', hasVariants: false } as Product,
  { id: 'prod-oli', name: 'Oli Mesin', price: 75000, stock: 30, primaryImageUrl: 'http://img/oli', hasVariants: false } as Product,
];

const MOCK_OPTIONS: ClarificationOption[] = [
  { id: '0', label: '100/90-17', cartOps: [] },
  { id: '1', label: '110/90-17', cartOps: [] },
];

function makePendingClarification(question: string, options: ClarificationOption[]): PendingClarification {
  return {
    id: 'pending-test',
    type: 'clarification',
    question,
    options,
    expected_type: 'choice',
    snapshot: {},
    asked_at: new Date().toISOString(),
    retry_count: 0,
  };
}

// ─── Stub management ────────────────────────────────────────────────────────

let flagStub: (() => void) | null = null;
let v2WsStub: (() => void) | null = null;
let historyStub: (() => void) | null = null;
let logStub: (() => void) | null = null;
let searchStub: (() => void) | null = null;
let listStub: (() => void) | null = null;
let pendingStub: (() => void) | null = null;
let cartStub: (() => void) | null = null;

let capturedLogs: any[] = [];

function setFlag(value: 'off' | 'shadow' | 'active') {
  // Stub configService.getConfig — return the flag value when asked for V2_REWRITE_MODE_FLAG_KEY
  const originalGet = configService.getConfig.bind(configService);
  configService.getConfig = async (key: string) => {
    if (key === FLAG_KEY) return value;
    return originalGet(key);
  };
  flagStub = () => { configService.getConfig = originalGet; };
}

function stubGetV2Workspace(returnValue: any) {
  const original = canonicalConversationStateService.getV2Workspace.bind(canonicalConversationStateService);
  canonicalConversationStateService.getV2Workspace = async () => returnValue;
  v2WsStub = () => { canonicalConversationStateService.getV2Workspace = original; };
}

function stubHistory(returnValue: any[] = []) {
  const original = (prisma.conversationHistory as any).findMany;
  (prisma.conversationHistory as any).findMany = async () => returnValue;
  historyStub = () => { (prisma.conversationHistory as any).findMany = original; };
}

function stubV2ShadowLogCreate() {
  capturedLogs = [];
  const original = (prisma.v2ShadowLog as any).create;
  (prisma.v2ShadowLog as any).create = async (args: any) => {
    capturedLogs.push(args.data);
    // Return a fake created record
    return { id: 'test-log-id', ...args.data };
  };
  logStub = () => { (prisma.v2ShadowLog as any).create = original; };
}

function stubSearchProducts(fn: (storeId: string, query: string) => Promise<Product[]> | null) {
  const original = productService.searchProducts.bind(productService);
  productService.searchProducts = async (storeId: string, query: string) => {
    const result = await fn(storeId, query);
    return result ?? [];
  };
  searchStub = () => { productService.searchProducts = original; };
}

function stubListActiveProducts(fn: (storeId: string) => Promise<Product[]>) {
  const original = productService.listActiveProducts.bind(productService);
  productService.listActiveProducts = async (storeId: string) => fn(storeId);
  listStub = () => { productService.listActiveProducts = original; };
}

function stubGetV1PendingClarification(fn: (conversationId: string) => Promise<PendingClarification | null>) {
  const original = canonicalConversationStateService.getV1PendingClarification.bind(canonicalConversationStateService);
  canonicalConversationStateService.getV1PendingClarification = async (conversationId: string) => fn(conversationId);
  pendingStub = () => { canonicalConversationStateService.getV1PendingClarification = original; };
}

function stubCartSummary(result: { items: any[]; total: number | null } | Error) {
  const original = cartAuthority.getCartSummary.bind(cartAuthority);
  if (result instanceof Error) {
    cartAuthority.getCartSummary = async () => { throw result; };
  } else {
    cartAuthority.getCartSummary = async () => result;
  }
  cartStub = () => { cartAuthority.getCartSummary = original; };
}

function restoreAll() {
  if (flagStub) { flagStub(); flagStub = null; }
  if (v2WsStub) { v2WsStub(); v2WsStub = null; }
  if (historyStub) { historyStub(); historyStub = null; }
  if (logStub) { logStub(); logStub = null; }
  if (searchStub) { searchStub(); searchStub = null; }
  if (listStub) { listStub(); listStub = null; }
  if (pendingStub) { pendingStub(); pendingStub = null; }
  if (cartStub) { cartStub(); cartStub = null; }
  capturedLogs = [];
}

// ─── Default stubs for every test ──────────────────────────────────────────

beforeEach(() => {
  // By default: flag is 'off', no DB access, capture logs
  setFlag('off');
  stubGetV2Workspace(null);
  stubHistory([]);
  stubV2ShadowLogCreate();
  stubCartSummary({ items: [], total: null }); // no cart items → no enrichment
});

afterEach(() => {
  restoreAll();
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('getV2RewriteMode (via getConfig stub)', () => {
  it('default "off" → returns "off"', async () => {
    setFlag('off');
    const result = await getV2RewriteMode();
    assert.strictEqual(result, 'off');
  });

  it('flag "shadow" → returns "shadow"', async () => {
    setFlag('shadow');
    const result = await getV2RewriteMode();
    assert.strictEqual(result, 'shadow');
  });

  it('flag "active" → returns "active" (now a valid value, canary-only)', async () => {
    setFlag('active');
    const result = await getV2RewriteMode();
    assert.strictEqual(result, 'active');
  });

  it('flag "bogus" (truly unknown) → returns "off" (fail-safe)', async () => {
    setFlag('bogus' as any);
    const result = await getV2RewriteMode();
    assert.strictEqual(result, 'off');
  });
});

// ─── off mode (default, safe) ───────────────────────────────────────────────

describe('fireV2RewriteShadowCall — off mode (default, safe)', () => {
  it('v2RewriteMode=off → NO log entry created (customer reply unaffected)', async () => {
    setFlag('off');

    const mockResult: V2EngineResult = {
      success: true,
      data: makeV2Output({ intent: V2_INTENTS.ADD_TO_CART }),
      provider: 'gemini',
      model: 'gemini-2.0-flash',
    };

    await fireV2RewriteShadowCall({
      storeId: TEST_STORE_ID,
      conversationId: TEST_CONV_ID,
      customerMessage: 'test message',
      v1Reply: 'v1 reply unchanged',
      callV2EngineFn: makeMockCallV2Engine(mockResult),
    });

    assert.strictEqual(capturedLogs.length, 0, 'off mode → prisma.v2ShadowLog.create must NOT be called');
  });

  it('v2RewriteMode=off → callV2EngineFn NOT invoked', async () => {
    setFlag('off');
    let callCount = 0;

    await fireV2RewriteShadowCall({
      storeId: TEST_STORE_ID,
      conversationId: TEST_CONV_ID,
      customerMessage: 'test',
      v1Reply: 'reply',
      callV2EngineFn: (async () => { callCount++; return { success: true, data: makeV2Output({}), provider: 'gemini', model: 'g' } as V2EngineResult; }) as any,
    });

    assert.strictEqual(callCount, 0, 'off mode → callV2Engine must NOT be called');
  });
});

// ─── shadow mode: cart mutation → reason + messageType ──────────────────────

describe('fireV2RewriteShadowCall — shadow mode (ADD_TO_CART → cart)', () => {
  beforeEach(() => {
    setFlag('shadow');
    stubSearchProducts(async (storeId, query) => {
      const lowerQuery = query.toLowerCase();
      return MOCK_PRODUCTS.filter((p) => p.name.toLowerCase().includes(lowerQuery));
    });
    stubListActiveProducts(async () => MOCK_PRODUCTS);
  });

  it('V2Output intent=add_to_cart + proposed_actions=ADD_TO_CART → log with reason=modify_cart, messageType=cart', async () => {
    const proposedActions: V2ProposedAction[] = [
      { action_type: 'ADD_TO_CART', payload: { product: 'Ban Dalam Motor', qty: 2 }, confidence: 0.95, requires_validation: true },
    ];

    const v2Output = makeV2Output({
      intent: V2_INTENTS.ADD_TO_CART,
      entities: [{ type: 'product', value: 'Ban Dalam Motor', confidence: 0.9, metadata: {} } as any],
      proposed_actions: proposedActions,
      reply_text: 'Saya tambahkan ban ke keranjang.',
    }) as V2EngineOutput;

    const mockResult: V2EngineResult = {
      success: true, data: v2Output, provider: 'gemini', model: 'gemini-2.0-flash',
    };

    await fireV2RewriteShadowCall({
      storeId: TEST_STORE_ID,
      conversationId: TEST_CONV_ID,
      customerMessage: 'mau tambah ban',
      v1Reply: 'v1 reply dari reasoning.ts (TIDAK berubah)',
      callV2EngineFn: makeMockCallV2Engine(mockResult),
    });

    assert.strictEqual(capturedLogs.length, 1, 'shadow mode → 1 V2ShadowLog row');

    const logEntry = capturedLogs[0];

    // v2Output must contain intent + proposed_actions
    // v2Output stores the full V2EngineResult: { success, data, provider, model }
    const v2ResultObj = logEntry.v2Output as Record<string, unknown>;
    assert.ok(v2ResultObj.success, 'v2Output.success must be true');
    const v2Data = v2ResultObj.data as Record<string, unknown>;
    assert.strictEqual(v2Data.intent, V2_INTENTS.ADD_TO_CART, 'v2Output.data must contain intent');
    assert.ok(v2Data.proposed_actions, 'v2Output.data must contain proposed_actions');
    const pa = v2Data.proposed_actions as V2ProposedAction[];
    assert.strictEqual(pa[0].action_type, 'ADD_TO_CART');

    // v2DerivedReason must be 'modify_cart'
    assert.strictEqual(logEntry.v2DerivedReason, 'modify_cart', 'reason must be modify_cart');

    // v2MessageType must be 'cart'
    assert.strictEqual(logEntry.v2MessageType, 'cart', 'messageType must be cart');

    // v2ProductSource must contain product info (entity resolved)
    assert.ok(logEntry.v2ProductSource, 'v2ProductSource must be present');
    const ps = logEntry.v2ProductSource as Record<string, unknown>;
    assert.ok(ps.matchedNames, 'v2ProductSource.matchedNames must exist');
    const mn = ps.matchedNames as unknown[];
    assert.ok(mn.length >= 1, 'at least 1 product matched');

    // V1 reply must be preserved (unchanged)
    assert.strictEqual(logEntry.v1ActualReply, 'v1 reply dari reasoning.ts (TIDAK berubah)', 'V1 reply must be preserved');

    // v2QuickReply should be null (needs_clarification=false)
    assert.ok(!logEntry.v2QuickReply, 'no clarification → v2QuickReply must be null/undefined');
  });

  it('V2Output intent=escalation → log with reason=escalation_clarification_retry_exceeded, messageType=handoff', async () => {
    const v2Output = makeV2Output({
      intent: V2_INTENTS.ESCALATION,
      proposed_actions: [],
      reply_text: 'Saya mengalihkan ke admin kami.',
    }) as V2EngineOutput;

    const mockResult: V2EngineResult = {
      success: true, data: v2Output, provider: 'groq', model: 'gemma2-9b',
    };

    await fireV2RewriteShadowCall({
      storeId: TEST_STORE_ID,
      conversationId: TEST_CONV_ID,
      customerMessage: 'bicarakan dengan admin',
      v1Reply: 'v1 reply unchanged',
      callV2EngineFn: makeMockCallV2Engine(mockResult),
    });

    assert.strictEqual(capturedLogs.length, 1);
    const logEntry = capturedLogs[0];
    assert.strictEqual(logEntry.v2DerivedReason, 'escalation_clarification_retry_exceeded');
    assert.strictEqual(logEntry.v2MessageType, 'handoff');
  });
});

// ─── shadow mode: quick_reply ───────────────────────────────────────────────

describe('fireV2RewriteShadowCall — shadow mode (clarification → quick_reply)', () => {
  beforeEach(() => {
    setFlag('shadow');
    stubSearchProducts(async () => []);
    stubListActiveProducts(async () => []);
  });

  it('V2Output needs_clarification=true + DB pending ada options → log with quick_reply, messageType=quick_reply', async () => {
    const pending = makePendingClarification('Untuk ban ukuran berapa?', MOCK_OPTIONS);
    stubGetV1PendingClarification(async () => pending);

    const v2Output = makeV2Output({
      intent: V2_INTENTS.CLARIFICATION,
      needs_clarification: true,
      clarification_question: 'Untuk ban dalam motor ukuran ring berapa Kak?',
      proposed_actions: [],
      reply_text: 'Untuk ban dalam motor ukuran ring berapa Kak?',
    }) as V2EngineOutput;

    const mockResult: V2EngineResult = {
      success: true, data: v2Output, provider: 'gemini', model: 'gemini-2.0-flash',
    };

    await fireV2RewriteShadowCall({
      storeId: TEST_STORE_ID,
      conversationId: TEST_CONV_ID,
      customerMessage: 'mau beli ban ukuran berapa?',
      v1Reply: 'v1 reply dari reasoning.ts (TIDAK berubah)',
      callV2EngineFn: makeMockCallV2Engine(mockResult),
    });

    assert.strictEqual(capturedLogs.length, 1);
    const logEntry = capturedLogs[0];

    // v2Output must contain intent + proposed_actions
    const v2ResultObjQr = logEntry.v2Output as Record<string, unknown>;
    assert.ok(v2ResultObjQr.success, 'v2Output.success must be true');
    const v2DataQr = v2ResultObjQr.data as Record<string, unknown>;
    assert.strictEqual(v2DataQr.intent, V2_INTENTS.CLARIFICATION);
    assert.ok(v2DataQr.proposed_actions, 'v2Output.data must contain proposed_actions');

    // v2QuickReply must be present
    assert.ok(logEntry.v2QuickReply, 'v2QuickReply must be present');
    const qr = logEntry.v2QuickReply as Record<string, unknown>;
    assert.strictEqual(qr.reason, 'clarification_asked');

    // v2MessageType must be 'quick_reply'
    assert.strictEqual(logEntry.v2MessageType, 'quick_reply', 'messageType must be quick_reply');

    // v1ActualReply must be preserved
    assert.strictEqual(logEntry.v1ActualReply, 'v1 reply dari reasoning.ts (TIDAK berubah)');
  });

  it('V2Output needs_clarification=true + DB pending TIDAK ada options → quick_reply null, messageType=text (JUNGKAL)', async () => {
    const pending = makePendingClarification('question', []); // options kosong
    stubGetV1PendingClarification(async () => pending);

    const v2Output = makeV2Output({
      intent: V2_INTENTS.CLARIFICATION,
      needs_clarification: true,
      clarification_question: 'ukuran berapa?',
      proposed_actions: [],
      reply_text: 'ukuran berapa?',
    }) as V2EngineOutput;

    const mockResult: V2EngineResult = {
      success: true, data: v2Output, provider: 'gemini', model: 'gemini-2.0-flash',
    };

    await fireV2RewriteShadowCall({
      storeId: TEST_STORE_ID,
      conversationId: TEST_CONV_ID,
      customerMessage: 'ukuran berapa?',
      v1Reply: 'v1 reply',
      callV2EngineFn: makeMockCallV2Engine(mockResult),
    });

    assert.strictEqual(capturedLogs.length, 1);
    const logEntry = capturedLogs[0];

    // No options → v2QuickReply must be null (JUNGKAL — anti-hallucination)
    assert.ok(!logEntry.v2QuickReply, 'no options → v2QuickReply must be null/undefined (JUNGKAL)');
    assert.strictEqual(logEntry.v2MessageType, 'text', 'no options → messageType must be text');
  });
});

// ─── shadow mode: V2 engine failure ─────────────────────────────────────────

describe('fireV2RewriteShadowCall — shadow mode (V2 engine failure)', () => {
  beforeEach(() => {
    setFlag('shadow');
  });

  it('V2 engine returns error → log still saved with error, no translation layer results', async () => {
    const mockResult: V2EngineResult = {
      success: false,
      error: { type: 'provider_exhausted', message: 'All providers exhausted', failedProviders: ['gemini', 'groq'] },
    } as V2EngineResult;

    await fireV2RewriteShadowCall({
      storeId: TEST_STORE_ID,
      conversationId: TEST_CONV_ID,
      customerMessage: 'test',
      v1Reply: 'v1 safe reply',
      callV2EngineFn: makeMockCallV2Engine(mockResult),
    });

    assert.strictEqual(capturedLogs.length, 1, 'log entry must still be created on V2 failure');
    const logEntry = capturedLogs[0];

    // v2Output should contain the error
    assert.strictEqual(logEntry.v2Output.success, false, 'v2Output should show failure');
    assert.ok(logEntry.v2Output.error, 'v2Output should contain error info');

    // No translation layer results (since V2 failed)
    assert.ok(!logEntry.v2DerivedReason, 'failed V2 → reason must be null/undefined');
    assert.ok(!logEntry.v2MessageType, 'failed V2 → messageType must be null/undefined');
    assert.ok(!logEntry.v2ProductSource, 'failed V2 → productSource must be null/undefined');
    assert.ok(!logEntry.v2QuickReply, 'failed V2 → quickReply must be null/undefined');
  });
});

// ─── shadow mode: wrong store (isolation) ─────────────────────────────────

describe('fireV2RewriteShadowCall — wrong store (canary isolation)', () => {
  beforeEach(() => {
    setFlag('shadow');
  });

  it('shadow mode + wrong storeId → NO log entry (canary store isolation)', async () => {
    const mockResult: V2EngineResult = {
      success: true, data: makeV2Output({}), provider: 'gemini', model: 'gemini-2.0-flash',
    };

    await fireV2RewriteShadowCall({
      storeId: 'store-other-9999',
      conversationId: TEST_CONV_ID,
      customerMessage: 'test',
      v1Reply: 'reply',
      callV2EngineFn: makeMockCallV2Engine(mockResult),
    });

    assert.strictEqual(capturedLogs.length, 0, 'wrong store → no log entry');
  });
});
