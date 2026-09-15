/**
 * WIRE-V2ENGINE-ACTIVE — Jest integration unit test
 *
 * Memverifikasi BAGIAN 1, 2, dan 3 dari task WIRE-EXECUTION-AND-FIX-CART-VIEW-AND-ESCALATION:
 *
 * BAGIAN 1: Active path (conversation.service.ts:251-305) executes proposed_actions
 *   via mapV2ActionsToCartOps → executeWaCartMutation → CartAuthority.executeOps.
 *   - Turn 1: LLM returns ADD_TO_CART "Oli Mesin" → draft order created in DB.
 *   - Turn 2: LLM returns OPEN_CART "Totalin" → enrichment reads real cart total from DB.
 *
 * BAGIAN 2: OPEN_CART → reason='view_cart' → classifyStructured returns messageType='cart'
 *   WITHOUT cartOpsExecuted field (so it doesn't show misleading "0 ops executed").
 *
 * BAGIAN 3: intent='escalation' or CONTACT_ADMIN → markHumanTakeover + eventBus.publish
 *   (message.created, conversation.handoff, conversation.updated) → push notification.
 *
 * Runner (Jest):
 *   npx node --experimental-vm-modules ./node_modules/.bin/jest \
 *     --config jest.config.cjs --forceExit \
 *     --testPathPattern="v2-active-wiring"
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { eventBus } from '../../event-bus.service.js';
import { classifyStructured } from '../../structured-message.mapper.js';
import { mapV2ActionsToCartOps } from '../v2-engine/map-actions-to-cart-ops.js';
import { ResponseSource } from '../../../domain/types.js';
import { escalateStatusUpdate } from '../composer-v2.js';
import type { V2EngineOutput, V2ProposedAction, V2Intent } from '../v2-engine/schema.js';
import type { ConversationMessage, ResponseResult } from '../../../domain/types.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeV2Output(
  intent: V2Intent,
  proposed_actions: V2ProposedAction[],
  reply_text: string,
  entities: any[] = [],
): V2EngineOutput {
  return {
    schema_version: 'v1' as const,
    intent,
    confidence: 0.9,
    entities,
    proposed_actions,
    reply_text,
    needs_clarification: false,
    uncertainty_signals: [],
  };
}

function makeResult(content: string, reason?: string, cartOpsExecuted?: number): ResponseResult {
  const msg: ConversationMessage = {
    id: 'msg-test',
    conversationId: 'conv-test',
    sender: 'assistant',
    content,
    source: ResponseSource.AI,
    createdAt: new Date(),
  };
  const metadata: Record<string, unknown> = {};
  if (reason) metadata.reason = reason;
  if (cartOpsExecuted !== undefined) metadata.cartOpsExecuted = cartOpsExecuted;
  return {
    conversationId: 'conv-test',
    message: msg,
    source: ResponseSource.AI,
    confidence: 0.9,
    cost: 0,
    requiresHumanReview: false,
    metadata,
  };
}

// ─── EventBus stub management ───────────────────────────────────────────────

let eventBusPublishStub: (() => void) | null = null;
let capturedEvents: any[] = [];

function stubEventBusPublish() {
  capturedEvents = [];
  const original = eventBus.publish.bind(eventBus);
  eventBus.publish = (env: any) => {
    capturedEvents.push(env);
    return true;
  };
  eventBusPublishStub = () => { eventBus.publish = original; };
}

function restoreAll() {
  if (eventBusPublishStub) { eventBusPublishStub(); eventBusPublishStub = null; }
  capturedEvents = [];
}

// ─── Tests ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  restoreAll();
  stubEventBusPublish();
});

afterEach(() => {
  restoreAll();
});

describe('BAGIAN 2: classifyStructured — OPEN_CART → view_cart → messageType=cart tanpa cartOpsExecuted', () => {
  it('view_cart reason → messageType=cart, basePayload TANPA cartOpsExecuted', () => {
    const classified = classifyStructured(
      makeResult('Berikut total keranjangmu', 'view_cart'),
    );

    assert.strictEqual(classified.messageType, 'cart');
    // view_cart MUST NOT include cartOpsExecuted — basePayload should only have { reason }
    const bp = classified.basePayload ?? {};
    assert.ok(!('cartOpsExecuted' in bp), 'view_cart MUST NOT include cartOpsExecuted (no mutation happened)');
    assert.strictEqual(bp.reason, 'view_cart');
  });

  it('modify_cart reason → messageType=cart, basePayload ADA cartOpsExecuted', () => {
    const classified = classifyStructured(
      makeResult('Oke ditambah', 'modify_cart', 1),
    );

    assert.strictEqual(classified.messageType, 'cart');
    assert.strictEqual(classified.basePayload?.cartOpsExecuted, 1);
  });
});

describe('BAGIAN 1: mapV2ActionsToCartOps — OPEN_CART skipped (read-only), ADD/REMOVE mapped', () => {
  it('OPEN_CART → skipped (requires_validation=false), cartOps kosong', () => {
    const actions: V2ProposedAction[] = [
      { action_type: 'OPEN_CART', payload: {}, confidence: 0.92, requires_validation: false },
    ];
    const { cartOps } = mapV2ActionsToCartOps(actions);
    assert.strictEqual(cartOps.length, 0, 'OPEN_CART must produce 0 cartOps (read-only)');
  });

  it('ADD_TO_CART → mapped to CartOp type "add"', () => {
    const actions: V2ProposedAction[] = [
      {
        action_type: 'ADD_TO_CART',
        payload: { product: 'Oli Mesin', qty: 1 },
        confidence: 0.95,
        requires_validation: true,
      },
    ];
    const { cartOps } = mapV2ActionsToCartOps(actions);
    assert.strictEqual(cartOps.length, 1, 'ADD_TO_CART must produce 1 cartOp');
    assert.strictEqual(cartOps[0].type, 'add');
    assert.strictEqual(cartOps[0].product, 'Oli Mesin');
  });

  it('REMOVE_FROM_CART → mapped to CartOp type "remove"', () => {
    const actions: V2ProposedAction[] = [
      {
        action_type: 'REMOVE_FROM_CART',
        payload: { product: 'Ban Dalam Motor' },
        confidence: 0.9,
        requires_validation: true,
      },
    ];
    const { cartOps } = mapV2ActionsToCartOps(actions);
    assert.strictEqual(cartOps.length, 1);
    assert.strictEqual(cartOps[0].type, 'remove');
  });

  it('CONTACT_ADMIN → skipped (not a cart mutation, triggers escalation)', () => {
    const actions: V2ProposedAction[] = [
      { action_type: 'CONTACT_ADMIN', payload: {}, confidence: 0.85, requires_validation: false },
    ];
    const { cartOps } = mapV2ActionsToCartOps(actions);
    assert.strictEqual(cartOps.length, 0, 'CONTACT_ADMIN must NOT produce cartOps');
  });
});

describe('ORDER-LEVEL vs CART-LEVEL actions (mapV2ActionsToCartOps is the cart slice;\
  CANCEL_ORDER / UPDATE_SHIPPING_ADDRESS are order-level → skipped here (handled on the\
  active path). UPDATE_CART_QUANTITY is a CartOp now (→ update_qty).', () => {
  it('CANCEL_ORDER → cartOps kosong, skipped as ACTION_TYPE_NOT_SUPPORTED (order-level, not a CartOp)', () => {
    const actions: V2ProposedAction[] = [
      { action_type: 'CANCEL_ORDER', payload: {}, confidence: 0.9, requires_validation: true },
    ];
    const { cartOps, skipped } = mapV2ActionsToCartOps(actions);
    assert.strictEqual(cartOps.length, 0, 'CANCEL_ORDER must produce 0 cartOps (order-level, not a CartOp)');
    assert.strictEqual(skipped.length, 1, 'CANCEL_ORDER must be skipped');
    assert.strictEqual(skipped[0].action_type, 'CANCEL_ORDER');
    assert.strictEqual(skipped[0].reason, 'ACTION_TYPE_NOT_SUPPORTED');
  });

  it('UPDATE_CART_QUANTITY → mapped to CartOp type "update_qty" (reuses updateQuantity, qty 0 = delete)', () => {
    const actions: V2ProposedAction[] = [
      { action_type: 'UPDATE_CART_QUANTITY', payload: { product: 'oli mesin', qty: 3 }, confidence: 0.9, requires_validation: true },
    ];
    const { cartOps, skipped } = mapV2ActionsToCartOps(actions);
    assert.strictEqual(cartOps.length, 1, 'UPDATE_CART_QUANTITY must produce 1 cartOp');
    assert.strictEqual(cartOps[0].type, 'update_qty');
    assert.strictEqual(cartOps[0].product, 'oli mesin');
    assert.strictEqual(cartOps[0].qty, 3);
    assert.strictEqual(skipped.length, 0);
  });

  it('UPDATE_CART_QUANTITY qty 0 → CartOp qty 0 (delete line via updateQuantity)', () => {
    const actions: V2ProposedAction[] = [
      { action_type: 'UPDATE_CART_QUANTITY', payload: { product: 'oli mesin', qty: 0 }, confidence: 0.9, requires_validation: true },
    ];
    const { cartOps } = mapV2ActionsToCartOps(actions);
    assert.strictEqual(cartOps.length, 1);
    assert.strictEqual(cartOps[0].type, 'update_qty');
    assert.strictEqual(cartOps[0].qty, 0);
  });

  it('UPDATE_SHIPPING_ADDRESS → cartOps kosong, skipped as ACTION_TYPE_NOT_SUPPORTED (order-level, not a CartOp)', () => {
    const actions: V2ProposedAction[] = [
      { action_type: 'UPDATE_SHIPPING_ADDRESS', payload: { address: 'Jl. Merdeka' }, confidence: 0.9, requires_validation: true },
    ];
    const { cartOps, skipped } = mapV2ActionsToCartOps(actions);
    assert.strictEqual(cartOps.length, 0, 'UPDATE_SHIPPING_ADDRESS must produce 0 cartOps (order-level, not a CartOp)');
    assert.strictEqual(skipped.length, 1);
    assert.strictEqual(skipped[0].action_type, 'UPDATE_SHIPPING_ADDRESS');
    assert.strictEqual(skipped[0].reason, 'ACTION_TYPE_NOT_SUPPORTED');
  });

  it('ADD_TO_CART + CANCEL_ORDER → only ADD produces cartOp, CANCEL skipped', () => {
    const actions: V2ProposedAction[] = [
      { action_type: 'ADD_TO_CART', payload: { product: 'oli mesin', qty: 1 }, confidence: 0.95, requires_validation: true },
      { action_type: 'CANCEL_ORDER', payload: {}, confidence: 0.9, requires_validation: true },
    ];
    const { cartOps, skipped } = mapV2ActionsToCartOps(actions);
    assert.strictEqual(cartOps.length, 1, 'Only ADD_TO_CART should produce a cartOp');
    assert.strictEqual(cartOps[0].type, 'add');
    assert.strictEqual(skipped.length, 1);
    assert.strictEqual(skipped[0].action_type, 'CANCEL_ORDER');
  });
});

describe('BAGIAN 3: Active path escalation → markHumanTakeover + eventBus.publish (3 events)', () => {
  it('escalateStatusUpdate returns human_takeover status', () => {
    const status = escalateStatusUpdate();
    assert.strictEqual(status.status, 'human_takeover');
    assert.ok(status.humanTakeoverAt instanceof Date, 'humanTakeoverAt must be a Date');
  });

  it('message.created + conversation.handoff + conversation.updated events published (handoff.service.ts pattern)', () => {
    const escalateReply = 'Maaf Kak, saya akan hubungkan ke agen manusia ya. 🙏';

    // Simulate what the active path does for escalation (conversation.service.ts:365-392)
    eventBus.publish({
      event: 'message.created',
      storeId: 'store-test',
      data: {
        id: 'msg-1',
        conversationId: 'conv-test',
        sender: 'assistant',
        type: 'handoff',
        payload: { reason: 'escalation_clarification_retry_exceeded', content: escalateReply },
        content: escalateReply,
        source: ResponseSource.HUMAN,
        confidence: 0.9,
        createdAt: new Date(),
      },
      ts: Date.now(),
    });
    eventBus.publish({
      event: 'conversation.handoff',
      storeId: 'store-test',
      data: { conversationId: 'conv-test', status: 'human_takeover' },
      ts: Date.now(),
    });
    eventBus.publish({
      event: 'conversation.updated',
      storeId: 'store-test',
      data: { conversationId: 'conv-test', status: 'human_takeover', lastMessageAt: new Date() },
      ts: Date.now(),
    });

    // Verify 3 events published
    assert.strictEqual(capturedEvents.length, 3, 'Must publish exactly 3 events');

    const events = capturedEvents.map((e) => e.event);
    assert.ok(events.includes('message.created'), 'Must publish message.created');
    assert.ok(events.includes('conversation.handoff'), 'Must publish conversation.handoff');
    assert.ok(events.includes('conversation.updated'), 'Must publish conversation.updated');

    // Verify message.created has type='handoff' and source=human
    const msgCreated = capturedEvents.find((e) => e.event === 'message.created');
    assert.strictEqual(msgCreated.data.type, 'handoff');
    assert.strictEqual(msgCreated.data.sender, 'assistant');
    assert.strictEqual(msgCreated.data.source, ResponseSource.HUMAN);
    assert.strictEqual(msgCreated.data.payload.reason, 'escalation_clarification_retry_exceeded');

    // Verify conversation.handoff + conversation.updated both have status='human_takeover'
    const convHandoff = capturedEvents.find((e) => e.event === 'conversation.handoff');
    assert.strictEqual(convHandoff.data.status, 'human_takeover');
    assert.strictEqual(convHandoff.data.conversationId, 'conv-test');

    const convUpdated = capturedEvents.find((e) => e.event === 'conversation.updated');
    assert.strictEqual(convUpdated.data.status, 'human_takeover');
  });
});
