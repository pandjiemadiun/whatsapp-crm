/**
 * V2-ENGINE-FIX-VERIFY — Focused re-run of scenarios 7 & 8
 * (variant_select_size_100_90_17 + variant_select_by_index)
 *
 * After P1-FIX-3: added Rule 13 (variant confirmation) + Rule 14 (intent consistency)
 * to v2-engine/prompt-builder.ts system prompt + 1 new few-shot (Contoh 5).
 *
 * Run: npx tsx --env-file=../../.env scripts/v2-engine-fix-verify.ts
 */
import { callV2Engine } from '../src/services/chat/v2-engine/engine-call.js';
import { buildLLMContext } from '../src/services/chat/v2-engine/context-builder.js';
import { llmGateway } from '../src/adapters/ai/llm-gateway.js';
import type { WorkspaceV2, HistoryTurn, DraftCartOp, PendingV2 } from '../src/services/chat/types-v2.js';
import type { V2EngineOutput } from '../src/services/chat/v2-engine/engine-call.js';

function freshWorkspace(): WorkspaceV2 {
  return {
    schema_version: 'canonical-v1',
    conversation_summary: '',
    pendings: [],
    draft_cart: [],
    resolved_facts: {},
    options_presented: [],
  };
}

function updateWorkspace(ws: WorkspaceV2, result: V2EngineOutput): void {
  if (result.summary_update) ws.conversation_summary = result.summary_update;

  for (const action of result.proposed_actions) {
    if (action.action_type === 'ADD_TO_CART') {
      const p = action.payload as { product?: string; qty?: number; variant?: string };
      if (p.product && typeof p.product === 'string' && p.product.trim().length > 0) {
        ws.draft_cart.push({
          action: 'add',
          product: p.product,
          qty: typeof p.qty === 'number' ? Math.max(1, Math.floor(p.qty)) : 1,
          qty_source: typeof p.qty === 'number' ? 'explicit' : 'default',
          status: 'confirmed',
          variant: p.variant || null,
        });
      }
    }
    if (action.action_type === 'REMOVE_FROM_CART') {
      const p = action.payload as { product?: string };
      if (p.product) {
        ws.draft_cart = ws.draft_cart.filter((op) => !(op.product.toLowerCase() === p.product!.toLowerCase() && op.action === 'add'));
      }
    }
  }

  if (result.needs_clarification && result.clarification_question) {
    ws.pendings.push({
      id: 'pending-' + Date.now(),
      question: result.clarification_question,
      options: [],
      status: 'active',
      attempts: 1,
      deferred_turns: 0,
      asked_at: new Date().toISOString(),
    });
  }

  if (!result.needs_clarification) {
    ws.pendings = ws.pendings.map((p) => (p.status === 'active' ? { ...p, status: 'resolved' as const } : p));
  }
}

async function runScenario(name: string, messages: string[]): Promise<void> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('SCENARIO: ' + name);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const ws = freshWorkspace();
  let history: HistoryTurn[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    console.log('\n  >> USER (turn ' + (i + 1) + '/' + messages.length + '): "' + msg + '"');

    const context = buildLLMContext({ recentHistory: history, workspace: ws, customerMessage: msg });
    const result = await callV2Engine(context, 'chat_primary', llmGateway);

    if (result.success) {
      const d = result.data;
      console.log('  [Turn ' + (i + 1) + '] SUCCESS');
      console.log('  intent:           "' + d.intent + '"');
      console.log('  confidence:       ' + d.confidence);
      console.log('  reply_text:       "' + d.reply_text + '"');
      console.log('  needs_clarification: ' + d.needs_clarification);
      console.log('  proposed_actions: [');
      if (d.proposed_actions.length > 0) {
        for (const a of d.proposed_actions) {
          console.log('    - ' + a.action_type + ' payload=' + JSON.stringify(a.payload) + ' conf=' + a.confidence + ' requires_validation=' + a.requires_validation);
        }
      } else {
        console.log('    (empty)');
      }
      console.log('  ]');
      console.log('  entities:         ' + JSON.stringify(d.entities.map((e) => ({ type: e.type, value: e.value, confidence: e.confidence }))));

      // Check Rule 14 consistency
      const hasMutation = d.proposed_actions.some((a) =>
        ['ADD_TO_CART', 'REMOVE_FROM_CART', 'UPDATE_CART_QUANTITY', 'CANCEL_ORDER'].includes(a.action_type),
      );
      if (hasMutation && d.needs_clarification && d.intent === 'clarification') {
        console.log('  ⚠️  RULE 14 VIOLATION: mutation action with needs_clarification=true and intent=clarification');
      }
      if (hasMutation && d.needs_clarification === false && d.intent === 'clarification') {
        console.log('  ⚠️  RULE 14 VIOLATION: mutation action present but intent=clarification (should be add_to_cart/modify_cart/cancel_order)');
      }

      updateWorkspace(ws, d);
      history.push({ role: 'user', content: msg });
      history.push({ role: 'assistant', content: d.reply_text });
    } else {
      console.log('  [Turn ' + (i + 1) + '] ERROR (' + result.error.type + '): ' + result.error.message.slice(0, 200));
      history.push({ role: 'user', content: msg });
      history.push({ role: 'assistant', content: '[ERROR]' });
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log('\n  --- Workspace after scenario ---');
  console.log('  draft_cart: ' + JSON.stringify(ws.draft_cart));
  console.log('  pendings: ' + JSON.stringify(ws.pendings.map((p) => ({ id: p.id, status: p.status }))));
  console.log('  summary: "' + ws.conversation_summary + '"');
  console.log('');
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('V2-ENGINE-FIX-VERIFY (post P1-FIX-3 prompt changes)');
  console.log('Focus: scenarios 7 & 8 (variant selection)');
  console.log('Timestamp: ' + new Date().toISOString());
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await runScenario('variant_select_size_100_90_17', [
    'ban dalam motor',
    '100/90-17',
    'ya',
  ]);

  await runScenario('variant_select_by_index', [
    'ban dalam motor',
    'yang pertama',
    'ya',
  ]);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('DONE — check output above for Rule 13 (variant confirmation) + Rule 14 (consistency)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(0);
}

main().catch((e) => {
  console.error('Script error:', e);
  process.exit(1);
});
