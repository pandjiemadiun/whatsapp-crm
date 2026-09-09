/**
 * v2-mapper-wire — UNIT6-B Unit 3.
 *
 * EXPLICITLY OPT-IN, MANUALLY-INVOKED test path. This module is the thin
 * orchestration that connects Unit 2's `mapV2ActionsToCartOps` output to
 * Unit 2a's `executeWaCartMutation`. It is NOT wired into conversation.service.ts
 * (none of :252/:339/:519/:677 v2 branches) or any 'resolved'/'reasoned' branch,
 * NOT part of the shadow-observation logging path (buildShadowEntry), and
 * NOT mounted as an HTTP route. It is only reachable by explicitly invoking
 * the CLI runner (scripts/v2-mapper-wire-smoke.ts), which itself is not loaded
 * by index.ts / pm2.
 *
 * Contract (calls UNMODIFIED):
 *   - mapV2ActionsToCartOps(proposedActions)                          // Unit 2  (pure)
 *   - executeCartMutation(cartOps, storeId, customerId, conversationId,
 *                          clientMsgId, channel)                      // Unit 2a (real executeWaCartMutation)
 *
 * `executeCartMutation` is INJECTED (see V2CartExecutor) so the unit test can
 * assert the exact chain + argument passing WITHOUT touching the DB. The CLI
 * always passes the real `executeWaCartMutation`, loaded lazily so that importing
 * this module in tests never triggers action-registry / prisma initialization.
 *
 * qty / product / variant policy is ENTIRELY delegated to mapV2ActionsToCartOps
 * (Unit 2); this module only orders the two calls and returns the assembled
 * envelope. On a structurally-invalid action the mapper skips it (never throws);
 * executor errors propagate to the caller.
 */
import { mapV2ActionsToCartOps } from './map-actions-to-cart-ops.js';
import type { SkipReason } from './map-actions-to-cart-ops.js';
import type { CartOp } from '../../../domain/types.js';
import type { V2ProposedAction } from './schema.js';
import type { WaCartMutationResult } from '../../../business/action-registry.js';

/** Shape of the executor the wire calls — identical to `executeWaCartMutation`. */
export type V2CartExecutor = (
  ops: CartOp[],
  storeId: string,
  customerId: string,
  conversationId: string,
  messageId?: string,
  channel?: 'web' | 'whatsapp',
) => Promise<WaCartMutationResult>;

export interface V2MapperWireInput {
  storeId: string;
  customerId: string;
  conversationId: string;
  clientMsgId: string;
  /** Defaults to 'web' inside the chain (matches Unit 1 / PWA web channel). */
  channel?: 'web' | 'whatsapp';
  proposedActions: V2ProposedAction[];
}

export interface V2MapperWireOutput {
  cartOps: CartOp[];
  skipped: SkipReason[];
  result: WaCartMutationResult;
}

/**
 * Unit 3 core: mapV2ActionsToCartOps (Unit 2, unmodified) ->
 * executeCartMutation (Unit 2a, unmodified, injected). Order-preserving,
 * no re-ordering of ops, no extra transformation.
 */
export async function runV2MapperWirePath(
  input: V2MapperWireInput,
  executeCartMutation: V2CartExecutor,
): Promise<V2MapperWireOutput> {
  const { cartOps, skipped } = mapV2ActionsToCartOps(input.proposedActions);
  const result = await executeCartMutation(
    cartOps,
    input.storeId,
    input.customerId,
    input.conversationId,
    input.clientMsgId,
    input.channel ?? 'web',
  );
  return { cartOps, skipped, result };
}
