/**
 * Generalization test for V2 engine — P2-UNIT4
 * src/routes/internal/v2-engine-generalization.ts
 *
 * 6 test messages designed to probe "ga" substring false-positive risk.
 * Uses the SAME Sep 2 checkout context (pending nama/alamat) as message #8.
 *
 * Run: npx tsx --env-file=../../.env src/routes/internal/v2-engine-generalization.ts
 */
import { prisma } from '../../infrastructure/prisma.js';
import { canonicalConversationStateService } from '../../business/canonical-context.service.js';
import { buildLLMContext } from '../../services/chat/v2-engine/context-builder.js';
import { callV2Engine } from '../../services/chat/v2-engine/engine-call.js';
import { llmGateway } from '../../adapters/ai/llm-gateway.js';
import { loadWorkspace } from '../../services/chat/workspace.js';
import type { HistoryTurn } from '../../services/chat/prompts-v2.js';
import type { WorkspaceV2 } from '../../services/chat/types-v2.js';

const CONVERSATION_ID = 'bbab7983-ddb3-40ef-b1a4-a12200566be5';
const MAX_TURNS = 10;

interface GeneralizationResult {
  no: number;
  message: string;
  contains_ga: boolean;
  v2_intent: string;
  v2_confidence: number;
  v2_reply_text: string;
  v2_proposed_actions: string;
  v2_entities: string;
  v2_needs_clarification: boolean;
  v2_success: boolean;
  v2_error_type?: string;
  v2_provider?: string;
  v2_model?: string;
  v2_is_cancel: boolean;
  expected_cancel: boolean;
  regression_pass: boolean;
}

// The 6 test messages
const TEST_MESSAGES: ReadonlyArray<{
  message: string;
  expectedCancel: boolean; // whether V2 SHOULD classify as cancel_order
  description: string;
}> = [
  {
    message: 'Rina anggun jaya',
    expectedCancel: false,
    description: 'Customer name, no "ga" substring — control positive',
  },
  {
    message: 'Budi gagal move on jl kenanga',
    expectedCancel: false,
    description: 'Contains "ga" in "gagal" (2x) — NOT a cancel intent, just saying "fail move on"',
  },
  {
    message: 'Toko sembako berkah jaya',
    expectedCancel: false,
    description: 'No "ga" — pure control negative',
  },
  {
    message: 'Anggara, Jl. Anggrek No 5',
    expectedCancel: false,
    description: 'Customer name "Anggara" (contains "ga") + address',
  },
  {
    message: 'ga jadi deh, batal aja',
    expectedCancel: true,
    description: 'TRUE cancel — explicit "ga jadi" + "batal aja" (positive control)',
  },
  {
    message: 'Pak gatot, jl gading',
    expectedCancel: false,
    description: 'Name "Gatot" (contains "ga") + address "gading" (contains "ga") — 2x "ga"',
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.error('=== V2 Generalization Test — "ga" Substring Robustness ===\n');
  console.error(`Conversation: ${CONVERSATION_ID}`);
  console.error('Context: Sep 2 checkout flow (pending nama/alamat)\n');

  // 1. Load workspace (READ-ONLY)
  let workspace = await canonicalConversationStateService.getV2Workspace(CONVERSATION_ID);
  if (!workspace) {
    workspace = loadWorkspace('{}');
    console.error('No conversation_context row — using default empty workspace\n');
  }

  // 2. Load full history (READ-ONLY)
  const rows = await prisma.conversationHistory.findMany({
    where: { conversationId: CONVERSATION_ID },
    orderBy: { createdAt: 'asc' },
  });

  const fullHistory: HistoryTurn[] = rows.map((r) => ({
    role: r.role as 'user' | 'assistant' | 'system',
    content: r.content,
  }));

  // 3. Find "Panji dagangan" position to get the checkout context
  const daganganIndex = fullHistory.findIndex(
    (t) => t.role === 'user' && t.content === 'Panji dagangan'
  );

  if (daganganIndex < 0) {
    console.error('FATAL: "Panji dagangan" not found in history!');
    await prisma.$disconnect();
    process.exit(1);
  }

  // Use the 20 turns BEFORE "Panji dagangan" as context (checkout flow)
  const startIdx = Math.max(0, daganganIndex - MAX_TURNS * 2);
  const recentHistory = fullHistory.slice(startIdx, daganganIndex);
  console.error(`Loaded ${fullHistory.length} history rows`);
  console.error(`Using ${recentHistory.length} context turns (checkout flow: pending nama/alamat)`);

  // Show key context (last 5 turns)
  console.error('Context (last 5 turns):');
  recentHistory.slice(-5).forEach((t, i) => {
    const role = t.role === 'user' ? 'CUSTOMER' : 'ASSISTANT';
    console.error(`  ${role}: ${t.content.slice(0, 70)}${t.content.length > 70 ? '...' : ''}`);
  });
  console.error('');

  // 4. Run each test message
  const results: GeneralizationResult[] = [];

  for (const [i, test] of TEST_MESSAGES.entries()) {
    console.error(`[${i + 1}/${TEST_MESSAGES.length}] "${test.message}"`);
    console.error(`  Description: ${test.description}`);
    console.error(`  Contains "ga": ${test.message.includes('ga')}`);

    try {
      const context = buildLLMContext({
        recentHistory,
        workspace: workspace!,
        customerMessage: test.message,
      });

      const result = await callV2Engine(context, 'chat_primary', llmGateway);

      if (result.success) {
        const isCancel = result.data.intent === 'cancel_order';
        const passed = test.expectedCancel === isCancel;
        console.error(`  → intent=${result.data.intent}, conf=${result.data.confidence}`);
        console.error(`  → is_cancel=${isCancel}, expected_cancel=${test.expectedCancel}, PASS=${passed}\n`);

        results.push({
          no: i + 1,
          message: test.message,
          contains_ga: test.message.includes('ga'),
          v2_intent: result.data.intent,
          v2_confidence: result.data.confidence,
          v2_reply_text: result.data.reply_text || '',
          v2_proposed_actions: JSON.stringify(result.data.proposed_actions),
          v2_entities: JSON.stringify(result.data.entities),
          v2_needs_clarification: result.data.needs_clarification,
          v2_success: true,
          v2_provider: result.provider,
          v2_model: result.model,
          v2_is_cancel: isCancel,
          expected_cancel: test.expectedCancel,
          regression_pass: passed,
        });
      } else {
        console.error(`  → ERROR: ${result.error.type} — ${result.error.message.slice(0, 100)}\n`);
        results.push({
          no: i + 1,
          message: test.message,
          contains_ga: test.message.includes('ga'),
          v2_intent: 'ERROR',
          v2_confidence: 0,
          v2_reply_text: '',
          v2_proposed_actions: '',
          v2_entities: '',
          v2_needs_clarification: false,
          v2_success: false,
          v2_error_type: result.error.type,
          v2_is_cancel: false,
          expected_cancel: test.expectedCancel,
          regression_pass: !test.expectedCancel, // error = didn't cancel = pass for non-cancel cases
        });
      }
    } catch (err) {
      console.error(`  → EXCEPTION: ${err instanceof Error ? err.message : String(err)}\n`);
      results.push({
        no: i + 1,
        message: test.message,
        contains_ga: test.message.includes('ga'),
        v2_intent: 'EXCEPTION',
        v2_confidence: 0,
        v2_reply_text: '',
        v2_proposed_actions: '',
        v2_entities: '',
        v2_needs_clarification: false,
        v2_success: false,
        v2_is_cancel: false,
        expected_cancel: test.expectedCancel,
        regression_pass: !test.expectedCancel,
      });
    }

    // Delay between calls to avoid rate limiting
    if (i < TEST_MESSAGES.length - 1) {
      console.error(`  (waiting 5s to avoid rate limit...)\n`);
      await sleep(5000);
    }
  }

  // Output JSON
  console.log(JSON.stringify(results, null, 2));

  // Summary
  console.error('=== SUMMARY ===');
  console.error(`Total: ${results.length}`);
  console.error(`Success: ${results.filter(r => r.v2_success).length}`);
  console.error(`Failed: ${results.filter(r => !r.v2_success).length}`);
  console.error(`True cancel_order (V2): ${results.filter(r => r.v2_is_cancel).length}`);
  console.error(`Expected cancel_order: ${TEST_MESSAGES.filter(t => t.expectedCancel).length}`);
  console.error('\nPer-message:');
  for (const r of results) {
    const status = r.v2_success ? '✅' : '❌';
    const cancelFlag = r.v2_is_cancel ? ' [CANCEL]' : '';
    const passFlag = r.regression_pass ? ' ✅' : ' ❌ MISMATCH';
    const errMsg = r.v2_error_type ? ` (error: ${r.v2_error_type})` : '';
    console.error(`  ${status} [${r.no}] "${r.message}" → ${r.v2_intent}${cancelFlag}${errMsg}${passFlag}`);
  }

  await prisma.$disconnect();
  console.error('\nDone.');
}

main().catch(async (err) => {
  console.error('Fatal:', err);
  await prisma.$disconnect();
  process.exit(1);
});
