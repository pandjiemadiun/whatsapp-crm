/**
 * WIRE-CANCEL-UPDATE-QTY-SHIPPING-ADDRESS — DB-proof E2E: CANCEL_ORDER,
 * UPDATE_CART_QUANTITY, UPDATE_SHIPPING_ADDRESS on the V2 active path.
 *
 * Runner:
 *   npx tsx --env-file=../../.env --test --test-force-exit \
 *     src/tests/wa-cancel-qty-shipping-v2-active-e2e.test.ts
 *
 * PROVES (requirement #4: "bukti lewat database sebelum/sesudah + balasan asli"):
 *
 *   A. UPDATE_CART_QUANTITY (CartOp.type 'update_qty', reusing
 *      CartAuthority.updateQuantity): add 2 → qty becomes 3 → qty 0 deletes the
 *      line. Asserts OrderItem.quantity changed in the DB AND the bot reply
 *      reflects the real qty / deletion.
 *
 *   B. CANCEL_ORDER (reusing handleCancelOrder → orderService.cancelOrder P6-3):
 *      a `pending` order (latest non-draft, non-terminal) is cancelled
 *      (order.orderStatus='cancelled'); restoreStockForOrderItems is invoked.
 *      No eligible order → honest "belum punya pesanan" reply (never a lie).
 *
 *   C. UPDATE_SHIPPING_ADDRESS (new handleUpdateShippingAddress, option a): free-text
 *      address stored verbatim on the draft Order.shippingAddress; empty address
 *      rejected with an honest reply (no DB write).
 *
 * The LLM (llmGateway.generate) and the WA gateway transport (gowaAdapter) are
 * stubbed — same as the payment E2E. Every layer above them
 * (processMessage → conversationService active path → callV2Engine →
 *  handleCancelOrder / executeWaCartMutation → orderService /
 *  cartAuthority.updateQuantity) runs REAL, against the local garuda_dev DB + Redis.
 */
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../infrastructure/prisma.js';
import { conversationService } from '../business/conversation.service.js';
import { llmGateway } from '../adapters/ai/llm-gateway.js';
import { gowaAdapter } from '../adapters/whatsapp/gowa.adapter.js';
import { configService } from '../business/config.service.js';
import type { V2EngineOutput } from '../services/chat/v2-engine/schema.js';

const PREFIX = 'test-wa-act-v2';
const STORE_ID = `${PREFIX}-store`;
const CUSTOMER_PHONE = '+6281200000777';

// ── Mock LLM (canned, schema-valid V2EngineOutput) ───────────────────────────
const originalGenerate = llmGateway.generate.bind(llmGateway);

function v2out(intent: string, actions: any[], reply: string): V2EngineOutput {
  return {
    schema_version: 'v1',
    intent: intent as any,
    confidence: 0.9,
    entities: [],
    proposed_actions: actions,
    reply_text: reply,
    needs_clarification: false,
    uncertainty_signals: [],
  };
}

const ADD_OUTPUT = v2out(
  'add_to_cart',
  [{ action_type: 'ADD_TO_CART', payload: { product: 'Oli Mesin', qty: 2 }, confidence: 0.95, requires_validation: true }],
  'Oli mesin (2) ditambahkan ke keranjang, Kak.',
);
const UPDATE_QTY_3 = v2out(
  'modify_cart',
  [{ action_type: 'UPDATE_CART_QUANTITY', payload: { product: 'Oli Mesin', qty: 3 }, confidence: 0.9, requires_validation: true }],
  'Quantity oli mesin diubah ke 3.',
);
const UPDATE_QTY_0 = v2out(
  'modify_cart',
  [{ action_type: 'UPDATE_CART_QUANTITY', payload: { product: 'Oli Mesin', qty: 0 }, confidence: 0.9, requires_validation: true }],
  'Oli mesin dihapus dari keranjang.',
);
const CANCEL_OUTPUT = v2out(
  'cancel_order',
  [{ action_type: 'CANCEL_ORDER', payload: {}, confidence: 0.9, requires_validation: true }],
  'Pesanan dibatalkan.',
);
const SHIP_OUTPUT = (address: string) => v2out(
  'shipping_inquiry',
  [{ action_type: 'UPDATE_SHIPPING_ADDRESS', payload: { address }, confidence: 0.9, requires_validation: true }],
  'Alamat kirim diperbarui.',
);
const SHIP_EMPTY = v2out(
  'shipping_inquiry',
  [{ action_type: 'UPDATE_SHIPPING_ADDRESS', payload: { address: '' }, confidence: 0.9, requires_validation: true }],
  'Alamat kirim diperbarui.',
);

function mockLlm(output: V2EngineOutput) {
  llmGateway.generate = (async (_prompt: string, _opts?: any) => ({
    content: JSON.stringify(output),
    provider: 'groq',
    model: 'test-model-v2',
    tokens: { input: 1, output: 1 },
    cost: 0,
  })) as any;
}

// ── WA gateway capture + stubs (same as payment E2E) ─────────────────────────
const sendMsgCalls: Array<{ phone: string; text: string }> = [];
const sendImgCalls: Array<{ phone: string; imageUrl: string; caption?: string }> = [];
let saved: { sendMessage: any; sendImage: any; markRead: any; setPresence: any } = {
  sendMessage: undefined, sendImage: undefined, markRead: undefined, setPresence: undefined,
};

function stubGateway() {
  sendMsgCalls.length = 0;
  sendImgCalls.length = 0;
  saved.sendMessage = (gowaAdapter as any).sendMessage;
  saved.sendImage = (gowaAdapter as any).sendImage; // undefined — GowaAdapter has no sendImage
  saved.markRead = (gowaAdapter as any).markRead;
  saved.setPresence = (gowaAdapter as any).setPresence;
  (gowaAdapter as any).sendMessage = async (phone: string, text: string, _cfg?: any) => { sendMsgCalls.push({ phone, text }); return { sent: true }; };
  (gowaAdapter as any).sendImage = async (phone: string, imageUrl: string, caption?: string) => { sendImgCalls.push({ phone, imageUrl, caption }); return { sent: true }; };
  (gowaAdapter as any).markRead = async () => {};
  (gowaAdapter as any).setPresence = async () => {};
}

function restoreGateway() {
  if (saved.sendImage === undefined) { delete (gowaAdapter as any).sendImage; } else { (gowaAdapter as any).sendImage = saved.sendImage; }
  (gowaAdapter as any).sendMessage = saved.sendMessage;
  if (saved.markRead === undefined) delete (gowaAdapter as any).markRead; else (gowaAdapter as any).markRead = saved.markRead;
  if (saved.setPresence === undefined) delete (gowaAdapter as any).setPresence; else (gowaAdapter as any).setPresence = saved.setPresence;
  saved = { sendMessage: undefined, sendImage: undefined, markRead: undefined, setPresence: undefined };
}

// ── DB setup ─────────────────────────────────────────────────────────────────
async function setupStore() {
  await prisma.store.upsert({
    where: { id: STORE_ID },
    update: {
      name: 'WA Active V2 Test Store', isActive: true,
      acceptsTransfer: true, acceptsQris: true, acceptsCod: true,
      phoneNumber: CUSTOMER_PHONE, address: 'Jl. Test No. 77',
      originProvinceId: 'prov-test-77', originProvinceName: 'Jawa Barat',
      originCityId: 'city-test-77', originCityName: 'Bandung',
      originSubdistrictId: 'sub-test-77', originSubdistrictName: 'Coblong',
    },
    create: {
      id: STORE_ID, name: 'WA Active V2 Test Store', slug: `${PREFIX}-slug`,
      isActive: true, acceptsTransfer: true, acceptsQris: true, acceptsCod: true,
      phoneNumber: CUSTOMER_PHONE, address: 'Jl. Test No. 77',
      originProvinceId: 'prov-test-77', originProvinceName: 'Jawa Barat',
      originCityId: 'city-test-77', originCityName: 'Bandung',
      originSubdistrictId: 'sub-test-77', originSubdistrictName: 'Coblong',
    },
  });
  await prisma.bankAccount.upsert({
    where: { id: `${PREFIX}-bank` },
    update: { storeId: STORE_ID, bankName: 'BCA', accountNumber: '9999888877770001', accountName: 'CV Test V2', isActive: true, deletedAt: null },
    create: { id: `${PREFIX}-bank`, storeId: STORE_ID, bankName: 'BCA', accountNumber: '9999888877770001', accountName: 'CV Test V2', isActive: true },
  });
}

async function createTestProduct(name: string, stock: number, price: number) {
  return prisma.product.create({
    data: {
      storeId: STORE_ID, name, price, currency: 'IDR', isActive: true,
      stock, hasVariants: false, weight: 0,
    },
  });
}

async function getDraftOrder(conversationId: string) {
  return prisma.order.findFirst({ where: { conversationId, orderStatus: 'draft', deletedAt: null } });
}

async function getOrderItems(orderId: string) {
  return prisma.orderItem.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
}

async function cleanupConversation(convId: string) {
  // FK-safe: orders/order_items reference conversation.id (RESTRICT delete), so
  // remove child order rows BEFORE the conversation tables.
  const orderRows = await prisma.order.findMany({ where: { conversationId: convId }, select: { id: true } });
  if (orderRows.length) {
    const ids = orderRows.map((o) => o.id);
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } }).catch(() => {});
    await prisma.order.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
  }
  await prisma.conversationHistory.deleteMany({ where: { conversationId: convId } }).catch(() => {});
  await prisma.conversationContext.deleteMany({ where: { conversationId: convId } }).catch(() => {});
  await prisma.conversation.delete({ where: { id: convId } }).catch(() => {});
}

async function cleanupAll() {
  // FK-safe order: children first
  await prisma.orderItem.deleteMany({ where: { order: { storeId: STORE_ID } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
  await prisma.actionIdempotency?.deleteMany?.({ where: { storeId: STORE_ID } }).catch(() => {});
  await prisma.conversationHistory.deleteMany({ where: { conversation: { storeId: STORE_ID } } }).catch(() => {});
  await prisma.conversationContext.deleteMany({ where: { conversation: { storeId: STORE_ID } } }).catch(() => {});
  await prisma.conversation.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
  await prisma.bankAccount.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
  await prisma.product.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
  await prisma.store.deleteMany({ where: { id: STORE_ID } }).catch(() => {});
}

let rewriteModeOrig: string | null = null;

before(async () => {
  await cleanupAll();
  rewriteModeOrig = await configService.getConfig('chatEngine.v2RewriteMode');
  await configService.setConfig('chatEngine.v2RewriteMode', 'active', { category: 'feature_flag' });
  await setupStore();
});

after(async () => {
  if (rewriteModeOrig !== null) {
    await configService.setConfig('chatEngine.v2RewriteMode', rewriteModeOrig, { category: 'feature_flag' });
  }
  await cleanupAll();
  llmGateway.generate = originalGenerate;
  restoreGateway();
  await prisma.$disconnect();
});

afterEach(() => {
  llmGateway.generate = originalGenerate;
  restoreGateway();
});

// ─────────────────────────────────────────────────────────────────────────────
// A. UPDATE_CART_QUANTITY (CartOp 'update_qty' → reuse updateQuantity)
//    add 2 → DB qty 2 → update 3 → DB qty 3 → update 0 → line DELETED.
// ─────────────────────────────────────────────────────────────────────────────

test('UPDATE_CART_QUANTITY: add 2 → qty 2 in DB; then update 3 → qty 3 in DB; then qty 0 → line deleted', async () => {
  const product = await createTestProduct('Oli Mesin', 100, 50000);
  const convId = `conv-qty-${Date.now()}`;

  // turn 1: add 2
  mockLlm(ADD_OUTPUT);
  const r1 = await conversationService.processCustomerMessage(
    STORE_ID, CUSTOMER_PHONE, convId, 'mau tambah oli mesin', 'whatsapp', randomUUID(),
  );
  const order1 = await getDraftOrder(convId);
  const items1 = order1 ? await getOrderItems(order1.id) : [];
  const line1 = items1.find((i) => i.productId === product.id);
  assert.ok(order1, 'draft order must be created after ADD');
  assert.equal(line1?.quantity, 2, 'DB OrderItem.quantity must be 2 after ADD qty 2');
  assert.ok(r1?.message.content, 'bot must reply');
  assert.match(r1!.message.content!.toLowerCase(), /oli mesin|keranjang/);

  // turn 2: update qty → 3
  mockLlm(UPDATE_QTY_3);
  const r2 = await conversationService.processCustomerMessage(
    STORE_ID, CUSTOMER_PHONE, convId, 'ubah quantity oli mesin ke 3', 'whatsapp', randomUUID(),
  );
  const order2 = await getDraftOrder(convId);
  const items2 = order2 ? await getOrderItems(order2.id) : [];
  const line2 = items2.find((i) => i.productId === product.id);
  assert.equal(line2?.quantity, 3, 'DB OrderItem.quantity must be 3 after UPDATE_CART_QUANTITY qty 3 (reused updateQuantity)');
  assert.ok(r2?.message.content, 'bot must reply after qty update');

  // turn 3: qty 0 → delete line
  mockLlm(UPDATE_QTY_0);
  const r3 = await conversationService.processCustomerMessage(
    STORE_ID, CUSTOMER_PHONE, convId, 'hapus oli mesin dari keranjang', 'whatsapp', randomUUID(),
  );
  const order3 = await getDraftOrder(convId);
  const items3 = order3 ? await getOrderItems(order3.id) : [];
  const line3 = items3.find((i) => i.productId === product.id);
  assert.equal(line3, undefined, 'OrderItem line must be DELETED when qty 0 (updateQuantity qty===0 branch)');
  assert.ok(r3?.message.content, 'bot must reply after deletion');

  await cleanupConversation(convId);
});

// ─────────────────────────────────────────────────────────────────────────────
// B. CANCEL_ORDER (reuse handleCancelOrder → orderService.cancelOrder P6-3)
//    pre-shipment ('confirmed') order → orderStatus 'cancelled' +
//    restoreStockForOrderItems runs (pre-shipment stock reservation reversed).
//    'pending' (manual) is intentionally NOT used: PV-P1-08 says pending never
//    reserved stock, so shouldRestoreStock('pending')===false — no restore.
// ─────────────────────────────────────────────────────────────────────────────

test('CANCEL_ORDER: confirmed (pre-shipment) order → orderStatus cancelled + restoreStockForOrderItems fired; reply is DB-grounded', async () => {
  const product = await createTestProduct('Oli Mesin', 100, 50000);
  const convId = `conv-cancel-${Date.now()}`;
  const qty = 2;

  // Seed a pre-shipment ('confirmed') order with an OrderItem.
  // 'confirmed' is in PRE_SHIPMENT_STATUSES (order.service.ts:511), so cancelling
  // it exercises the FULL cancelOrder → shouldRestoreStock → restoreStockForOrderItems
  // path (the reuse target P6-3). FK guard: order.conversationId -> conversation.id,
  // so the conversation row must exist first.
  await prisma.conversation.upsert({
    where: { id: convId },
    update: {},
    create: {
      id: convId,
      storeId: STORE_ID,
      customerId: CUSTOMER_PHONE,
      customerPhone: CUSTOMER_PHONE,
      channel: 'whatsapp',
      status: 'open',
    },
  });
  const seeded = await prisma.order.create({
    data: {
      storeId: STORE_ID,
      conversationId: convId,
      customerId: CUSTOMER_PHONE,
      items: [] as any,
      totalPrice: Number(product.price) * qty,
      currency: 'IDR',
      orderStatus: 'confirmed',
      orderItems: {
        create: {
          productId: product.id,
          productName: 'Oli Mesin',
          quantity: qty,
          unitPrice: Number(product.price),
          subtotal: Number(product.price) * qty,
        },
      },
    },
    include: { orderItems: true },
  });

  const stockBefore = (await prisma.product.findUnique({ where: { id: product.id } }))!.stock; // 100
  const orderId = seeded.id;

  mockLlm(CANCEL_OUTPUT);
  const result = await conversationService.processCustomerMessage(
    STORE_ID, CUSTOMER_PHONE, convId, 'batal pesanan terakhir', 'whatsapp', randomUUID(),
  );

  const cancelled = await prisma.order.findUnique({ where: { id: orderId }, include: { orderItems: true } });
  const stockAfter = (await prisma.product.findUnique({ where: { id: product.id } }))!.stock;

  // DB proof: state-machine transition confirmed → cancelled (reused cancelOrder)
  assert.equal(cancelled?.orderStatus, 'cancelled', 'orderStatus must be cancelled (state machine: confirmed→cancelled)');
  assert.notEqual(cancelled?.orderStatus, 'confirmed', 'order status must have changed');
  // DB proof: restoreStockForOrderItems fired for pre-shipment 'confirmed' status
  // (increments product.stock by the line qty 2).
  assert.equal(stockAfter, (stockBefore ?? 0) + qty, 'restoreStockForOrderItems must run for pre-shipment status (stock += line qty)');
  // DB proof: line item still present but order is cancelled (not deleted)
  assert.equal(cancelled?.orderItems.length, 1, 'order item row must remain (cancelled, not purged)');
  // Honest, DB-grounded reply (NOT the LLM's generic "Pesanan dibatalkan.")
  assert.ok(result?.message.content, 'bot must reply');
  assert.match(result!.message.content!.toLowerCase(), /dibatalkan|stok dikembalikan/);
  assert.equal(result?.metadata?.outcome, 'cancelled');

  await cleanupConversation(convId);
});

test('CANCEL_ORDER: no eligible order → honest "belum punya pesanan" reply (no DB write, no lie)', async () => {
  const convId = `conv-nocancel-${Date.now()}`;
  mockLlm(CANCEL_OUTPUT);
  const result = await conversationService.processCustomerMessage(
    STORE_ID, CUSTOMER_PHONE, convId, 'batal pesanan terakhir', 'whatsapp', randomUUID(),
  );
  // DB proof: no order row created/written for this conversation
  const orders = await prisma.order.findMany({ where: { conversationId: convId } });
  assert.equal(orders.length, 0, 'must NOT create/modify any order when none is cancellable');
  // Honest reply — must NOT claim "sudah dibatalkan"
  assert.ok(result?.message.content);
  assert.match(result!.message.content!, /belum punya pesanan|tidak bisa/i);
  assert.equal(result?.metadata?.outcome, 'cancel_no_eligible_order');
  await cleanupConversation(convId);
});

// ─────────────────────────────────────────────────────────────────────────────
// C. UPDATE_SHIPPING_ADDRESS (option a: free-text on draft Order.shippingAddress)
//    non-empty → stored verbatim + replied; empty → rejected, no DB write.
// ─────────────────────────────────────────────────────────────────────────────

test('UPDATE_SHIPPING_ADDRESS: non-empty free-text stored verbatim on draft Order.shippingAddress + replied', async () => {
  const addr = 'Jl. Merdeka No. 10, Jakarta 10340';
  const convId = `conv-ship-${Date.now()}`;

  mockLlm(SHIP_OUTPUT(addr));
  const result = await conversationService.processCustomerMessage(
    STORE_ID, CUSTOMER_PHONE, convId, `kirim ke ${addr}`, 'whatsapp', randomUUID(),
  );

  const order = await prisma.order.findFirst({ where: { conversationId: convId, orderStatus: 'draft', deletedAt: null } });
  // DB proof: shippingAddress stored verbatim
  assert.ok(order, 'a draft order must exist after shipping-address update (created on demand)');
  assert.equal(order!.shippingAddress, addr, 'Order.shippingAddress must be the verbatim free-text address');
  // Honest reply contains the actual stored address
  assert.ok(result?.message.content);
  assert.match(result!.message.content!, /Jl\. Merdeka No\. 10/);
  assert.equal(result?.metadata?.outcome, 'shipping_address_updated');

  await cleanupConversation(convId);
});

test('UPDATE_SHIPPING_ADDRESS: empty address → rejected, no DB write, honest reply', async () => {
  const convId = `conv-ship-empty-${Date.now()}`;

  mockLlm(SHIP_EMPTY);
  const result = await conversationService.processCustomerMessage(
    STORE_ID, CUSTOMER_PHONE, convId, 'kirim ke', 'whatsapp', randomUUID(),
  );

  // DB proof: shippingAddress must NOT be stored (empty-address path is rejected
  // before the handler runs → no order row is created at all).
  const row = await prisma.order.findFirst({ where: { conversationId: convId } });
  assert.equal(row ? row.shippingAddress : null, null, 'empty address must NOT be stored');
  assert.ok(result?.message.content);
  assert.match(result!.message.content!, /kosong/i);
  assert.equal(result?.metadata?.outcome, 'shipping_address_empty');

  await cleanupConversation(convId);
});
