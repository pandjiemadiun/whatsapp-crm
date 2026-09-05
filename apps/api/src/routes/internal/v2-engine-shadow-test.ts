/**
 * V2 Engine Shadow Test Endpoint — P2-UNIT4
 * src/routes/internal/v2-engine-shadow-test.ts
 *
 * SHADOW MODE (bukan cutover): V2 engine (buildLLMContext + callV2Engine)
 * dipanggil paralel dengan v1 yang sudah berjalan. Hasil v2 hanya untuk
 * observasi/bandinging — v1 tetap menentukan balasan sesungguhnya ke customer.
 *
 * READ-ONLY — TIDAK ada DB write, TIDAK mengeksekusi proposed_actions,
 * TIDAK mengirim reply ke customer, TIDAK menyimpan ke conversation_history.
 *
 * Proteksi:
 *   - adminAuthMiddleware: Bearer token admin valid (check revokedAt + expiresAt)
 *   - Di production: tambahan network-level protection (hanya expose di
 *     internal network / localhost, bukan public internet)
 *
 * Flow: canonicalConversationStateService.getV2Workspace() [READ-ONLY]
 *   → loadRecentHistory() [READ-ONLY prisma.conversationHistory.findMany]
 *   → buildLLMContext() [UNIT2]
 *   → callV2Engine() [UNIT3]
 *   → return raw V2EngineResult sebagai JSON
 */
import { Router, Request, Response } from 'express';
import { prisma } from '../../infrastructure/prisma.js';
import { canonicalConversationStateService } from '../../business/canonical-context.service.js';
import { buildLLMContext } from '../../services/chat/v2-engine/context-builder.js';
import { callV2Engine } from '../../services/chat/v2-engine/engine-call.js';
import type { V2EngineResult, V2ProviderRole } from '../../services/chat/v2-engine/engine-call.js';
import { loadWorkspace } from '../../services/chat/workspace.js';
import type { WorkspaceV2 } from '../../services/chat/types-v2.js';
import type { HistoryTurn } from '../../services/chat/prompts-v2.js';
import { llmGateway } from '../../adapters/ai/llm-gateway.js';
import type { LLMGateway } from '../../adapters/ai/llm-gateway.js';
import type { AuthenticatedAdminRequest } from '../../middleware/adminAuth.js';

const router = Router();

// ─── Types ────────────────────────────────────────────────────────────────

export interface ShadowTestRequest {
  conversationId: string;
  customerMessage: string;
  providerRole?: V2ProviderRole;
}

export interface ShadowTestResult {
  conversationId: string;
  customerMessage: string;
  providerRole: V2ProviderRole;
  workspace: WorkspaceV2;
  recentHistory: HistoryTurn[];
  context_preview: string;
  v2_engine_output: V2EngineResult;
  read_only: boolean;
  warnings: string[];
}

export class ShadowTestError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'ShadowTestError';
  }
}

// ─── Helpers (read-only) ──────────────────────────────────────────────────

/**
 * Load recent conversation history (READ-ONLY).
 * Returns last 20 messages in chronological order — matches the MAX_TURNS=10
 * window used by buildLLMContext (20 turns = 10 pairs).
 *
 * Hanya membaca conversation_history. TIDAK ada write.
 */
async function loadRecentHistory(conversationId: string): Promise<HistoryTurn[]> {
  const rows = await prisma.conversationHistory.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  // Reverse: findMany returns desc, buildLLMContext expects chronological (asc)
  return rows
    .reverse()
    .map((r) => ({
      role: r.role as 'user' | 'assistant' | 'system',
      content: r.content,
    }));
}

// ─── Core shadow logic (testable, injectable gateway) ────────────────────

/**
 * Run V2 engine in shadow mode — pure observation.
 *
 * 1. Load workspace via canonical boundary (READ-ONLY, getV2Workspace)
 * 2. Load recent history (READ-ONLY, prisma.conversationHistory.findMany)
 * 3. Build context via buildLLMContext (UNIT2)
 * 4. Call V2 engine via callV2Engine (UNIT3)
 *
 * NO DB writes. NO action execution. NO reply sent. NO history saved.
 *
 * @param _gateway Optional injected gateway (for unit testing with mock LLM)
 */
export async function runShadowTest(
  conversationId: string,
  customerMessage: string,
  _gateway?: LLMGateway,
): Promise<ShadowTestResult> {
  const warnings: string[] = [];
  const providerRole: V2ProviderRole = 'chat_primary';

  // 1. Verify conversation exists (READ-ONLY check via conversations table)
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true },
  });
  if (!conv) {
    throw new ShadowTestError(
      `Conversation not found: ${conversationId}`,
      'NOT_FOUND',
    );
  }

  // 2. Load workspace (READ-ONLY via canonical boundary)
  //    Pattern: sama seperti conversation.service.ts:161 — jika
  //    getCanonicalWithLegacyFallback mengembalikan null (belum ada
  //    conversation_context row), pakai default empty workspace.
  //    Ini TERJADI untuk semua conversation di DB (conversation_context kosong).
  const loadedWorkspace = await canonicalConversationStateService.getV2Workspace(conversationId);
  let workspace: WorkspaceV2;
  if (loadedWorkspace) {
    workspace = loadedWorkspace;
  } else {
    workspace = loadWorkspace('{}');
    warnings.push('No canonical context row — using default empty workspace (legacy V1 data not yet migrated)');
  }

  // 2. Load recent history (READ-ONLY)
  const recentHistory = await loadRecentHistory(conversationId);
  if (recentHistory.length === 0) {
    warnings.push('No recent history found for this conversation');
  }

  // 3. Build LLM context (UNIT2 — context-builder.ts)
  const context = buildLLMContext({
    recentHistory,
    workspace,
    customerMessage,
  });

  // 4. Call V2 engine (UNIT3 — engine-call.ts) — shadow, NO execution
  //    callV2Engine internally: buildV2Prompt(context) → gateway.generate() → parse
  //    It does NOT execute proposed_actions, write to DB, or send reply.
  const v2Result = await callV2Engine(
    context,
    providerRole,
    _gateway ?? llmGateway,
  );

  return {
    conversationId,
    customerMessage,
    providerRole,
    workspace,
    recentHistory,
    context_preview: context.slice(0, 2000) + (context.length > 2000 ? '...' : ''),
    v2_engine_output: v2Result,
    read_only: true, // Invariant: this function never writes to DB
    warnings,
  };
}

// ─── Route handler ────────────────────────────────────────────────────────

/**
 * POST /api/internal/v2-engine-shadow-test
 *
 * Proteksi:
 * - adminAuthMiddleware: Bearer token admin valid
 * - Di production: tambahan network ACL (hanya internal network)
 *
 * Response: raw V2 engine output (intent, entities, proposed_actions,
 * reply_text) — TANPA eksekusi aksi, TANPA penyimpanan ke DB.
 */
router.post(
  '/v2-engine-shadow-test',
  async (req: Request, _res: Response) => {
    // req.admin is set by adminAuthMiddleware
    const { conversationId, customerMessage } = req.body as Partial<ShadowTestRequest>;

    if (!conversationId || !customerMessage) {
      return _res.status(400).json({
        error: 'Bad request',
        message: 'conversationId and customerMessage are required',
        example: {
          conversationId: 'bbab7983-ddb3-40ef-b1a4-a12200566be5',
          customerMessage: 'Ada ban dalam?',
        },
      });
    }

    const providerRole =
      (req.query.providerRole as V2ProviderRole) ||
      (req.body as Partial<ShadowTestRequest>).providerRole ||
      'chat_primary';

    try {
      const result = await runShadowTest(conversationId, customerMessage);
      return _res.json(result);
    } catch (err) {
      if (err instanceof ShadowTestError) {
        return _res.status(err.code === 'NOT_FOUND' ? 404 : 400).json({
          error: err.code,
          message: err.message,
        });
      }
      return _res.status(500).json({
        error: 'Shadow test failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

export default router;
