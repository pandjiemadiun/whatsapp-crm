/**
 * PV-P2a — enrichProduct variant display shape tests.
 *
 * Runner: npm run test:structured (via glob include)
 *
 * Gate #1: produk tanpa varian (hasVariants=false) → payload TIDAK ada field `variants`.
 * Gate #2: produk dengan varian → hanya active + deletedAt=null, shape {id,label,price,stock,sku}.
 * Gate #3: variant label fallback → attributes values → sku → "Varian".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../infrastructure/prisma.js';
import { conversationService } from '../business/conversation.service.js';
import { productService } from '../business/product.service.js';
import {
  conversationDeliveryService,
  type DeliveryResult,
  type MessageCreatedData,
} from '../services/conversation-delivery.service.js';
import { eventBus } from '../services/event-bus.service.js';
import { classifyStructured } from '../services/structured-message.mapper.js';
import { ResponseSource } from '../domain/types.js';
import type { ResponseResult } from '../domain/types.js';

// ── Fixture IDs (unik untuk test ini) ────────────────────────────────────────
const STORE_SLUG = 'store-p2a-mapper';
const WEB_UID = 'webuid-p2a-mapper';
const STORE_ID = '11111111-1111-4111-8111-000000000020';
const CUST_ID = '11111111-1111-4111-8111-000000000021';
const CONV_ID = '11111111-1111-4111-8111-000000000022';

const origProcessCustomerMessage = conversationService.processCustomerMessage;
let capturedRef: { env: { data: MessageCreatedData } | null } = { env: null };
let unsubMessageCreated: (() => void) | null = null;

// ── Helpers (mirror structured-message.test.ts pattern) ──────────────────────

function makeResult(opts: {
  id: string;
  content: string;
  source?: ResponseSource;
  reason?: string;
  matchedNames?: string[];
  productIds?: string[];
  matchedPrices?: number[];
}): ResponseResult {
  const metadata: Record<string, unknown> = {};
  if (opts.reason) metadata.reason = opts.reason;
  if (opts.matchedNames) {
    metadata.matchedNames = opts.matchedNames;
    metadata.productIds = opts.productIds ?? [];
    metadata.matchedPrices = opts.matchedPrices ?? [];
  }
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

async function seedRow(result: ResponseResult) {
  await prisma.conversationHistory.deleteMany({ where: { conversationId: CONV_ID } });
  await prisma.conversationHistory.create({
    data: {
      id: result.message.id,
      conversationId: CONV_ID,
      role: 'assistant',
      content: result.message.content,
      source: String(result.source),
      metadata: {} as any,
      createdAt: result.message.createdAt,
    },
  });
}

function withStub<T extends object, K extends keyof T>(obj: T, k: K, stub: T[K], fn: () => Promise<void>): Promise<void> {
  const orig = obj[k];
  (obj as any)[k] = stub;
  return fn().finally(() => { (obj as any)[k] = orig; });
}

function payloadOf(res: { kind: string; payload?: unknown }): any {
  return res.payload;
}

async function setupFixtures() {
  await prisma.conversationHistory.deleteMany({ where: { conversationId: CONV_ID } });
  await prisma.conversation.deleteMany({ where: { id: CONV_ID } });
  await prisma.customer.deleteMany({ where: { webUid: WEB_UID } });
  await prisma.store.deleteMany({ where: { slug: STORE_SLUG } });

  await prisma.store.create({
    data: {
      id: STORE_ID,
      name: 'P2a Mapper Test',
      slug: STORE_SLUG,
      phoneNumber: '+6281200000008',
      address: 'Jl. Test No. 8',
      originProvinceId: 'prov-test-8',
      originProvinceName: 'Jawa Barat',
      originCityId: 'city-test-8',
      originCityName: 'Bandung',
      originSubdistrictId: 'sub-test-8',
      originSubdistrictName: 'Coblong',
    },
  });
  await prisma.customer.create({ data: { id: CUST_ID, storeId: STORE_ID, webUid: WEB_UID, phone: null } });
  await prisma.conversation.create({
    data: { id: CONV_ID, storeId: STORE_ID, customerId: CUST_ID, channel: 'web', customerPhone: null },
  });
}

async function teardownFixtures() {
  if (unsubMessageCreated) unsubMessageCreated();
  await prisma.conversationHistory.deleteMany({ where: { conversationId: CONV_ID } });
  await prisma.conversation.deleteMany({ where: { id: CONV_ID } });
  await prisma.customer.deleteMany({ where: { webUid: WEB_UID } });
  await prisma.store.deleteMany({ where: { slug: STORE_SLUG } });
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('PV-P2a-Gate1: hasVariants=false → variants field ABSENT (bukan [])', async () => {
  await setupFixtures();

  const prod = { id: 'p1', name: 'Sosis', price: 15000, stock: 5, primaryImageUrl: 'http://x/s.png', hasVariants: false };
  const r = makeResult({ id: 'm-p2a1', source: ResponseSource.PRODUCT, content: 'Harga sosis', matchedNames: ['Sosis'], productIds: ['p1'], matchedPrices: [15000] });
  await seedRow(r);

  const stubEngine = (result: ResponseResult | null) => {
    conversationService.processCustomerMessage = (async () => result) as typeof conversationService.processCustomerMessage;
  };
  stubEngine(r);
  capturedRef.env = null;
  unsubMessageCreated = eventBus.subscribe<any>('message.created', (env) => { capturedRef.env = env; });

  try {
    await withStub(productService, 'getProductById', (async (_id: string) => prod) as any, async () => {
      const res = await conversationDeliveryService.processWebRequest({
        storeId: STORE_ID, customerId: CUST_ID, conversationId: CONV_ID, message: 'msg',
      });
      assert.equal(res.kind, 'ok');
      assert.equal((res as Extract<DeliveryResult, { kind: 'ok' }>).type, 'product');
      const payload = payloadOf(res);
      assert.equal(Object.keys(payload ?? {}).includes('variants'), false, 'variants field must be absent');
      assert.deepEqual(payload, { id: 'p1', name: 'Sosis', price: 15000, stock: 5, imageUrl: 'http://x/s.png' });
    });
  } finally {
    conversationService.processCustomerMessage = origProcessCustomerMessage;
    await teardownFixtures();
  }
});

test('PV-P2a-Gate2: hasVariants=true → hanya active+not-deleted, shape {id,label,price,stock,sku}', async () => {
  await setupFixtures();

  const prod = { id: 'p1', name: 'Sosis', price: 15000, stock: 5, primaryImageUrl: 'http://x/s.png', hasVariants: true, storeId: STORE_ID };
  const variants = [
    { id: 'v1', productId: 'p1', storeId: STORE_ID, price: 16000, stock: 5, sku: 'SOS-R', attributes: { size: 'S', color: 'Merah' }, isActive: true },
    { id: 'v2', productId: 'p1', storeId: STORE_ID, price: 17000, stock: 0, sku: 'SOS-L', attributes: { size: 'L' }, isActive: false },
    { id: 'v3', productId: 'p1', storeId: STORE_ID, price: 18000, stock: 3, sku: 'SOS-XL', attributes: { size: 'XL' }, isActive: false },
  ];
  const r = makeResult({ id: 'm-p2a2', source: ResponseSource.PRODUCT, content: 'Harga sosis', matchedNames: ['Sosis'], productIds: ['p1'], matchedPrices: [15000] });
  await seedRow(r);

  const stubEngine = (result: ResponseResult | null) => {
    conversationService.processCustomerMessage = (async () => result) as typeof conversationService.processCustomerMessage;
  };
  stubEngine(r);
  capturedRef.env = null;
  unsubMessageCreated = eventBus.subscribe<any>('message.created', (env) => { capturedRef.env = env; });

  try {
    await withStub(productService, 'getProductById', (async (_id: string) => prod) as any, async () => {
      await withStub(productService, 'listVariants', (async (_productId: string, _storeId: string) => variants) as any, async () => {
        const res = await conversationDeliveryService.processWebRequest({
          storeId: STORE_ID, customerId: CUST_ID, conversationId: CONV_ID, message: 'msg',
        });
        assert.equal(res.kind, 'ok');
        assert.equal((res as Extract<DeliveryResult, { kind: 'ok' }>).type, 'product');
        const payload = payloadOf(res);
        assert.ok(Array.isArray(payload?.variants), 'variants must be array');
        assert.equal(payload?.variants?.length, 1, 'only 1 active variant expected');
        const v = (payload?.variants as any[])[0];
        assert.deepEqual(Object.keys(v), ['id', 'label', 'price', 'stock', 'sku']);
        assert.deepEqual(v, { id: 'v1', label: 'S · Merah', price: 16000, stock: 5, sku: 'SOS-R' });
      });
    });
  } finally {
    conversationService.processCustomerMessage = origProcessCustomerMessage;
    await teardownFixtures();
  }
});

test('PV-P2a-Gate3: variant label fallback attributes→sku→Varian', async () => {
  await setupFixtures();

  const prod = { id: 'p1', name: 'Sosis', price: 15000, stock: 5, primaryImageUrl: 'http://x/s.png', hasVariants: true, storeId: STORE_ID };
  const variants = [
    { id: 'v1', price: 16000, stock: 5, sku: null, attributes: null, isActive: true },
    { id: 'v2', price: 17000, stock: 0, sku: 'SKU-123', attributes: {}, isActive: true },
    { id: 'v3', price: 18000, stock: 3, sku: null, attributes: { size: '' }, isActive: true },
    { id: 'v4', price: 19000, stock: 2, sku: 'SKU-456', attributes: { size: 'M' }, isActive: true },
  ];
  const r = makeResult({ id: 'm-p2a3', source: ResponseSource.PRODUCT, content: 'Harga sosis', matchedNames: ['Sosis'], productIds: ['p1'], matchedPrices: [15000] });
  await seedRow(r);

  const stubEngine = (result: ResponseResult | null) => {
    conversationService.processCustomerMessage = (async () => result) as typeof conversationService.processCustomerMessage;
  };
  stubEngine(r);
  capturedRef.env = null;
  unsubMessageCreated = eventBus.subscribe<any>('message.created', (env) => { capturedRef.env = env; });

  try {
    await withStub(productService, 'getProductById', (async (_id: string) => prod) as any, async () => {
      await withStub(productService, 'listVariants', (async (_productId: string, _storeId: string) => variants) as any, async () => {
        const res = await conversationDeliveryService.processWebRequest({
          storeId: STORE_ID, customerId: CUST_ID, conversationId: CONV_ID, message: 'msg',
        });
        assert.equal(res.kind, 'ok');
        assert.equal((res as Extract<DeliveryResult, { kind: 'ok' }>).type, 'product');
        const payload = payloadOf(res);
        const vs = (payload?.variants as any[]) ?? [];
        assert.equal(vs.length, 4);
        assert.deepEqual(vs[0], { id: 'v1', label: 'Varian', price: 16000, stock: 5, sku: null });
        assert.deepEqual(vs[1], { id: 'v2', label: 'SKU-123', price: 17000, stock: 0, sku: 'SKU-123' });
        assert.deepEqual(vs[2], { id: 'v3', label: 'Varian', price: 18000, stock: 3, sku: null });
        assert.deepEqual(vs[3], { id: 'v4', label: 'M', price: 19000, stock: 2, sku: 'SKU-456' });
      });
    });
  } finally {
    conversationService.processCustomerMessage = origProcessCustomerMessage;
    await teardownFixtures();
  }
});
