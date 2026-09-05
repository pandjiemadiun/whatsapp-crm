/**
 * V2 Engine Shadow Wiring — P2-UNIT5
 * src/services/chat/v2-engine/shadow-wiring.ts
 *
 * Fire-and-forget integration that:
 * 1. Reads chatEngine.v2Mode flag from system_settings
 * 2. If 'shadow' + storeId matches SHADOW_STORE_ID:
 *    a. Load conversation history (read-only)
 *    b. Build LLM context (buildLLMContext)
 *    c. Call V2 engine (callV2Engine) with REAL gateway
 *    d. Enrich reply_text with prices from CartAuthority (enrichV2Reply)
 *    e. Save full result to V2ShadowLog
 *
 * CRITICAL: This function has TOTAL try-catch — any failure in V2
 * processing MUST NOT propagate to the caller. The V1 customer reply
 * is already sent; this is purely observational logging.
 */
import { prisma } from '../../../infrastructure/prisma.js';
import { configService } from '../../../business/config.service.js';
import { canonicalConversationStateService } from '../../../business/canonical-context.service.js';
import { buildLLMContext } from './context-builder.js';
import { callV2Engine } from './engine-call.js';
import { llmGateway } from '../../../adapters/ai/llm-gateway.js';
import { loadWorkspace } from '../workspace.js';
import { safeEnrichV2Reply } from './enrichment.js';
import type { HistoryTurn } from '../prompts-v2.js';
import type { WorkspaceV2 } from '../types-v2.js';
import type { V2EngineResult } from './engine-call.js';

/** Store yang diizinkan untuk shadow mode (hardcoded untuk P2-UNIT5). */
export const SHADOW_STORE_ID = 'store-4f4f67bd';

/** Flag key di system_settings. */
export const V2_MODE_FLAG_KEY = 'chatEngine.v2Mode';

export type V2Mode = 'off' | 'shadow' | 'active';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Read chatEngine.v2Mode flag from system_settings (cached 5 min via ConfigService).
 * Returns 'off' if not set.
 */
async function getV2Mode(): Promise<V2Mode> {
  try {
    const value = await configService.getConfig(V2_MODE_FLAG_KEY);
    if (value === 'shadow' || value === 'active') return value;
    return 'off';
  } catch {
    return 'off';
  }
}

/**
 * Load full conversation history from DB (chronological, read-only).
 */
async function loadFullHistory(conversationId: string): Promise<HistoryTurn[]> {
  const rows = await prisma.conversationHistory.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r: { role: string; content: string }) => ({
    role: r.role as 'user' | 'assistant' | 'system',
    content: r.content,
  }));
}

// ─── Main shadow call ───────────────────────────────────────────────────────

export interface ShadowCallParams {
  storeId: string;
  conversationId: string;
  customerMessage: string;
  v1Reply: string;
}

/**
 * Fire-and-forget V2 shadow call.
 *
 * MUST be called after V1 reply is already sent to customer.
 * This function NEVER throws — all errors are logged and swallowed.
 *
 * Caller pattern:
 *   fireShadowV2Call({ storeId, conversationId, customerMessage, v1Reply })
 *     .catch(err => logger.error('shadow unhandled', err));
 *
 * The internal try-catch makes the .catch() a redundant safety net — but
 * it's included as defense-in-depth against truly unexpected errors
 * (e.g., uncaught promise rejections from library code).
 */
export async function fireShadowV2Call(params: ShadowCallParams): Promise<void> {
  const { storeId, conversationId, customerMessage, v1Reply } = params;

  try {
    // ── 1. Check flag (store-level isolation) ──
    const v2Mode = await getV2Mode();
    if (v2Mode !== 'shadow') return; // 'off' or 'active' → skip

    // ── 2. Only the dummy store (P2-UNIT5 scope) ──
    if (storeId !== SHADOW_STORE_ID) return;

    // ── 3. Load workspace (read-only via canonical boundary) ──
    let workspace: WorkspaceV2 | null = null;
    try {
      workspace = await canonicalConversationStateService.getV2Workspace(conversationId);
    } catch {
      workspace = null;
    }
    if (!workspace) {
      workspace = loadWorkspace('{}');
    }

    // ── 4. Load full history (read-only) ──
    const fullHistory = await loadFullHistory(conversationId);

    // ── 5. Build context + call V2 engine (REAL gateway) ──
    const context = buildLLMContext({
      recentHistory: fullHistory,
      workspace,
      customerMessage,
    });

    let v2Result: V2EngineResult;
    try {
      v2Result = await callV2Engine(context, 'chat_primary', llmGateway);
    } catch {
      // If callV2Engine itself throws (bypassing its internal try-catch),
      // construct a provider_exhausted error so the log entry is still saved.
      v2Result = {
        success: false,
        error: {
          type: 'provider_exhausted',
          message: 'V2 engine threw an unexpected exception',
          failedProviders: [],
        },
      };
    }

    // ── 6. Enrich reply text with prices (for fair V1 vs V2 comparison) ──
    const v2EnrichedReply = await safeEnrichV2Reply(v2Result, storeId, conversationId);

    // ── 7. Save to V2ShadowLog (READ-ONLY log, never read back by engine) ──
    await prisma.v2ShadowLog.create({
      data: {
        storeId,
        conversationId,
        customerMessage,
        v1ActualReply: v1Reply,
        v2Output: v2Result as unknown as object, // JSON column
        v2EnrichedReply,
      },
    });

    // Log success (info, not error)
    const adapters: { logger: { info: (m: string, d?: any) => void; warn: (m: string, d?: any) => void; error: (m: string, e: Error) => void } } = (await import('../../../adapters/container.js')).adapters;
    adapters.logger.info('V2 shadow call completed', {
      storeId,
      conversationId,
      success: v2Result.success,
    });
  } catch (err) {
    // TOTAL try-catch: any failure in V2 processing is logged and swallowed.
    // The V1 customer reply is already delivered — V2 issues must never
    // propagate.
    const adapters: { logger: { info: (m: string, d?: any) => void; warn: (m: string, d?: any) => void; error: (m: string, e: Error) => void } } = (await import('../../../adapters/container.js')).adapters;
    adapters.logger.warn('V2 shadow call failed (non-blocking, v1 already sent)', {
      storeId,
      conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
