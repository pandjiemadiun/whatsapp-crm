/**
 * Unit tests for mapV2ActionsToCartOps (UNIT6-B Unit 2).
 *
 * Pure function (no DB / no LLM), so it runs under tsx directly:
 *   npx tsx --env-file=../../.env --test src/services/chat/v2-engine/map-actions-to-cart-ops.test.ts
 *
 * (NOT placed under src/services/chat/__tests__ or src/services/chat/tests, so jest's
 * testMatch does not pick it up — the chat baseline stays 271 and these 8 cases are
 * reported separately.)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapV2ActionsToCartOps } from './map-actions-to-cart-ops.js';
import type { V2ProposedAction } from './schema.js';

function action(
  overrides: Partial<V2ProposedAction> & Pick<V2ProposedAction, 'action_type'>,
): V2ProposedAction {
  return {
    requires_validation: true,
    confidence: 0.9,
    payload: {},
    ...overrides,
  };
}

describe('mapV2ActionsToCartOps', () => {
  it('maps a valid ADD_TO_CART to an add CartOp (product forwarded, qty kept, variant null)', () => {
    const { cartOps, skipped } = mapV2ActionsToCartOps([
      action({ action_type: 'ADD_TO_CART', payload: { product: 'ayam', qty: 2, variant: null } }),
    ]);
    assert.equal(skipped.length, 0, 'no skips for a valid ADD');
    assert.deepEqual(cartOps, [
      { type: 'add', product: 'ayam', qty: 2, variant: null },
    ]);
  });

  it('maps a valid REMOVE_FROM_CART to a remove CartOp', () => {
    const { cartOps, skipped } = mapV2ActionsToCartOps([
      action({ action_type: 'REMOVE_FROM_CART', payload: { product: 'ayam', qty: 1 } }),
    ]);
    assert.equal(skipped.length, 0, 'no skips for a valid REMOVE');
    assert.deepEqual(cartOps, [
      { type: 'remove', product: 'ayam', qty: 1, variant: null },
    ]);
  });

  it('forwards the variant free-text label verbatim (variantId left to cart-authority)', () => {
    const { cartOps } = mapV2ActionsToCartOps([
      action({ action_type: 'ADD_TO_CART', payload: { product: 'kaos', qty: 1, variant: 'merah size L' } }),
    ]);
    assert.deepEqual(cartOps, [
      { type: 'add', product: 'kaos', qty: 1, variant: 'merah size L' },
    ]);
  });

  it('normalizes qty: absent->1, fractional floored, non-numeric->1, <1->1, numeric string parsed', () => {
    const cases: Array<[string, unknown, number]> = [
      ['undefined (default)', undefined, 1],
      ['exact 2', 2, 2],
      ['fractional 2.9', 2.9, 2],
      ['zero', 0, 1],
      ['negative -3', -3, 1],
      ['null', null, 1],
      ['numeric string "3"', '3', 3],
      ['non-numeric "abc"', 'abc', 1],
      ['NaN', NaN, 1],
    ];
    for (const [label, input, expected] of cases) {
      const { cartOps } = mapV2ActionsToCartOps([
        action({ action_type: 'ADD_TO_CART', payload: { product: 'ayam', qty: input } }),
      ]);
      assert.equal(cartOps[0].qty, expected, `qty=${label} expected ${expected}, got ${cartOps[0].qty}`);
    }
  });

  it('skips requires_validation=false actions (e.g. OPEN_CART, OPEN_CATALOG) as REQUIRES_VALIDATION_FALSE', () => {
    const { cartOps, skipped } = mapV2ActionsToCartOps([
      action({ action_type: 'OPEN_CART', requires_validation: false, payload: {} }),
      action({ action_type: 'OPEN_CATALOG', requires_validation: false, payload: {} }),
    ]);
    assert.equal(cartOps.length, 0, 'no cart ops from non-validation actions');
    assert.equal(skipped.length, 2);
    assert.equal(skipped.every((s) => s.reason === 'REQUIRES_VALIDATION_FALSE'), true);
    assert.deepEqual(
      skipped.map((s) => s.action_type),
      ['OPEN_CART', 'OPEN_CATALOG'],
    );
  });

  it('skips out-of-scope action types (CANCEL_ORDER, UPDATE_CART_QUANTITY) as ACTION_TYPE_NOT_SUPPORTED', () => {
    const { cartOps, skipped } = mapV2ActionsToCartOps([
      action({ action_type: 'CANCEL_ORDER', payload: { order_id: 'o1' } }),
      action({ action_type: 'UPDATE_CART_QUANTITY', payload: { product: 'ayam', qty: 3 } }),
    ]);
    assert.equal(cartOps.length, 0, 'CANCEL_ORDER / UPDATE_CART_QUANTITY are NOT mapped to cart ops');
    assert.equal(skipped.length, 2);
    assert.equal(skipped.every((s) => s.reason === 'ACTION_TYPE_NOT_SUPPORTED'), true);
    assert.deepEqual(
      skipped.map((s) => s.action_type),
      ['CANCEL_ORDER', 'UPDATE_CART_QUANTITY'],
    );
  });

  it('skips actions with invalid product payloads as INVALID_PRODUCT_PAYLOAD', () => {
    const { cartOps, skipped } = mapV2ActionsToCartOps([
      action({ action_type: 'ADD_TO_CART', payload: {} }),                                 // missing
      action({ action_type: 'ADD_TO_CART', payload: { product: 123 } }),                   // non-string
      action({ action_type: 'ADD_TO_CART', payload: { product: '   ' } }),                 // whitespace
      action({ action_type: 'REMOVE_FROM_CART', payload: { product: null } }),            // null
    ]);
    assert.equal(cartOps.length, 0);
    assert.equal(skipped.length, 4);
    assert.equal(skipped.every((s) => s.reason === 'INVALID_PRODUCT_PAYLOAD'), true);
    assert.deepEqual(
      skipped.map((s) => s.action_type),
      ['ADD_TO_CART', 'ADD_TO_CART', 'ADD_TO_CART', 'REMOVE_FROM_CART'],
    );
  });

  it('preserves order across a mixed batch (valid ops + skips keep input order)', () => {
    const { cartOps, skipped } = mapV2ActionsToCartOps([
      action({ action_type: 'ADD_TO_CART', payload: { product: 'ayam', qty: 2 } }),          // -> cartOp
      action({ action_type: 'CANCEL_ORDER', payload: { order_id: 'o1' } }),                  // -> skip (not supported)
      action({ action_type: 'REMOVE_FROM_CART', payload: { product: 'telur', qty: 1 } }),    // -> cartOp
      action({ action_type: 'OPEN_CART', requires_validation: false, payload: {} }),       // -> skip (no validation)
      action({ action_type: 'ADD_TO_CART', payload: {} }),                                 // -> skip (bad product)
    ]);
    // 2 valid cart ops, in input order.
    assert.equal(cartOps.length, 2);
    assert.deepEqual(cartOps[0], { type: 'add', product: 'ayam', qty: 2, variant: null });
    assert.deepEqual(cartOps[1], { type: 'remove', product: 'telur', qty: 1, variant: null });
    // 3 skips, in input order — reasons AND action_types both ordered by input position.
    assert.equal(skipped.length, 3);
    assert.deepEqual(
      skipped.map((s) => s.reason),
      ['ACTION_TYPE_NOT_SUPPORTED', 'REQUIRES_VALIDATION_FALSE', 'INVALID_PRODUCT_PAYLOAD'],
    );
    assert.deepEqual(
      skipped.map((s) => s.action_type),
      ['CANCEL_ORDER', 'OPEN_CART', 'ADD_TO_CART'],
    );
  });
});
