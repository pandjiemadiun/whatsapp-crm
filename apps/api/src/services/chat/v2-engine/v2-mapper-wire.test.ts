/**
 * Unit tests for the Unit 3 mapper->executor wire (UNIT6-B Unit 3).
 *
 * HERMETIC: `executeCartMutation` is injected as a mock (see makeMockExecutor),
 * so NO database / Redis / HTTP is touched. Runs under tsx/node:test directly:
 *
 *   npx tsx --env-file=../../.env --test src/services/chat/v2-engine/v2-mapper-wire.test.ts
 *
 * (Intentionally NOT under src/services/chat/__tests__ or src/services/chat/tests,
 *  so jest's testMatch does not collect it — the chat baseline stays 271; these
 *  cases are reported separately, like the Unit 2 mapper test.)
 *
 * Verifies: mapV2ActionsToCartOps (Unit 2, unmodified) -> executeCartMutation
 * (Unit 2a signature, unmodified) with the exact resolved CartOp[] + args, and
 * that the executor's { status, items, unresolved } is propagated verbatim.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runV2MapperWirePath } from './v2-mapper-wire.js';
import type { V2CartExecutor, V2MapperWireInput } from './v2-mapper-wire.js';
import type { WaCartMutationResult } from '../../../business/action-registry.js';
import type { V2ProposedAction } from './schema.js';

const STORE = 'store-a3cd7205';
const CUST = '08000000000';
const CONV = 'smoke-conv';
const CMK = 'smoke-cmk';
const OK: WaCartMutationResult = { status: 'applied', items: [], unresolved: [] };

function makeMockExecutor(
  retval: WaCartMutationResult,
): { exec: V2CartExecutor; calls: Parameters<V2CartExecutor>[] } {
  const calls: Parameters<V2CartExecutor>[] = [];
  const exec: V2CartExecutor = (ops, storeId, customerId, conversationId, messageId, channel) => {
    calls.push([ops, storeId, customerId, conversationId, messageId, channel]);
    return Promise.resolve(retval);
  };
  return { exec, calls };
}

/** Build a minimal valid V2ProposedAction with required_validation: true. */
function proposed(
  action_type: V2ProposedAction['action_type'],
  payload: Record<string, unknown>,
  overrides: Partial<V2ProposedAction> = {},
): V2ProposedAction {
  return { action_type, payload, confidence: 0.9, requires_validation: true, ...overrides };
}

describe('runV2MapperWirePath', () => {
  it('chains a valid ADD_TO_CART: mapper output -> executor(args) + channel defaults to web + result propagated', async () => {
    const { exec, calls } = makeMockExecutor({ ...OK, items: [] });
    const out = await runV2MapperWirePath(
      {
        storeId: STORE,
        customerId: CUST,
        conversationId: CONV,
        clientMsgId: CMK,
        // channel deliberately omitted -> must default to 'web'
        proposedActions: [
          proposed('ADD_TO_CART', { product: 'ayam', qty: 2, variant: 'merah size L' }),
        ],
      },
      exec,
    );

    // 1 cartOp produced by the mapper, forwarded verbatim to the executor.
    assert.equal(out.cartOps.length, 1);
    assert.deepEqual(out.cartOps[0], {
      type: 'add',
      product: 'ayam',
      qty: 2,
      variant: 'merah size L',
    });
    assert.equal(out.skipped.length, 0);

    // Executor called ONCE, with the exact resolved args (channel='web' default).
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], [out.cartOps, STORE, CUST, CONV, CMK, 'web']);

    // Result envelope propagated unchanged.
    assert.deepEqual(out.result, { ...OK, items: [] });
  });

  it('propagates NOT_FOUND (resolution failure) from the executor as unresolved', async () => {
    const notFound: WaCartMutationResult = {
      status: 'applied',
      items: [],
      unresolved: [{ product: 'zzz-nonexistent-smoke-product', reason: 'NOT_FOUND' }],
    };
    const { exec, calls } = makeMockExecutor(notFound);
    const out = await runV2MapperWirePath(
      {
        storeId: STORE,
        customerId: CUST,
        conversationId: CONV,
        clientMsgId: CMK,
        channel: 'web',
        proposedActions: [proposed('ADD_TO_CART', { product: 'zzz-nonexistent-smoke-product', qty: 1 })],
      },
      exec,
    );

    assert.equal(out.cartOps.length, 1);
    assert.equal(out.cartOps[0].product, 'zzz-nonexistent-smoke-product');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0][0], out.cartOps); // args[0] is the full cartOps array (mapper output)
    // Executor's NOT_FOUND is surfaced verbatim (NOT swallowed by the wire).
    assert.deepEqual(out.result, notFound);
    assert.deepEqual(out.result.unresolved, [
      { product: 'zzz-nonexistent-smoke-product', reason: 'NOT_FOUND' },
    ]);
  });

  it('maps CANCEL_ORDER to a skip -> empty cartOps -> executor called with []', async () => {
    const { exec, calls } = makeMockExecutor({ ...OK });
    const out = await runV2MapperWirePath(
      {
        storeId: STORE,
        customerId: CUST,
        conversationId: CONV,
        clientMsgId: CMK,
        proposedActions: [proposed('CANCEL_ORDER', { order_id: 'o1' })],
      },
      exec,
    );

    // CANCEL_ORDER is out of scope -> zero cart ops, one skip.
    assert.equal(out.cartOps.length, 0);
    assert.equal(out.skipped.length, 1);
    // Skip entries also carry a free-form `detail` string — assert the contract fields only.
    assert.equal(out.skipped[0].action_type, 'CANCEL_ORDER');
    assert.equal(out.skipped[0].reason, 'ACTION_TYPE_NOT_SUPPORTED');
    // Executor still invoked (with the empty op list) — the wire never short-circuits.
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0][0], []); // args[0] is the (empty) cartOps array
    assert.deepEqual(out.result, OK);
  });

  it('forwards an explicit channel (whatsapp) to the executor, not the default web', async () => {
    const { exec, calls } = makeMockExecutor({ ...OK });
    const out = await runV2MapperWirePath(
      {
        storeId: STORE,
        customerId: CUST,
        conversationId: CONV,
        clientMsgId: CMK,
        channel: 'whatsapp',
        proposedActions: [proposed('REMOVE_FROM_CART', { product: 'telur', qty: 1 })],
      },
      exec,
    );

    assert.equal(out.cartOps.length, 1);
    assert.deepEqual(out.cartOps[0], { type: 'remove', product: 'telur', qty: 1, variant: null });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][5], 'whatsapp'); // 6th arg = channel
    assert.deepEqual(out.result, OK);
  });
});
