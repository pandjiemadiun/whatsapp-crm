/**
 * UNIT6-B §2a + Acceptance-6 — DB readback of the NEW executeWaCartMutation return shape.
 *
 * Calls executeWaCartMutation DIRECTLY (bypassing the v2 mapper AND the HTTP layer —
 * Unit 2 does not wire the mapper) and proves WaCartMutationResult
 * { status, items, unresolved } actually surfaces resolution failures that
 * CartAuthority.executeOps already computes (ExecuteOpsResult) — they were
 * previously discarded at the claim path.
 *
 * Run against the CANARY store store-a3cd7205 (id 'store-a3cd7205', slug
 * 'bengkel-didik-test'). All rows created here are THROWAWAY and are cleaned up
 * leaf-first in `after`; we then assert count=0 (no orphaned
 * actionIdempotency / order / orderItem / conversation / customer) — same safety
 * pattern as GAP1-FIX Step 0.
 *
 * 2b note: hardening the `!messageId` branch (:1556) to `throw` is BLOCKED in this
 * unit — the /handle route (routes/messages.ts:40, mounted at index.ts:130) reaches
 * that branch with messageId=undefined (via conversation.service.ts:677) and would
 * break. Test #2 below locks in the CURRENT (2a) behavior: :1556 still
 * direct-executes (no claim) but returns the new {status,items,unresolved} shape and
 * does NOT throw. The throw test is deferred until /handle is wired with a stable
 * messageId (see UNIT6-B §2b blocking finding in the report).
 *
 * Runner:
 *   npx tsx --env-file=../../.env --test --test-force-exit src/tests/executeWaCartMutation.unresolved.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../infrastructure/prisma.js';
import { executeWaCartMutation } from '../business/action-registry.js';
import type { CartOp } from '../domain/types.js';

const STORE_ID = 'store-a3cd7205'; // canary store (slug bengkel-didik-test)
const RUN_ID = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const WEB_UID = `unit2-readback-${RUN_ID}`;
const MSG_ID = `unit2-readback-msg-${RUN_ID}`;
const BOGUS_PRODUCT = '__unit2_nonexistent_product__';
const CART_OP: CartOp[] = [{ type: 'add', product: BOGUS_PRODUCT, qty: 1 }];

let customerId: string;
let conversationId: string;

// Leaf-first cleanup helpers, tolerant of partial state (non-fatal between runs).
async function deleteAllForConv(convId: string): Promise<void> {
  await prisma.actionIdempotency.deleteMany({ where: { storeId: STORE_ID, actionType: 'WA_CART_MUTATION', actionId: { startsWith: `web:${convId}:` } } }).catch(() => {});
  await prisma.orderItem.deleteMany({ where: { order: { conversationId: convId } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { conversationId: convId } }).catch(() => {});
  await prisma.conversationContext.deleteMany({ where: { conversation: { id: convId } } }).catch(() => {});
  await prisma.conversationHistory.deleteMany({ where: { conversation: { id: convId } } }).catch(() => {});
  await prisma.conversation.deleteMany({ where: { id: convId } }).catch(() => {});
  await prisma.customer.deleteMany({ where: { id: customerId } }).catch(() => {});
}

before(async () => {
  // Read-only precondition: canary store must exist.
  const store = await prisma.store.findUnique({ where: { id: STORE_ID }, select: { id: true } });
  assert.ok(store, `canary store ${STORE_ID} must exist for readback`);
  // Throwaway web customer + conversation (matches pwa.ts:328-371 creation shape).
  const customer = await prisma.customer.create({ data: { storeId: STORE_ID, webUid: WEB_UID, phone: null } });
  customerId = customer.id;
  const conversation = await prisma.conversation.create({
    data: { storeId: STORE_ID, customerId, channel: 'web', customerPhone: null, status: 'open' },
  });
  conversationId = conversation.id;
});

after(async () => {
  await deleteAllForConv(conversationId);
  // Post-cleanup: confirm count=0 (no orphaned throwaway rows) — same as GAP1-FIX Step 0.
  assert.equal(await prisma.actionIdempotency.count({ where: { storeId: STORE_ID, actionType: 'WA_CART_MUTATION', actionId: { startsWith: `web:${conversationId}:` } } }), 0, 'actionIdempotency cleaned to 0');
  assert.equal(await prisma.orderItem.count({ where: { order: { conversationId } } }), 0, 'orderItem cleaned to 0');
  assert.equal(await prisma.order.count({ where: { conversationId } }), 0, 'order cleaned to 0');
  assert.equal(await prisma.conversation.count({ where: { id: conversationId } }), 0, 'conversation cleaned to 0');
  assert.equal(await prisma.customer.count({ where: { id: customerId } }), 0, 'customer cleaned to 0');
  await prisma.$disconnect();
});

test('UNIT6-B §2a readback: bogus product via CLAIM path (messageId set) → unresolved[] NOT_FOUND', async () => {
  const result = await executeWaCartMutation(CART_OP, STORE_ID, customerId, conversationId, MSG_ID, 'web');

  // 2a: new shape {status, items, unresolved}; items/unresolved surfaced from the
  // claim path's executeOps return (execution.result @ :1600) — NOT a second executeOps call.
  assert.equal(result.status, 'applied', `expected 'applied', got '${result.status}'`);
  assert.equal(result.items.length, 0, 'bogus product resolves to zero confirmed items');
  assert.equal(result.unresolved.length, 1, 'exactly one unresolved op expected');
  assert.equal(result.unresolved[0].product, BOGUS_PRODUCT, 'unresolved[].product must echo the bogus name');
  assert.equal(result.unresolved[0].reason, 'NOT_FOUND', 'unresolved[].reason must be NOT_FOUND');

  // The claim path must have left exactly one WA_CART_MUTATION claim row (proves the
  // claim path — not the !messageId branch — was taken) + a draft order.
  assert.equal(
    await prisma.actionIdempotency.count({ where: { storeId: STORE_ID, actionType: 'WA_CART_MUTATION', actionId: `web:${conversationId}:${MSG_ID}` } }),
    1,
    'claim path must create exactly one WA_CART_MUTATION claim row',
  );
  const draft = await prisma.order.findFirst({ where: { conversationId, orderStatus: 'draft' } });
  assert.ok(draft, 'executeOps must have created a draft order (findOrCreateDraftOrder)');
});

test('UNIT6-B §2b (BLOCKED — see report): undefined messageId (/handle-style) still direct-executes at :1556 and returns WaCartMutationResult, NOT a throw', async () => {
  // :1556 `if (!messageId)` — direct executeOps with NO claim. 2b hardening to `throw`
  // is BLOCKED because /handle (routes/messages.ts:40) reaches here with messageId=undefined.
  // This test pins the CURRENT (2a) behavior: the branch does NOT throw and returns the
  // new {status,items,unresolved} shape (no claim row created — direct-exec, no claim).
  const before = await prisma.actionIdempotency.count({ where: { storeId: STORE_ID, actionType: 'WA_CART_MUTATION', actionId: { startsWith: `web:${conversationId}:` } } });

  const result = await executeWaCartMutation(CART_OP, STORE_ID, customerId, conversationId, undefined, 'web');

  assert.equal(result.status, 'applied', 'direct-exec (!messageId) branch must still return applied (NOT throw)');
  assert.equal(result.items.length, 0, 'bogus product → zero confirmed items');
  assert.equal(result.unresolved.length, 1, 'NOT_FOUND surfaced even on the direct-exec branch');
  assert.equal(result.unresolved[0].reason, 'NOT_FOUND', 'reason must be NOT_FOUND');

  const after = await prisma.actionIdempotency.count({ where: { storeId: STORE_ID, actionType: 'WA_CART_MUTATION', actionId: { startsWith: `web:${conversationId}:` } } });
  assert.equal(after, before, 'direct-exec (!messageId) branch must NOT create a claim row (no new idempotency row)');
});
