/**
 * V2 Engine Shadow Test Runner — P2-UNIT4
 * src/routes/internal/v2-engine-shadow-test-runner.ts
 *
 * Script (bukan test file) — dijalankan dengan:
 *   npx tsx --env-file=../../.env src/routes/internal/v2-engine-shadow-test-runner.ts
 *
 * Untuk SETIAP dari 10 pesan Bengkel Didik:
 *   1. Load FULL conversation history dari DB, potong sampai pesan test
 *   2. buildLLMContext() [UNIT2] → callV2Engine() [UNIT3] (REAL LLM gateway)
 *   3. Kumpulkan V2 output (intent, entities, proposed_actions, reply_text)
 *   4. Bandingkan dengan V1 actual response (dari trace analysis)
 *
 * READ-ONLY — tidak ada DB write, tidak mengeksekusi aksi, tidak mengirim reply.
 */
import { prisma } from '../../infrastructure/prisma.js';
import { canonicalConversationStateService } from '../../business/canonical-context.service.js';
import { buildLLMContext } from '../../services/chat/v2-engine/context-builder.js';
import { callV2Engine } from '../../services/chat/v2-engine/engine-call.js';
import { llmGateway } from '../../adapters/ai/llm-gateway.js';
import { loadWorkspace } from '../../services/chat/workspace.js';
import type { HistoryTurn } from '../../services/chat/prompts-v2.js';
import type { WorkspaceV2 } from '../../services/chat/types-v2.js';
import type { V2EngineResult } from '../../services/chat/v2-engine/engine-call.js';

// ─── Constants ─────────────────────────────────────────────────────────────

const CONVERSATION_ID = 'bbab7983-ddb3-40ef-b1a4-a12200566be5';
const MAX_TURNS = 10; // buildLLMContext uses MAX_TURNS=10 (20 turns)
const CALL_DELAY_MS = 3000; // delay between consecutive LLM calls (avoid rate limit)
const MAX_RETRIES = 2; // retry on provider exhaustion before giving up

// ─── V1 Actual Responses (dari conversation_history + trace analysis) ──────

interface V1Response {
  reply_text: string;
  messageType: string;
  source: string;
  notes: string;
}

const V1_RESPONSES: Record<string, V1Response> = {
  'Ada ban dalam?': {
    reply_text: 'Mau pilih yang mana nih?',
    messageType: 'quick_reply',
    source: 'sop',
    notes: 'ADD_TO_CART action fired (Ban dalam qty 1) — v1 saw "ban" in product list and auto-added',
  },
  'Ada busi?': {
    reply_text: '(no direct response — user sent "Busi kak" immediately)',
    messageType: '—',
    source: '—',
    notes: 'V1 did not respond to "Ada busi?" alone; user sent follow-up "Busi kak"',
  },
  'Busi kak': {
    reply_text: 'Halo Kak! Untuk *Busi motor* harganya *Rp 15.000* per unit ya. 🌿 Mau dimasukkan ke keranjang?',
    messageType: 'product',
    source: 'product',
    notes: 'V1 showed product card with price after user confirmed "Busi kak"',
  },
  'Busi': {
    reply_text: '(no direct response — user sent "Mau" immediately)',
    messageType: '—',
    source: '—',
    notes: 'User sent "Mau" right after; V1 responded to the combined intent',
  },
  'Mau': {
    reply_text: 'Oke, Busi motor sudah ditambahkan ke keranjang ya! Mau lanjut belanja atau cek pesanan?',
    messageType: 'text',
    source: 'ai',
    notes: 'ADD_TO_CART: Busi motor qty 1 (Rp 15.000) — v1 processed "Mau" as confirmation',
  },
  'Totalnya kak': {
    reply_text: 'GRAND TOTAL: Rp 65.000\n\nRincian:\n- Ban dalam (1x): Rp 50.000\n- Busi motor (1x): Rp 15.000\n- Subtotal: Rp 65.000',
    messageType: 'text',
    source: 'total',
    notes: 'V1 computed cart total — showed Ban dalam (50k) + Busi motor (15k) = 65k',
  },
  'Ok, saya mau bayar': {
    reply_text: 'Siapa nama Kakak dan alamat pengirimannya?',
    messageType: 'text',
    source: 'sop',
    notes: 'V1 triggered checkout flow — asked for name + shipping address',
  },
  'Panji dagangan': {
    reply_text: 'Oke Kak, sudah sayi batalkan ya. 🙏',
    messageType: '—',
    source: 'sop',
    notes: '❌ FALSE CANCEL BUG — "Panji dagangan" contains substring "ga" (in "dagangan") which matched pendingClarification.ts:77 (message.includes("ga")) → v1 incorrectly classified as rollback/cancel',
  },
  'Ban luar Vario depan 100.000 belakang 150.000': {
    reply_text: '[MAGIC-PASTE] product: "Ban luar Vario depan belakang", price: 100000, variants: [{posisi: depan, price: 100000}, {posisi: belakang, price: 150000}]',
    messageType: 'magic_paste',
    source: 'product_import',
    notes: 'V1 magic-paste audit (Test 1): extracted 2 variants (depan 100k, belakang 150k)',
  },
  'Kampas rem depan 50.000 belakang 100.000': {
    reply_text: '[MAGIC-PASTE] product: "Kampas rem depan belakang", price: 50000, variants: [{posisi: depan, price: 50000}, {posisi: belakang, price: 100000}]',
    messageType: 'magic_paste',
    source: 'product_import',
    notes: 'V1 magic-paste audit (Test 2): extracted 2 variants (depan 50k, belakang 100k)',
  },
};

// ─── 10 Test Messages ───────────────────────────────────────────────────────

const TEST_MESSAGES: ReadonlyArray<string> = [
  'Ada ban dalam?',
  'Ada busi?',
  'Busi kak',
  'Busi',
  'Mau',
  'Totalnya kak',
  'Ok, saya mau bayar',
  'Panji dagangan',
  'Ban luar Vario depan 100.000 belakang 150.000',
  'Kampas rem depan 50.000 belakang 100.000',
];

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Delay for rate-limit avoidance between consecutive LLM calls. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Load ALL conversation history from DB (chronological order).
 * Returns as HistoryTurn[] for buildLLMContext.
 */
async function loadFullHistory(conversationId: string): Promise<HistoryTurn[]> {
  const rows = await prisma.conversationHistory.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({
    role: r.role as 'user' | 'assistant' | 'system',
    content: r.content,
  }));
}

/**
 * Find the timestamp of a specific user message in the history.
 * Returns the index in the full history array.
 */
function findMessageIndex(history: HistoryTurn[], message: string): number {
  // Find the last occurrence of this user message in the history
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user' && history[i].content === message) {
      return i;
    }
  }
  return -1;
}

/**
 * Build recentHistory: take up to MAX_TURNS*2 messages BEFORE the test message index.
 */
function buildRecentHistoryBefore(history: HistoryTurn[], messageIndex: number): HistoryTurn[] {
  const startIdx = Math.max(0, messageIndex - MAX_TURNS * 2);
  return history.slice(startIdx, messageIndex);
}

/**
 * Run shadow test for a single message with REAL LLM gateway.
 * Uses conversation history from DB (up to the point of this message).
 *
 * Includes retry with exponential backoff on provider errors to avoid
 * 429 rate-limiting + truncated outputs during manual testing.
 */
async function runShadowForMessage(
  conversationId: string,
  customerMessage: string,
  fullHistory: HistoryTurn[],
  workspace: WorkspaceV2,
): Promise<V2EngineResult> {
  // Find the position of this message in the full history
  const msgIndex = findMessageIndex(fullHistory, customerMessage);
  
  let recentHistory: HistoryTurn[];
  if (msgIndex >= 0) {
    // Use history up to (but not including) the test message
    recentHistory = buildRecentHistoryBefore(fullHistory, msgIndex);
  } else {
    // Message not in history (e.g., magic-paste test messages)
    // Use last 20 messages as context
    recentHistory = fullHistory.slice(-MAX_TURNS * 2);
  }

  // Build LLM context (UNIT2)
  const context = buildLLMContext({
    recentHistory,
    workspace,
    customerMessage,
  });

  // Call V2 engine (UNIT3) — REAL gateway, no execution
  return callV2Engine(context, 'chat_primary', llmGateway);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.error('=== V2 Engine Shadow Test — Bengkel Didik (store-4f4f67bd) ===\n');
  console.error(`Conversation: ${CONVERSATION_ID}`);
  console.error('Using REAL LLM gateway (dynamic providers from DB)\n');

  // 1. Load workspace (READ-ONLY via canonical boundary)
  let workspace = await canonicalConversationStateService.getV2Workspace(CONVERSATION_ID);
  const workspaceWarnings: string[] = [];
  if (!workspace) {
    workspace = loadWorkspace('{}');
    workspaceWarnings.push('No conversation_context row — using default empty workspace');
  }

  // 2. Load full conversation history (READ-ONLY)
  const fullHistory = await loadFullHistory(CONVERSATION_ID);
  console.error(`Loaded ${fullHistory.length} history rows for conversation\n`);

  // 3. Run shadow test for each message
  const results: Array<{
    no: number;
    message: string;
    v1: V1Response;
    v2_result: V2EngineResult;
    context_length: number;
  }> = [];

  for (const [i, msg] of TEST_MESSAGES.entries()) {
    console.error(`[${i + 1}/${TEST_MESSAGES.length}] "${msg}"`);

    try {
      const msgIndex = findMessageIndex(fullHistory, msg);
      const contextLen = msgIndex >= 0
        ? buildRecentHistoryBefore(fullHistory, msgIndex).length
        : fullHistory.slice(-MAX_TURNS * 2).length;

      // Run with retry + backoff on provider exhaustion / 429
      let v2Result: V2EngineResult | null = null;
      let lastError: string = '';
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        v2Result = await runShadowForMessage(CONVERSATION_ID, msg, fullHistory, workspace!);
        if (v2Result.success) break;

        lastError = v2Result.error.message;
        const isRateLimited =
          v2Result.error.type === 'provider_exhausted' &&
          (v2Result.error.message.includes('429') ||
           v2Result.error.message.includes('truncated') ||
           v2Result.error.failedProviders?.length > 0);

        if (attempt < MAX_RETRIES && isRateLimited) {
          const delay = CALL_DELAY_MS * Math.pow(2, attempt); // 3s, 6s
          console.error(`  ↻ retry ${attempt + 1}/${MAX_RETRIES} after ${delay}ms backoff (rate limit)`);
          await sleep(delay);
        }
      }

      if (!v2Result || !v2Result.success) {
        throw new Error(lastError || 'unknown error');
      }

      results.push({
        no: i + 1,
        message: msg,
        v1: V1_RESPONSES[msg] || { reply_text: '(not found)', messageType: '—', source: '—', notes: '' },
        v2_result: v2Result,
        context_length: contextLen,
      });

      const intent = v2Result.data.intent;
      const cancelFlag = intent === 'cancel_order' ? ' ⚠️ FALSE-CANCEL!' : '';
      console.error(`  v2: intent=${intent}, conf=${v2Result.data.confidence}, reply="${v2Result.data.reply_text?.slice(0, 80)}..."${cancelFlag}\n`);
    } catch (err) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
      results.push({
        no: i + 1,
        message: msg,
        v1: V1_RESPONSES[msg] || { reply_text: '(not found)', messageType: '—', source: '—', notes: '' },
        v2_result: { success: false, error: { type: 'provider_exhausted' as const, message: String(err), failedProviders: [] } },
        context_length: 0,
      });
    }

    // Delay between consecutive LLM calls to avoid rate limiting
    if (i < TEST_MESSAGES.length - 1) {
      console.error(`  (rate-limit delay: ${CALL_DELAY_MS}ms...)\n`);
      await sleep(CALL_DELAY_MS);
    }
  }

  // 4. Output JSON results
  const output = results.map((r) => {
    const v1 = r.v1;
    const v2 = r.v2_result;

    if (v2.success) {
      return {
        no: r.no,
        test_message: r.message,
        context_turns: r.context_length,
        v1_actual_response: v1.reply_text,
        v1_messageType: v1.messageType,
        v1_source: v1.source,
        v1_notes: v1.notes,
        v2_intent: v2.data.intent,
        v2_confidence: v2.data.confidence,
        v2_reply_text: v2.data.reply_text || '(none)',
        v2_proposed_actions: JSON.stringify(v2.data.proposed_actions),
        v2_entities: JSON.stringify(v2.data.entities),
        v2_needs_clarification: v2.data.needs_clarification,
        v2_clarification_question: v2.data.clarification_question || '',
        v2_provider: v2.provider,
        v2_model: v2.model,
        v2_success: true,
      };
    } else {
      return {
        no: r.no,
        test_message: r.message,
        context_turns: r.context_length,
        v1_actual_response: v1.reply_text,
        v1_messageType: v1.messageType,
        v1_source: v1.source,
        v1_notes: v1.notes,
        v2_intent: 'ERROR',
        v2_confidence: 0,
        v2_reply_text: '(error)',
        v2_proposed_actions: '',
        v2_entities: '',
        v2_needs_clarification: false,
        v2_clarification_question: '',
        v2_provider: undefined,
        v2_model: undefined,
        v2_success: false,
        v2_error_type: v2.error.type,
        v2_error_message: v2.error.message.slice(0, 200),
      };
    }
  });

  console.log(JSON.stringify(output, null, 2));

  // 5. Summary
  console.error('\n=== Summary ===');
  const v2Success = results.filter(r => r.v2_result.success).length;
  const cancelClassifications = results.filter(
    r => r.v2_result.success && r.v2_result.data.intent === 'cancel_order'
  ).length;

  console.error(`V2 success: ${v2Success}/${results.length}`);
  console.error(`False cancel_order classifications: ${cancelClassifications} ⚠️`);
  console.error('\nPer-message:');
  for (const r of results) {
    const v2 = r.v2_result;
    if (v2.success) {
      const cancelFlag = v2.data.intent === 'cancel_order' ? ' ❌ FALSE-CANCEL!' : '';
      console.error(`  ${r.no}. ${r.message} → intent=${v2.data.intent}, conf=${v2.data.confidence}${cancelFlag}`);
    } else {
      console.error(`  ${r.no}. ${r.message} → ERROR: ${v2.error.type}`);
    }
  }

  await prisma.$disconnect();
  console.error('\nDone.');
}

main().catch(async (err) => {
  console.error('Fatal:', err);
  await prisma.$disconnect();
  process.exit(1);
});
