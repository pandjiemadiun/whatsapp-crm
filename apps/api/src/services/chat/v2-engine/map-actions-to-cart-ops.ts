/**
 * mapV2ActionsToCartOps — Unit 6-A Step 2 (UNIT6-B Unit 2).
 *
 * A thin, PURE translation (v2 ProposedAction[] -> CartOp[]) for the v2 chat engine's
 * cart-mutation slice. It is intentionally UN-WIRED: it produces { cartOps, skipped }
 * only; nothing imports it yet (verified: `grep -rn mapV2ActionsToCartOps src -- ts`
 * excluding tests returns nothing). CartAuthority.executeOps() remains the ONLY mutation
 * entry point (PROJECT-CONTRACT-STRUCTURED-ACTIONS.md §6A.1) and is NOT modified here.
 *
 * Scope (this iteration): ADD_TO_CART, REMOVE_FROM_CART, and UPDATE_CART_QUANTITY
 * (→ CartOp.type 'update_qty', reusing CartAuthority.updateQuantity).
 * CANCEL_ORDER is explicitly OUT OF SCOPE for this mapper (order-level; handled
 * by the active path via handleCancelOrder).
 *
 * Product resolution policy (Unit C): payload.product is FREE TEXT (a product name /
 * token like 'ayam' or 'ban dalam 2'), NOT a UUID. The mapper does NOT resolve it —
 * it forwards CartOp.product verbatim (productId left undefined), and CartOp.productId
 * is omitted so CartAuthority.executeOps falls back to resolveProductByName()
 * (cart-authority.ts:637), the EXISTING by-name resolver the V1 pipeline already uses
 * (conversation.service.ts:328-337 builds the same CartOp shape -> executeWaCartMutation
 * -> cartAuthority.executeOps). This mapper reuses that resolver — no new resolver is
 * invented. On resolution failure the existing resolver returns
 * UnresolvedCartOp { reason: 'NOT_FOUND' } (clean rejection, NOT a silent skip / NOT a
 * closest-product guess) — cart-authority.ts:645-649.
 *
 * qty policy: default 1; fractional values are floored; non-numeric / non-finite -> 1;
 * values < 1 are clamped to 1 (a cart line of qty 0/ negative is meaningless). This
 * mirrors cart-authority.executeOps:647 (`op.qty && op.qty >= 1 ? Math.floor(op.qty) : 1`).
 */
import type { CartOp } from '../../../domain/types.js';
import type { V2ProposedAction } from './schema.js';

export type SkipReasonCode =
  | 'REQUIRES_VALIDATION_FALSE'
  | 'ACTION_TYPE_NOT_SUPPORTED'
  | 'INVALID_PRODUCT_PAYLOAD';

export interface SkipReason {
  action_type: V2ProposedAction['action_type'];
  reason: SkipReasonCode;
  /** Human-readable context (does not affect execution; for logs/tests only). */
  detail?: string;
}

export interface MapV2ActionsResult {
  cartOps: CartOp[];
  skipped: SkipReason[];
}

/** Action types this iteration maps to cart ops. */
const MUTATION_ACTION_TYPES: ReadonlySet<V2ProposedAction['action_type']> = new Set([
  'ADD_TO_CART',
  'REMOVE_FROM_CART',
  // PV-P2b: UPDATE_CART_QUANTITY now routes through CartOp.type 'update_qty'
  // → CartAuthority.executeOps reuses updateQuantity (qty 0 = delete line).
  // It is NO LONGER skipped; the active path executes it alongside add/remove.
  'UPDATE_CART_QUANTITY',
]);

/** Extract a non-empty, trimmed free-text product string. null = invalid payload. */
function extractProduct(payload: Record<string, unknown>): string | null {
  const v = payload.product;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * qty: default 1; fractional -> floored; non-numeric/non-finite -> 1; clamped to >= 1.
 * Never throws (invalid input degrades to the safe default of 1).
 * Used by ADD_TO_CART ('add') — a cart line of qty 0/ negative is meaningless.
 */
function normalizeQty(payload: Record<string, unknown>): number {
  const v = payload.qty;
  if (v === undefined || v === null) return 1;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 1;
  const floored = Math.floor(n);
  return floored < 1 ? 1 : floored;
}

/**
 * qty for UPDATE_CART_QUANTITY ('update_qty'): 0 = delete line item (reuse
 * CartAuthority.updateQuantity qty===0 branch); positive = set exact quantity.
 * Fractional -> floored; non-numeric/non-finite -> 1 (safe default); negative
 * clamped to 0 (delete) so we never pass a negative into updateQuantity
 * (which would throw INVALID_QUANTITY). The line-item existence / qty>=0
 * invariants are enforced in cart-authority at execution.
 */
function normalizeUpdateQty(payload: Record<string, unknown>): number {
  const v = payload.qty;
  if (v === undefined || v === null) return 1;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 1;
  const floored = Math.floor(n);
  return floored < 0 ? 0 : floored; // allow 0 (delete), clamp negative -> 0
}

/**
 * variant: free-text label forwarded verbatim (trimmed), or null. null/undefined/
 * non-string -> null. cart-authority.resolveVariantByLabel (cart-authority.ts:1234) maps
 * this label to a variantId downstream; the mapper does not touch variantId.
 */
function extractVariant(payload: Record<string, unknown>): string | null {
  const v = payload.variant;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * Map V2 engine proposed actions -> CartOps for CartAuthority.executeOps.
 *
 * - Order-preserving: surviving actions are emitted in input order (cartOps AND skipped
 *   each preserve their relative input order).
 * - Never throws: every malformed/unmapped action lands in `skipped`, not an exception.
 * - MUTATION TRUST POLICY (anti-hallucination): for action_types that are in OUR internal
 *   mutation set (ADD_TO_CART / REMOVE_FROM_CART / UPDATE_CART_QUANTITY), the mapper
 *   FORCES requires_validation=true and IGNORES the LLM's requires_validation flag
 *   entirely. A hallucinated or erroneous requires_validation:false on a real cart
 *   mutation must NOT silently drop it. The LLM's requires_validation is only honored for
 *   NON-mutation (read-only) action types (e.g. OPEN_CART).
 * - requires_validation===false read-only actions (e.g. OPEN_CART) are skipped — the
 *   mutation path is for mutations only. The CALLER may pre-filter these, but this guard
 *   is defensive (a read-only action must NOT reach a mutation).
 * - CANCEL_ORDER / SHOW_RELATED_PRODUCTS / etc. -> ACTION_TYPE_NOT_SUPPORTED (out of scope
 *   for this iteration; order-level actions handled by the active path separately).
 */
export function mapV2ActionsToCartOps(actions: V2ProposedAction[]): MapV2ActionsResult {
  const cartOps: CartOp[] = [];
  const skipped: SkipReason[] = [];

  for (const a of actions) {
    // 1. MUTATION action types (our internal list) are ALWAYS executed — the mapper
    //    FORCES requires_validation=true for them and refuses to trust the LLM's
    //    requires_validation flag for anything that mutates cart state. A
    //    hallucinated/erroneous requires_validation:false on ADD_TO_CART/REMOVE/
    //    UPDATE_CART_QUANTITY must NOT silently drop a real cart mutation.
    if (MUTATION_ACTION_TYPES.has(a.action_type)) {
      const product = extractProduct(a.payload);
      if (product === null) {
        skipped.push({
          action_type: a.action_type,
          reason: 'INVALID_PRODUCT_PAYLOAD',
          detail: 'payload.product is missing or not a non-empty string; cannot resolve to a product',
        });
        continue;
      }
      const isUpdateQty = a.action_type === 'UPDATE_CART_QUANTITY';
      cartOps.push({
        type: isUpdateQty
          ? 'update_qty'
          : (a.action_type === 'ADD_TO_CART' ? 'add' : 'remove'),
        product,
        qty: isUpdateQty ? normalizeUpdateQty(a.payload) : normalizeQty(a.payload),
        variant: extractVariant(a.payload),
      });
      continue;
    }

    // 2. Non-mutation (read-only) action types: honor the LLM's requires_validation.
    //    requires_validation===false -> not a cart-mutation (e.g. OPEN_CART); skip.
    if (a.requires_validation === false) {
      skipped.push({
        action_type: a.action_type,
        reason: 'REQUIRES_VALIDATION_FALSE',
        detail: 'requires_validation is false; action is not routed to the cart-mutation path',
      });
      continue;
    }

    // 3. Remaining action types are out of scope for this mapper (read-only or
    //    unsupported). CANCEL_ORDER / order-level actions are handled by the active
    //    path separately; read-only types (SHOW_RELATED_PRODUCTS, etc.) are not cart-ops.
    skipped.push({
      action_type: a.action_type,
      reason: 'ACTION_TYPE_NOT_SUPPORTED',
      detail: `action_type '${a.action_type}' is outside this iteration's scope (ADD_TO_CART|REMOVE_FROM_CART|UPDATE_CART_QUANTITY)`,
    });
  }

  return { cartOps, skipped };
}
