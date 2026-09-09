#!/usr/bin/env node
/**
 * UNIT6-B Unit 3 — CONTROLLED, MANUALLY-INVOKED smoke harness for the
 * mapV2ActionsToCartOps -> executeWaCartMutation wire.
 *
 * SAFETY: this script is NOT mounted in index.ts, NOT served by pm2, and NOT
 * reachable via any HTTP route (customer or admin). It exists solely so a human
 * can drive the real chain against a real (throwaway) DB session on the canary
 * store without flipping a store flag or entering any live v2 branch. Invoke
 * explicitly only:
 *
 *   npx tsx --env-file=../../.env scripts/v2-mapper-wire-smoke.ts '<JSON>'
 *
 * JSON body = V2MapperWireInput (see ../src/services/chat/v2-engine/v2-mapper-wire.ts).
 * Example (NOT_FOUND smoke — safe, mutates nothing):
 *   {"storeId":"store-a3cd7205","customerId":"08000000000","conversationId":"smoke-zzz-conv","clientMsgId":"smoke-zzz-cmk","channel":"web","proposedActions":[{"action_type":"ADD_TO_CART","payload":{"product":"zzz-nonexistent-smoke-product","qty":1},"confidence":0.9,"requires_validation":true}]}
 *
 * Prints the full envelope { cartOps, skipped, result:{ status, items, unresolved } }
 * as JSON so a run can inspect NOT_FOUND / AMBIGUOUS results.
 */
import { runV2MapperWirePath } from '../src/services/chat/v2-engine/v2-mapper-wire.js';
import type { V2MapperWireInput } from '../src/services/chat/v2-engine/v2-mapper-wire.js';

export async function main(argv: string[]): Promise<void> {
  // Locate the JSON body arg robustly: `npx tsx` may place the script path or the
  // JSON at different positions in process.argv, so find the first '{'-prefixed arg.
  const raw = argv.find((a) => a.startsWith('{'));
  if (!raw) {
    console.error('usage: v2-mapper-wire-smoke.ts \'<V2MapperWireInput JSON>\'');
    process.exit(2);
  }

  const input = JSON.parse(raw) as V2MapperWireInput;

  // Lazily load the real executor so merely importing this CLI (e.g. in a test
  // runner) never triggers action-registry / prisma initialization. The CLI is
  // the only consumer that needs the real executeWaCartMutation.
  const { executeWaCartMutation } = await import('../src/business/action-registry.js');

  const out = await runV2MapperWirePath(input, executeWaCartMutation);
  // Flush the full envelope to stdout, then exit explicitly. The lazily-loaded
  // action-registry.js opens a Prisma client + Redis connection that would
  // otherwise keep the event loop alive and hang `npx tsx` on a *successful* run
  // (the FK-error runs exited via the .catch() -> process.exit(1) path).
  process.stdout.write(JSON.stringify(out, null, 2) + '\n', () => process.exit(0));
}

// Run only when executed directly as a script (not when merely imported).
if (process.argv[1] && process.argv[1].endsWith('v2-mapper-wire-smoke.ts')) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
