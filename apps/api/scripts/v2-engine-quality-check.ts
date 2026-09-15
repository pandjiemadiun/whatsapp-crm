/**
 * V2-ENGINE-ISOLATED-QUALITY-CHECK (enhanced with timing + prompt length)
 *
 * Calls callV2Engine() directly (bypass conversation.service.ts).
 * Runs 10 representative scenarios turn-by-turn.
 * Captures: prompt length per turn, response time per turn, intent/confidence/actions/reply.
 *
 * Run: npx tsx --env-file=../../.env scripts/v2-engine-quality-check.ts
 */
import { callV2Engine } from '../src/services/chat/v2-engine/engine-call.js';
import { buildLLMContext } from '../src/services/chat/v2-engine/context-builder.js';
import { buildV2Prompt, V2_ENGINE_SYSTEM_PROMPT, V2_ENGINE_FEW_SHOTS } from '../src/services/chat/v2-engine/prompt-builder.js';
import { llmGateway } from '../src/adapters/ai/llm-gateway.js';
import type { WorkspaceV2, HistoryTurn, DraftCartOp, PendingV2 } from '../src/services/chat/types-v2.js';
import type { V2EngineOutput, V2EngineResult } from '../src/services/chat/v2-engine/engine-call.js';

// ─── Helper: fresh empty workspace ──────────────────────────────────────────
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

// ─── Helper: update workspace from V2 engine output ─────────────────────────
function updateWorkspace(ws: WorkspaceV2, result: V2EngineOutput): void {
  if (result.summary_update) {
    ws.conversation_summary = result.summary_update;
  }

  for (const action of result.proposed_actions) {
    if (action.action_type === 'ADD_TO_CART') {
      const payload = action.payload as { product?: string; qty?: number; variant?: string };
      if (payload.product && typeof payload.product === 'string' && payload.product.trim().length > 0) {
        const op: DraftCartOp = {
          action: 'add',
          product: payload.product,
          qty: typeof payload.qty === 'number' ? Math.max(1, Math.floor(payload.qty)) : 1,
          qty_source: typeof payload.qty === 'number' ? 'explicit' : 'default',
          status: 'confirmed',
          variant: payload.variant || null,
        };
        ws.draft_cart.push(op);
      }
    }
    if (action.action_type === 'REMOVE_FROM_CART') {
      const payload = action.payload as { product?: string };
      if (payload.product) {
        ws.draft_cart = ws.draft_cart.filter(
          (op) => !(op.product.toLowerCase() === payload.product!.toLowerCase() && op.action === 'add')
        );
      }
    }
  }

  if (result.needs_clarification && result.clarification_question) {
    const pending: PendingV2 = {
      id: `pending-${Date.now()}`,
      question: result.clarification_question,
      options: [],
      status: 'active',
      attempts: 1,
      deferred_turns: 0,
      asked_at: new Date().toISOString(),
    };
    ws.pendings.push(pending);
  }

  if (!result.needs_clarification) {
    ws.pendings = ws.pendings.map((p) =>
      p.status === 'active' ? { ...p, status: 'resolved' as const } : p
    );
  }
}

// ─── 10 Scenarios (same as before) ──────────────────────────────────────────
const scenarios: { id: string; category: string; messages: string[]; notes?: string }[] = [
  { id: 'pinq_single_product_price', category: 'product_inquiry', messages: ['Ban dalam motor berapa harganya?'] },
  { id: 'pinq_stock_check', category: 'product_inquiry', messages: ['Stok kampas rem depan masih ada?'] },
  { id: 'cart_add_single_product', category: 'add_to_cart_via_teks', messages: ['saya mau beli Busi Motor'] },
  { id: 'cart_add_with_quantity', category: 'add_to_cart_via_teks', messages: ['saya mau beli Ban Dalam Motor 2 buah'] },
  { id: 'trap_panji_dagangan', category: 'clarification_trap', messages: ['ban dalam motor', 'ya', 'saya mau bayar', 'Panji dagangan'], notes: 'Panji = nama, bukan cancel' },
  { id: 'trap_ga_jadi_as_name', category: 'clarification_trap', messages: ['ban dalam motor', 'ya', 'saya mau bayar', 'ga jadi deh, batal aja'], notes: 'ga jadi = clarification, bukan cancel_order langsung' },
  { id: 'variant_select_size_100_90_17', category: 'variant_selection', messages: ['ban dalam motor', '100/90-17', 'ya'], notes: 'variant via spec ukuran' },
  { id: 'variant_select_by_index', category: 'variant_selection', messages: ['ban dalam motor', 'yang pertama', 'ya'], notes: 'variant via indeks' },
  { id: 'implicit_ref_relative_price_cheapest', category: 'implicit_reference', messages: ['mau ban dalam sama oli', 'ok mau yang mana dulu', 'yang murah aja'], notes: 'resolve ke produk termurah' },
  { id: 'implicit_ref_itu_plus_new_item', category: 'implicit_reference', messages: ['busi ada?', 'ada', 'itu aja deh, sama satu lagi ban dalam'], notes: '"itu" = produk sebelumnya, tambah 1 item baru' },
];

// ─── Stats collection ───────────────────────────────────────────────────────
interface TurnStat {
  scenarioId: string;
  category: string;
  turn: number;
  message: string;
  promptLen: number;
  systemPromptLen: number;
  contextLen: number;
  elapsedMs: number | null;
  success: boolean;
  intent?: string;
  confidence?: number;
  replyText?: string;
  proposedActions?: string;
  errorType?: string;
}

const allStats: TurnStat[] = [];

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const runLabel = process.env.RUN_LABEL || 'RUN-1';
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('V2-ENGINE-ISOLATED-QUALITY-CHECK [' + runLabel + ']');
  console.log('Method: callV2Engine() direct call (bypass conversation.service.ts)');
  console.log('Timestamp: ' + new Date().toISOString());
  console.log('System prompt: ' + V2_ENGINE_SYSTEM_PROMPT.length + ' chars');
  console.log('Few-shots: ' + V2_ENGINE_FEW_SHOTS.length + ' examples');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (const scenario of scenarios) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('SCENARIO: ' + scenario.id + ' [' + scenario.category + ']');
    if (scenario.notes) console.log('Notes: ' + scenario.notes);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const workspace = freshWorkspace();
    let history: HistoryTurn[] = [];

    for (let i = 0; i < scenario.messages.length; i++) {
      const msg = scenario.messages[i];
      console.log('\n  >> USER (turn ' + (i + 1) + '/' + scenario.messages.length + '): "' + msg + '"');

      const context = buildLLMContext({
        recentHistory: history,
        workspace,
        customerMessage: msg,
      });

      const prompt = buildV2Prompt(context);
      const promptLen = Buffer.byteLength(prompt, 'utf-8');
      const contextLen = Buffer.byteLength(context, 'utf-8');

      const start = Date.now();
      let result: V2EngineResult;
      try {
        result = await callV2Engine(context, 'chat_primary', llmGateway);
      } catch (e) {
        result = {
          success: false,
          error: { type: 'provider_exhausted', message: String(e), failedProviders: [] },
        } as any;
      }
      const elapsed = Date.now() - start;

      // Stats
      const stat: TurnStat = {
        scenarioId: scenario.id,
        category: scenario.category,
        turn: i + 1,
        message: msg,
        promptLen,
        systemPromptLen: V2_ENGINE_SYSTEM_PROMPT.length,
        contextLen,
        elapsedMs: result.success ? elapsed : null,
        success: result.success,
      };

      if (result.success) {
        const d = result.data;
        stat.intent = d.intent;
        stat.confidence = d.confidence;
        stat.replyText = d.reply_text;
        stat.proposedActions = JSON.stringify(d.proposed_actions);

        console.log('  [Turn ' + (i + 1) + '] SUCCESS | prompt=' + promptLen + 'c | ' + elapsed + 'ms');
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
        console.log('  uncertainty_signals: ' + JSON.stringify(d.uncertainty_signals));
        console.log('  summary_update:   "' + (d.summary_update || '(none)') + '"');

        updateWorkspace(workspace, d);
        history.push({ role: 'user', content: msg });
        history.push({ role: 'assistant', content: d.reply_text });
      } else {
        stat.errorType = result.error.type;
        console.log('  [Turn ' + (i + 1) + '] ERROR (' + result.error.type + ') | prompt=' + promptLen + 'c | ' + elapsed + 'ms');
        console.log('  error message: ' + result.error.message.slice(0, 300));
        console.log('  rawOutput: ' + (result.error.rawOutput ? result.error.rawOutput.slice(0, 300) : '(none)'));
        history.push({ role: 'user', content: msg });
        history.push({ role: 'assistant', content: '[ERROR: no valid response]' });
      }

      allStats.push(stat);

      // Delay between turns
      await new Promise((r) => setTimeout(r, 1500));
    }

    // Post-scenario workspace
    console.log('\n  --- Workspace after scenario ---');
    console.log('  draft_cart: ' + JSON.stringify(workspace.draft_cart));
    console.log('  pendings: ' + JSON.stringify(workspace.pendings.map((p) => ({ id: p.id, status: p.status }))));
    console.log('  summary: "' + workspace.conversation_summary + '"');
    console.log('');

    // Delay between scenarios
    await new Promise((r) => setTimeout(r, 2000));
  }

  // ─── Timing summary ───────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TIMING SUMMARY [' + runLabel + ']');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const successTurns = allStats.filter((s) => s.success);
  const failTurns = allStats.filter((s) => !s.success);

  console.log('\nAll turns (prompt length + response time):');
  console.log('┌──────────┬───────┬──────┬──────┬──────────┬────────────┬──────────┐');
  console.log('│ Scenario │ Turn  │ Cat  │ Len(c) │ Time(ms)  │ Intent     │ Status │');
  console.log('├──────────┼───────┼──────┼──────┼──────────┼────────────┼──────────┤');
  for (const s of allStats) {
    const cat = s.category.substring(0, 6).padEnd(6);
    const time = s.elapsedMs !== null ? s.elapsedMs.toString() : 'TIMEOUT';
    console.log('│ ' + s.scenarioId.padEnd(9).slice(0, 9) + ' │ ' + s.turn + '     │ ' + cat + ' │ ' + s.promptLen.toString().padStart(6) + ' │ ' + time.toString().padStart(10) + ' │ ' + (s.intent || s.errorType || '—').toString().padEnd(10).slice(0, 10) + ' │ ' + (s.success ? 'OK' : 'FAIL').padEnd(8) + ' │');
  }
  console.log('└──────────┴───────┴──────┴──────┴──────────┴────────────┴──────────┘');

  if (successTurns.length > 0) {
    const times = successTurns.map((s) => s.elapsedMs!);
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    const max = Math.max(...times);
    const min = Math.min(...times);
    const mean = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    console.log('\nResponse time (successful turns only):');
    console.log('  Count: ' + successTurns.length);
    console.log('  Min:   ' + min + 'ms (' + (min / 1000).toFixed(2) + 's)');
    console.log('  Median:' + median + 'ms (' + (median / 1000).toFixed(2) + 's)');
    console.log('  Mean:  ' + mean + 'ms (' + (mean / 1000).toFixed(2) + 's)');
    console.log('  Max:   ' + max + 'ms (' + (max / 1000).toFixed(2) + 's)');
  }

  console.log('\nFailed turns:');
  for (const s of failTurns) {
    console.log('  ' + s.scenarioId + ' turn ' + s.turn + ': "' + s.message.slice(0, 30) + '" → ' + s.errorType + ' (prompt=' + s.promptLen + 'c, elapsed=' + (s.elapsedMs !== null ? s.elapsedMs + 'ms' : 'N/A') + ')');
  }

  if (allStats.length > 0) {
    const allPromptLens = allStats.map((s) => s.promptLen);
    const allSuccessLens = successTurns.map((s) => s.promptLen);
    const allFailLens = failTurns.map((s) => s.promptLen);
    console.log('\nPrompt length analysis:');
    console.log('  All turns: min=' + Math.min(...allPromptLens) + ' max=' + Math.max(...allPromptLens) + ' mean=' + Math.round(allPromptLens.reduce((a, b) => a + b, 0) / allPromptLens.length));
    console.log('  Success turns: min=' + Math.min(...allSuccessLens) + ' max=' + Math.max(...allSuccessLens) + ' mean=' + Math.round(allSuccessLens.reduce((a, b) => a + b, 0) / allSuccessLens.length));
    if (allFailLens.length > 0) {
      console.log('  Fail turns:    min=' + Math.min(...allFailLens) + ' max=' + Math.max(...allFailLens) + ' mean=' + Math.round(allFailLens.reduce((a, b) => a + b, 0) / allFailLens.length));
    } else {
      console.log('  Fail turns:    none');
    }
  }

  // Write stats to JSON for cross-run comparison
  const fs = await import('node:fs/promises');
  const outputFile = 'scripts/_tmp_v2_quality_stats_' + runLabel + '.json';
  await fs.writeFile(outputFile, JSON.stringify(allStats, null, 2));
  console.log('\nStats written to: ' + outputFile);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('DONE [' + runLabel + '] — ' + allStats.length + ' turns total (' + successTurns.length + ' success, ' + failTurns.length + ' fail)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(0);
}

main().catch((e) => {
  console.error('Script error:', e);
  process.exit(1);
});
