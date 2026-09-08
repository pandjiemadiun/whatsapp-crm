/**
 * mapV2ActionsToCartOps — Unit 6-A Step 2 (UNIT6-B Unit 2).
 *
 * A thin, PURE translation (v2 ProposedAction[] -> CartOp[]) for the v2 chat engine's
 * cart-mutation slice. It is intentionally UN-WIRED: it produces { cartOps, skipped }
 * only; nothing imports it yet (verified: `grep -rn mapV2ActionsToCartOps src -- ts`
 * excluding tests returns nothing). CartAuthority.executeOps() remains the ONLY mutation
 * entry point (PROJECT-CONTRACT-STRUCTURED-ACTIONS.md §6A.1) and is NOT modified here.
 *
 * Scope (this iteration): ADD_TO_CART and REMOVE_FROM_CART ONLY. CANCEL_ORDER is
 * explicitly OUT OF SCOPE (mapped to ACTION_TYPE_NOT_SUPPORTED, never executed).
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

/** Action types this iteration maps to cart ops. CANCEL_ORDER is deliberately absent. */
const MUTATION_ACTION_TYPES: ReadonlySet<V2ProposedAction['action_type']> = new Set([
  'ADD_TO_CART',
  'REMOVE_FROM_CART',
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
 * - requires_validation===false actions (e.g. OPEN_CART) are skipped — the mutation path
 *   is for validated actions only. The CALLER should pre-filter these, but this guard
 *   is defensive (a requires_validation:false action must NOT reach a mutation).
 * - CANCEL_ORDER / UPDATE_CART_QUANTITY / etc. -> ACTION_TYPE_NOT_SUPPORTED (out of scope
 *   for this iteration).
 */
export function mapV2ActionsToCartOps(actions: V2ProposedAction[]): MapV2ActionsResult {
  const cartOps: CartOp[] = [];
  const skipped: SkipReason[] = [];

  for (const a of actions) {
    // 1. requires_validation=false -> not a cart-mutation action (e.g. OPEN_CART).
    if (a.requires_validation === false) {
      skipped.push({
        action_type: a.action_type,
        reason: 'REQUIRES_VALIDATION_FALSE',
        detail: 'requires_validation is false; action is not routed to the cart-mutation path',
      });
      continue;
    }

    // 2. Only ADD_TO_CART / REMOVE_FROM_CART are in scope (CANCEL_ORDER explicitly out).
    if (!MUTATION_ACTION_TYPES.has(a.action_type)) {
      skipped.push({
        action_type: a.action_type,
        reason: 'ACTION_TYPE_NOT_SUPPORTED',
        detail: `action_type '${a.action_type}' is outside this iteration's scope (ADD_TO_CART|REMOVE_FROM_CART only)`,
      });
      continue;
    }

    // 3. Product must be a non-empty string (free text). Resolution is cart-authority's job.
    const product = extractProduct(a.payload);
    if (product === null) {
      skipped.push({
        action_type: a.action_type,
        reason: 'INVALID_PRODUCT_PAYLOAD',
        detail: 'payload.product is missing or not a non-empty string; cannot resolve to a product',
      });
      continue;
    }

    // 4. Build the CartOp (qty normalized; variant as free-text label or null).
    cartOps.push({
      type: a.action_type === 'ADD_TO_CART' ? 'add' : 'remove',
      product,
      qty: normalizeQty(a.payload),
      variant: extractVariant(a.payload),
    });
  }

  return { cartOps, skipped };
}
