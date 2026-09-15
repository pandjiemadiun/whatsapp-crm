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
import { ConversationService } from '../../../business/conversation.service.js';
import { buildLLMContext } from './context-builder.js';
import { buildCatalogContextForPrompt } from '../../catalog-context.service.js';
import { callV2Engine, type V2EngineResult } from './engine-call.js';
import { llmGateway } from '../../../adapters/ai/llm-gateway.js';
import { loadWorkspace } from '../workspace.js';
import { safeEnrichV2Reply } from './enrichment.js';
import { getV2RewriteMode, V2_REWRITE_MODE_FLAG_KEY, type V2RewriteMode } from './rewrite-config.js';
import { classifyStructured } from '../../../services/structured-message.mapper.js';
import type { ResponseResult, ResponseSource } from '../../../domain/types.js';
import type { HistoryTurn } from '../prompts-v2.js';
import type { WorkspaceV2 } from '../types-v2.js';
import type { V2EngineOutput } from './schema.js';
import type { CatalogItem } from '../setops.js';

/** Store yang diizinkan untuk shadow mode (hardcoded untuk P2-UNIT5). */
export const SHADOW_STORE_ID = 'store-a3cd7205';

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
export async function loadFullHistory(conversationId: string): Promise<HistoryTurn[]> {
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

    // ── 4b. Fetch store + catalog context (REUSE shared helper) ──
    // Fail-open: if store/catalog fetch throws, use empty values — the
    // shadow log must still be created.
    let storeBusinessCategory: string | null = null;
    let catalogItems: CatalogItem[] = [];
    let catalogMode: string = 'full';
    try {
      const storeRow = await prisma.store.findUnique({
        where: { id: storeId },
        select: { businessCategory: true },
      });
      storeBusinessCategory = storeRow?.businessCategory ?? null;

      const catalogResult = await buildCatalogContextForPrompt(
        storeId,
        customerMessage,
        { draft_cart: workspace.draft_cart, resolved_facts: workspace.resolved_facts, options_presented: workspace.options_presented },
      );
      catalogItems = catalogResult.items;
      catalogMode = catalogResult.mode;
    } catch {
      // Fail-open: businessCategory stays null, catalog stays empty.
    }

    // ── 5. Build context + call V2 engine (REAL gateway) ──
    const context = buildLLMContext({
      recentHistory: fullHistory,
      workspace,
      customerMessage,
      businessCategory: storeBusinessCategory,
      catalogItems,
      catalogMode,
    });

    let v2Result: V2EngineResult;
    try {
      v2Result = await callV2Engine(context, 'chat_primary', llmGateway, {
        businessCategory: storeBusinessCategory,
        catalogItems,
      });
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

// ─── V2 Rewrite Shadow Wiring (WIRE-V2ENGINE-ENTRYPOINT) ────────────────────
// Separate flag: chatEngine.v2RewriteMode = 'off' | 'shadow'.
// Default 'off'. When 'shadow', after the v2-lama path (reasoning.ts via
// conversation.service.ts) completes and the customer reply is already
// composed/persisted, this fire-and-forget call invokes the NEW V2 engine
// (callV2Engine → V2EngineOutput), runs the 3 translation layers
// (deriveV2EngineReason / deriveV2EngineProductSource / deriveV2EngineQuickReply),
// classifies the messageType, and saves everything to v2_shadow_logs
// (v2RewriteOutput columns) for comparison — WITHOUT touching the customer reply.
// ─────────────────────────────────────────────────────────────────────────────

export interface V2RewriteShadowParams {
  storeId: string;
  conversationId: string;
  customerMessage: string;
  v1Reply: string;
  /**
   * Optional injectable for testing. If omitted, the real callV2Engine
   * (with llmGateway) is used.
   */
  callV2EngineFn?: typeof callV2Engine;
}

/**
 * Fire-and-forget V2-rewrite shadow call.
 *
 * MUST be called AFTER the V2-lama path (reasoning.ts) has composed and
 * persisted the customer-facing reply. This function NEVER throws — all
 * errors are logged and swallowed.
 *
 * Caller pattern (conversation.service.ts V2 path):
 *   fireV2RewriteShadowCall({ storeId, conversationId, customerMessage, v1Reply })
 *     .catch(err => logger.error('v2-rewrite shadow unhandled', err));
 */
export async function fireV2RewriteShadowCall(
  params: V2RewriteShadowParams,
): Promise<void> {
  const { storeId, conversationId, customerMessage, v1Reply, callV2EngineFn } = params;

  try {
    // ── 1. Check v2RewriteMode flag (SEPARATE from v2Mode) ──
    const rewriteMode = await getV2RewriteMode();
    if (rewriteMode !== 'shadow') return; // 'off' or 'active' → skip (active is handled in conversation.service.ts)

    // ── 2. Store-level canary isolation (same as fireShadowV2Call) ──
    if (storeId !== SHADOW_STORE_ID) return;

    // ── 3. Load workspace (read-only) ──
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

    // ── 4b. Fetch store businessCategory + adaptive catalog context ──
    // REUSE shared helper (same as conversation.service.ts V2-lama path)
    // Fail-open: if store/catalog fetch throws, use empty values — the
    // V2 shadow log must still be created.
    let storeBusinessCategory: string | null = null;
    let catalogItems: CatalogItem[] = [];
    let catalogMode: string = 'full';
    try {
      const storeRow = await prisma.store.findUnique({
        where: { id: storeId },
        select: { businessCategory: true },
      });
      storeBusinessCategory = storeRow?.businessCategory ?? null;

      const catalogResult = await buildCatalogContextForPrompt(
        storeId,
        customerMessage,
        {
          draft_cart: workspace.draft_cart,
          resolved_facts: workspace.resolved_facts,
          options_presented: workspace.options_presented,
        },
        30,
        20,
      );
      catalogItems = catalogResult.items;
      catalogMode = catalogResult.mode;
    } catch {
      // Fail-open: businessCategory stays null, catalog stays empty.
      // The V2 shadow log entry is still created below.
    }

    // ── 5. Build context + call V2 engine ──
    const context = buildLLMContext({
      recentHistory: fullHistory,
      workspace,
      customerMessage,
      businessCategory: storeBusinessCategory,
      catalogItems,
      catalogMode,
    });

    const engineFn = callV2EngineFn ?? callV2Engine;
    let v2Result: V2EngineResult;
    try {
      v2Result = await engineFn(context, 'chat_primary', llmGateway, {
        businessCategory: storeBusinessCategory,
        catalogItems,
      });
    } catch {
      v2Result = {
        success: false,
        error: {
          type: 'provider_exhausted',
          message: 'V2 rewrite engine threw an unexpected exception',
          failedProviders: [],
        },
      };
    }

    // ── 6. Run 3 translation layers if V2 engine succeeded ──
    let derivedReason: string | undefined;
    let derivedMessageType: string | undefined;
    let derivedProductSource: Record<string, unknown> | undefined;
    let derivedQuickReply: Record<string, unknown> | undefined;
    let classifiedMessageType: string | undefined;

    if (v2Result.success && v2Result.data) {
      const v2Output: V2EngineOutput = v2Result.data;

      // Derive reason (duck-typed on proposed_actions + intent)
      // Access private prototype methods via `as any` — these are pure
      // functions that don't depend on `this` binding for derivation logic.
      const _proto = ConversationService.prototype as any;
      derivedReason = _proto.deriveV2EngineReason(v2Output);

      // Derive product source (calls productService.searchProducts / listActiveProducts)
      const productSource = await _proto.deriveV2EngineProductSource(v2Output, storeId);
      if (productSource) {
        derivedProductSource = {
          source: productSource.source,
          matchedNames: productSource.metadata?.matchedNames,
          productIds: productSource.metadata?.productIds,
          matchedPrices: productSource.metadata?.matchedPrices,
        };
      }

      // Derive quick reply (checks DB pending clarification state)
      const quickReply = await _proto.deriveV2EngineQuickReply(v2Output, storeId, conversationId);
      if (quickReply) {
        derivedQuickReply = { reason: quickReply.reason, question: quickReply.question };
      }

      // Classify messageType — build a minimal ResponseResult from the derived
      // values, then run classifyStructured to get the messageType that the
      // structured-message mapper would assign.
      const classified = classifyStructured({
        message: { content: v2Output.reply_text || '' },
        source: (productSource?.source as ResponseSource) || ('PRODUCT' as ResponseSource),
        confidence: v2Output.confidence || 0.8,
        metadata: {
          ...(derivedReason ? { reason: derivedReason } : {}),
          ...(productSource?.metadata || {}),
          ...(quickReply ? { reason: quickReply.reason, clarification_question: quickReply.question } : {}),
        },
      } as ResponseResult);
      classifiedMessageType = classified.messageType;
    }

    // ── 7. Enrich reply text with prices (for fair V1 vs V2 comparison) ──
    const v2EnrichedReply = await safeEnrichV2Reply(v2Result, storeId, conversationId);

    // ── 8. Save to V2ShadowLog with v2RewriteOutput columns ──
      await prisma.v2ShadowLog.create({
        data: {
          storeId,
          conversationId,
          customerMessage,
          v1ActualReply: v1Reply,
          v2Output: v2Result as unknown as object, // JSON column
          v2EnrichedReply,
          v2DerivedReason: derivedReason || undefined,
          v2MessageType: classifiedMessageType || undefined,
          v2ProductSource: (derivedProductSource as any) || undefined,
          v2QuickReply: (derivedQuickReply as any) || undefined,
        },
      });

    // Log success
    const adapters: { logger: { info: (m: string, d?: any) => void; warn: (m: string, d?: any) => void; error: (m: string, e: Error) => void } } = (await import('../../../adapters/container.js')).adapters;
    adapters.logger.info('V2 rewrite shadow call completed', {
      storeId,
      conversationId,
      rewriteMode,
      success: v2Result.success,
      derivedReason,
      classifiedMessageType,
    });
  } catch (err) {
    // TOTAL try-catch: V2-rewrite processing must NEVER propagate to caller.
    // Customer reply already sent from reasoning.ts; this is observation-only.
    const adapters: { logger: { info: (m: string, d?: any) => void; warn: (m: string, d?: any) => void; error: (m: string, e: Error) => void } } = (await import('../../../adapters/container.js')).adapters;
    adapters.logger.warn('V2 rewrite shadow call failed (non-blocking, v1 already sent)', {
      storeId,
      conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
