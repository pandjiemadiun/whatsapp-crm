import { adapters } from '../adapters/container.js';
import { fallbackService } from './fallback.service.js';
import { orderService } from './order.service.js';
import { conversationContextService } from './conversation-context.service.js';
import { prisma } from '../infrastructure/prisma.js';
import { productService } from './product.service.js';
import { normalize } from '../services/chat/normalizer.js';
import { runOneCall, validateCartOpsAgainstDb, truncateTo2Sentences } from '../services/chat/interpreter.js';
import { getStoreEngine } from '../services/chat/engine-config.js';
import { understand } from '../services/chat/reasoning.js';
import { planActs } from '../services/chat/planner.js';
import { validate } from '../services/chat/validator-v2.js';
import { loadWorkspace, saveWorkspace, incrementDeferredTurns, shouldAutoDrop, dropPending, mapLegacyEntitiesToWorkspace, hasLegacyState } from '../services/chat/workspace.js';
import { composeReply, composeEscalateReply, escalateStatusUpdate } from '../services/chat/composer-v2.js';
import { resolvePending } from '../services/chat/pendingClarification.js';
import { shouldRunShadow } from '../services/chat/shadow-config.js';
import { buildShadowEntry, logShadowEntry } from '../services/chat/shadow-logger.js';
import type { ResolvedPayload } from '../services/chat/fast-path.js';
import type { WorkspaceV2, PendingV2 } from '../services/chat/types-v2.js';


import {
  ConversationMessage,
  ConversationContext,
  ResponseResult,
  ConversationStats,
  ResponseSource,
  ConversationWithContext,
  ConversationContextData,
  ConfirmedItem,
  ExtractedEntities,
  PipelineContext,
  CartOp,
  PendingClarification,
} from '../domain/types.js';

interface ConversationListItem {
  id: string;
  customerId: string;
  customerName: string | null;
  customerPhone: string;
  status: string;
  lastMessageAt: Date | null;
  aiResponseCount: number;
  faqResponseCount: number;
}

interface ConversationDetail extends ConversationListItem {
  history: Array<{
    id: string;
    role: string;
    content: string;
    source: string | null;
    createdAt: Date;
  }>;
}

export class ConversationService {
  async processCustomerMessage(
    storeId: string,
    customerId: string,
    conversationId: string,
    customerMessage: string
  ): Promise<ResponseResult | null> {
    adapters.logger.info('Processing customer message', { storeId, customerId, conversationId });

    const conversation = await prisma.conversation.upsert({
      where: { id: conversationId },
      update: {},
      create: {
        id: conversationId,
        storeId: storeId,
        customerId: customerId,
        customerPhone: customerId, // Fallback nilai phone dengan customerId
        channel: 'whatsapp',
        status: 'open',
      },
    });

    if (conversation.status === 'human_takeover') {
      await this.saveMessage({
        id: crypto.randomUUID(),
        conversationId,
        sender: 'customer',
        content: customerMessage,
        createdAt: new Date(),
      } as ConversationMessage);
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      });
      adapters.logger.info('Skipping AI reply — conversation under human takeover', { conversationId });
      return null;
    }

    // Pastikan context aktif (buat baru jika belum ada / sudah expired)
    const existingContext = await conversationContextService.getContext(conversationId);
    if (!existingContext) {
      await conversationContextService.initializeContext({
        storeId,
        customerId,
        conversationId,
      });
    }

    const context = await this.getOrCreateContext(storeId, customerId, conversationId, customerMessage);

    // ── ENGINE BRANCHING (v1|v2) ──
    const engine = await getStoreEngine(storeId);
    
    if (engine === 'v2') {
      let v2MutationExecuted = false;

      const buildSafeReply = (error: unknown) => {
        adapters.logger.error('CRITICAL: Engine v2 failed after cart mutation, returning generic safe reply', {
          storeId,
          conversationId,
          mutationCommitted: true,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        return this.buildResult(conversationId, {
          source: ResponseSource.AI,
          content: 'Baik kak, pesanan Kakak sudah kami catat. Silakan ketik *total* atau *cek pesanan* untuk melihat ringkasannya ya. 🙏',
          confidence: 0.5,
          cost: 0,
          metadata: { engine: 'v2', outcome: 'safe-reply', error: error instanceof Error ? error.message : String(error) },
        });
      };

      try {
        // 1. Load workspace — sumber kebenaran: kolom `workspace_v2` (P3.1).
        //    T3 fix (P3.2): bila conversation baru saja switch v1->v2 dan
        //    workspace_v2 masih kosong, migrasi SEKALI dari legacy
        //    `extractedEntities` lalu persist ke workspace_v2 agar turn
        //    berikutnya pakai workspace_v2 (tidak re-map legacy lagi).
        const ctxRow = await prisma.conversationContext.findUnique({
            where: { conversationId },
            select: { workspace_v2: true, extractedEntities: true }
        });

        let workspace: WorkspaceV2;
        if (ctxRow?.workspace_v2) {
            // Source of truth terisi (setelah P3.1) -> pakai langsung.
            workspace = loadWorkspace(JSON.stringify(ctxRow.workspace_v2));
        } else {
            // workspace_v2 kosong: cek legacy extractedEntities (v1 state).
            const legacy = conversationContextService.parseExtractedEntities(ctxRow?.extractedEntities);
            if (hasLegacyState(legacy)) {
                workspace = mapLegacyEntitiesToWorkspace(legacy);
                // Persist migrasi ke workspace_v2 jadi sumber kebenaran per-sementara.
                await conversationContextService.updateWorkspaceV2(conversationId, workspace);
            } else {
                // Kolom kosong & legacy pun kosong -> WorkspaceV2 default (conversation baru).
                workspace = loadWorkspace('{}');
            }
        }
        
        // 2. Auto-drop deferred pending
        for (const pending of workspace.pendings) {
          if (pending.status === 'deferred') {
            incrementDeferredTurns(workspace, pending.id);
            if (shouldAutoDrop(pending)) {
              dropPending(workspace, pending.id);
              adapters.logger.info('Auto-dropped deferred pending', { pendingId: pending.id });
            }
          }
        }
        
        // 3. Jalankan reasoning engine v2
        const rawCatalog = await this.getStoreProducts(storeId);
        const catalog = rawCatalog.map(p => ({
            id: p.name,
            name: p.name,
            price: p.price,
            category: null // Assuming category is not available in getStoreProducts output
        }));
        const history = context.messages.map(m => ({
            id: m.id,
            conversationId: m.conversationId,
            role: m.sender === 'customer' ? 'user' : 'assistant',
            content: m.content,
            source: m.source,
            costUSD: m.cost || 0,
            createdAt: m.createdAt,
        }));
        
        const reasoningOutcome = await understand(
          customerMessage,
          workspace,
          catalog,
          history as any,
          fallbackService,
          storeId,
          conversationId
        );
        
        // ── FAST PATH HIT: pakai payload langsung ──
        if (reasoningOutcome.outcome === 'tier') {
          const payload = reasoningOutcome.payload as any;
          const replyText = payload?.message?.content || payload?.reply || payload?.content || 'Maaf kak, saya kurang paham.';

          const result = this.buildResult(conversationId, {
            source: ResponseSource.AI,
            content: replyText,
            confidence: 0.9,
            cost: 0,
            metadata: { engine: 'v2', outcome: reasoningOutcome.outcome, llmCalls: reasoningOutcome.llmCalls },
          });

          await this.saveMessage({ id: crypto.randomUUID(), conversationId, sender: 'customer', content: customerMessage, createdAt: new Date() } as ConversationMessage);
          await this.saveMessage(result.message);

          adapters.logger.info('Engine v2 active', { storeId, conversationId, outcome: reasoningOutcome.outcome, llmCalls: reasoningOutcome.llmCalls });
          return result;
        }

        // ── OUTCOME 'resolved': fast-path resolver (0 LLM) ──
        if (reasoningOutcome.outcome === 'resolved') {
          const payload = reasoningOutcome.payload as ResolvedPayload;
          const pending = workspace.pendings.find((p) => p.id === payload.pendingId);

          if (pending) {
            pending.status = 'resolved';
          }

          // EXECUTE: turunkan cart ops dari pending + resolvedIndices/matchedNames,
          // lalu validasi harga dari DB (I13/P2) sebelum mutasi — produk tidak ada
          // di DB (priceMap fallback 0) tidak dieksekusi.
          if (payload.action === 'EXECUTE' && pending) {
            const ops = this.deriveResolvedCartOps(pending, payload, catalog);
            const { valid: dbValid } = await validateCartOpsAgainstDb(ops, storeId);
            if (dbValid.length > 0) {
              await this.executeCartOps(dbValid, {
                conversationId,
                storeId,
                customerId,
                messages: [],
                customerCity: null,
              } as any, customerMessage);
              // ── P0 SAFETY BOUNDARY: mutasi cart sukses, jangan pernah jalan ke v1 ──
              v2MutationExecuted = true;
            }
          }

          try {
            // Save workspace ke kolom `workspace_v2` (T1 fix P3.1 — bukan lewat updateExtractedEntities yang NO-OP)
            const resolvedWs = saveWorkspace(workspace);
            await conversationContextService.updateWorkspaceV2(conversationId, JSON.parse(resolvedWs));

            // Compose reply dengan total dari DB cart
            const resolvedCart = await this.getCartFromDb(conversationId);
            // I-1a FIX: filter qty <= 0 (konsisten sama renderCartSummary filter :965).
            // Sebelumnya Number(i.qty || 1) memperlakukan qty=0 sebagai qty=1,
            // menyebabkan subtotal termasuk item yang tidak ditampilkan -> mismatch.
            const visibleCart = resolvedCart.filter((i) => Number(i.qty || 0) > 0);
            const resolvedSubtotal = visibleCart.reduce(
              (sum, i) => sum + (Number(i.price) * Number(i.qty || 0)),
              0
            );
            let resolvedReply: string;
            if (payload.action === 'EXECUTE') {
              resolvedReply = await this.renderCartSummary(conversationId, resolvedCart);
              if (resolvedSubtotal > 0) {
                resolvedReply += `\n\nTotal belanja Kakak: *Rp ${resolvedSubtotal.toLocaleString('id-ID')}*.`;
              }
            } else {
              resolvedReply = 'Oke Kak, sudah saya batalkan ya. 🙏';
            }

            const resolvedResult = this.buildResult(conversationId, {
              source: ResponseSource.SOP,
              content: resolvedReply,
              confidence: 0.9,
              cost: 0,
              metadata: { engine: 'v2', outcome: 'resolved', action: payload.action, llmCalls: reasoningOutcome.llmCalls },
            });

            await this.saveMessage({ id: crypto.randomUUID(), conversationId, sender: 'customer', content: customerMessage, createdAt: new Date() } as ConversationMessage);
            await this.saveMessage(resolvedResult.message);

            adapters.logger.info('Engine v2 active', { storeId, conversationId, outcome: 'resolved', action: payload.action, llmCalls: reasoningOutcome.llmCalls });
            return resolvedResult;
          } catch (postMutationErr) {
            // ── P0 SAFETY BOUNDARY: mutasi SUDAH terjadi → return safe reply ke customer ──
            if (v2MutationExecuted) {
              return buildSafeReply(postMutationErr);
            }
            // Mutasi belum terjadi → throw biar outer catch fallback ke v1
            throw postMutationErr;
          }
        }

        // 4. Execute planned acts (jika ada cart_update)
        if (reasoningOutcome.outcome === 'reasoned' && (reasoningOutcome as any).plannedActs.length > 0) {
          const priceMap = new Map<string, number>();
          for (const item of catalog) {
            priceMap.set(((item as any).name || '').toLowerCase(), (item as any).price ?? 0);
          }

          const cartActs = (reasoningOutcome as any).plannedActs.filter((a: any) => {
            const intent = ((a?.intent) || '').toLowerCase();
            return intent.includes('cart') || intent.includes('order') || intent.includes('buy') || intent.includes('remove') || intent.includes('hapus') || intent.includes('cancel') || intent.includes('delete') || intent.includes('batal');
          });
          for (const act of cartActs) {
            const actEntities = Array.isArray(act.entities) ? act.entities : [];
            if (actEntities.length > 0) {
              const productEntities = actEntities.filter((e: any) => e?.type === 'product' && typeof e.value === 'string' && e.value.trim().length > 0);
              if (productEntities.length > 0) {
                const intent = ((act.intent) || '').toLowerCase();
                const isRemove = intent.includes('remove') || intent.includes('hapus') || intent.includes('cancel') || intent.includes('delete') || intent.includes('batal');
                const qtyPerEntity = act.qty && productEntities.length === 1 ? act.qty : 1;
                const ops = productEntities.map((e: any) => ({
                  type: isRemove ? 'remove' : 'add',
                  product: e.value,
                  qty: qtyPerEntity,
                  price: isRemove ? 0 : (priceMap.get(String(e.value).toLowerCase()) ?? 0),
                }) as const);
                // Panggil executeCartOps existing dengan harga dari DB (I13), bukan LLM
                await this.executeCartOps(ops, {
                    conversationId,
                    storeId,
                    customerId,
                    messages: [],
                    customerCity: null
                } as any, customerMessage);
                // ── P0 SAFETY BOUNDARY: mutasi cart sukses, jangan pernah jalan ke v1 ──
                v2MutationExecuted = true;
              }
            }
          }
        }
        
         try {
          // 5. Save workspace ke kolom `workspace_v2` (T1 fix P3.1 — bukan lewat updateExtractedEntities yang NO-OP)
          const updatedWorkspace = saveWorkspace(workspace);
          await conversationContextService.updateWorkspaceV2(conversationId, JSON.parse(updatedWorkspace));

          // 6. Compose reply pakai composer-v2
          const composed = composeReply({
            plannedActs: (reasoningOutcome as any).plannedActs || [],
            reasoningResult: (reasoningOutcome as any).result || { acts: [], unmatched_mentions: [], topic_switch: false, draft_cart_ops: [], confidence: { entities: 0, intent: 0, selection: 0, topic: 0 } },
            workspace,
            catalog,
            clarificationAttempt: 1,
          });
          // I-2 FIX: safety-net truncate — composer-v2 sudah truncate reply_draft,
          // tapi ini juga memastikan reply akhir ≤2 kalimat (konsisten v1 path :657)
          // sebelum dikirim ke customer.
          const reply = truncateTo2Sentences(composed);

          // 7. Return result (same format as v1)
          const result = this.buildResult(conversationId, {
            source: ResponseSource.AI,
            content: reply,
            confidence: (reasoningOutcome as any).result?.confidence?.selection || 0.8,
            cost: 0,
            metadata: { engine: 'v2', outcome: reasoningOutcome.outcome, llmCalls: reasoningOutcome.llmCalls },
          });

          await this.saveMessage({ id: crypto.randomUUID(), conversationId, sender: 'customer', content: customerMessage, createdAt: new Date() } as ConversationMessage);
          await this.saveMessage(result.message);

          adapters.logger.info('Engine v2 active', { storeId, conversationId, outcome: reasoningOutcome.outcome, error: (reasoningOutcome as any).error, llmCalls: reasoningOutcome.llmCalls });
          return result;
        } catch (postMutationErr) {
          // ── P0 SAFETY BOUNDARY: mutasi SUDAH terjadi → return safe reply ke customer ──
          if (v2MutationExecuted) {
            return buildSafeReply(postMutationErr);
          }
          // Mutasi belum terjadi → throw biar outer catch fallback ke v1
          throw postMutationErr;
        }
        
      } catch (err) {
        // CIRCUIT BREAKER: fallback ke v1
        adapters.logger.error('Engine v2 failed, fallback to v1', {
          storeId,
          conversationId,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
        // Fall through ke logic v1 di bawah
      }
    }
    
    // ── LOGIC V1 EXISTING (tidak diubah) ──

    // ── END ENGINE BRANCHING ──

    // Extract customerCity from context entities
    let customerCity: string | null = null;
    try {
      const ctxRow = await prisma.conversationContext.findUnique({
        where: { conversationId },
        select: { extractedEntities: true },
      });
      const raw = ctxRow?.extractedEntities as Record<string, unknown> | null;
      if (raw && typeof raw.customerCity === 'string') {
        customerCity = raw.customerCity as string;
      }
    } catch {
      // non-critical
    }

    // ── Audit tracking (DoD FASE 5: setiap pesan catat stages/llm/intent/cartOps) ──
    const stagesReached: string[] = [];
    let finalIntent: string | null = null;
    const cartOpsExecuted: CartOp[] = [];
    let llmCallCount = 0;
    let result: ResponseResult | null = null;

    // ── BAGIAN 2: Pending clarification resolver — runs FIRST, before normalizer (0 LLM) ──
    // I10: afirmatif/negasi menutup klarifikasi V0 LLM. Menggunakan resolvePending
    // (pure, action-based) dari chat/pendingClarification.js.
    const pendingRow = await prisma.conversationContext.findUnique({
      where: { conversationId },
      select: { extractedEntities: true },
    });
    const entities = conversationContextService.parseExtractedEntities(pendingRow?.extractedEntities);
    const pending = conversationContextService.getPendingClarification(entities);
    const rawEntities = (pendingRow?.extractedEntities as Record<string, unknown>) || {};
    const previousMutation = rawEntities.previousMutation as
      | { cartSnapshot: unknown[]; message: string }
      | null
      | undefined;

    if (pending) {
      stagesReached.push('resolver');
      const cartOps = this.flattenPendingOps(pending);
      const resolved = resolvePending(
        { pending: { ops: cartOps, snapshot: previousMutation?.cartSnapshot, retryCount: pending.retry_count ?? 0 } },
        customerMessage
      );

      // Save customer message
      await this.saveMessage({
        id: crypto.randomUUID(),
        conversationId,
        sender: 'customer',
        content: customerMessage,
        createdAt: new Date(),
      } as ConversationMessage);

      if (resolved.action === 'ESCALATE') {
        finalIntent = 'escalate';
        // TASK C1 (Stage 2): perubahan status DB + balasan jujur.
        // Escalate hanya dijalankan ketika clarification sudah gagal berulang
        // (retry_count >= 1 / resolvePending ESCALATE). Pada titik ini AI sudah
        // tidak bisa melanjutkan — tandai conversation butuh perhatian manusia
        // pakai konvensi yang SUDAH ADA (human_takeover + humanTakeoverAt,
        // lihat routes/conversations.ts:88) sehingga owner terlihat di dashboard
        // (admin/stores.ts:547 filter humanTakeoverAt != null).
        await this.markHumanTakeover(conversationId);
        const escalateReply = composeEscalateReply();
        await this.saveMessage({
          id: crypto.randomUUID(),
          conversationId,
          sender: 'assistant',
          content: escalateReply,
          source: ResponseSource.HUMAN,
          createdAt: new Date(),
        } as ConversationMessage);
        await conversationContextService.refreshSession(conversationId);
        this.logPipelineAudit(conversationId, stagesReached, llmCallCount, finalIntent, cartOpsExecuted);
        return this.buildResult(conversationId, {
          source: ResponseSource.HUMAN,
          content: escalateReply,
          confidence: 0.9,
          cost: 0,
          metadata: { reason: 'escalation_clarification_retry_exceeded' },
        });
      }

      // Clear pending — applies for both EXECUTE and ROLLBACK
      await conversationContextService.clearPendingClarification(conversationId);
      await this.clearPreviousMutation(conversationId);

      if (resolved.action === 'EXECUTE') {
        finalIntent = 'execute_pending';
        // Execute pending cart ops (0 LLM) — fix I13: harga dari DB via modifyCart
        if (resolved.ops && resolved.ops.length > 0) {
          // I13+P2: validasi harga pending cart_ops terhadap DB — ganti harga
          // LLM (disimpan di pending options) dengan harga DB sebelum mutasi.
          // Produk tidak ada di DB → tidak dieksekusi (bukan reject transaksi total).
          const { valid: dbValid } = await validateCartOpsAgainstDb(resolved.ops, storeId);
          for (const op of dbValid) {
            await conversationContextService.modifyCart(conversationId, 'add', {
              addedProduct: op.product,
              qty: op.qty,
              price: op.price,
            });
            cartOpsExecuted.push(op);
          }
        }
        const cart = await this.getCartFromDb(conversationId);
        const reply = await this.renderCartSummary(conversationId, cart, undefined);
        await this.saveMessage({
          id: crypto.randomUUID(),
          conversationId,
          sender: 'assistant',
          content: reply,
          source: ResponseSource.SOP,
          createdAt: new Date(),
        } as ConversationMessage);
        await conversationContextService.refreshSession(conversationId);
        this.logPipelineAudit(conversationId, stagesReached, llmCallCount, finalIntent, cartOpsExecuted);
        return this.buildResult(conversationId, {
          source: ResponseSource.SOP,
          content: reply,
          confidence: 0.9,
          cost: 0,
          metadata: { reason: 'resolver_no_llm', cartOpsExecuted: cartOpsExecuted.length },
        });
      }

      if (resolved.action === 'ROLLBACK') {
        finalIntent = 'rollback';
        if (resolved.snapshot) {
          await conversationContextService.restoreCart(conversationId, resolved.snapshot as any[]);
        }
        const reply = 'Oke Kak, sudah saya batalkan ya. 🙏';
        await this.saveMessage({
          id: crypto.randomUUID(),
          conversationId,
          sender: 'assistant',
          content: reply,
          source: ResponseSource.SOP,
          createdAt: new Date(),
        } as ConversationMessage);
        await conversationContextService.refreshSession(conversationId);
        this.logPipelineAudit(conversationId, stagesReached, llmCallCount, finalIntent, cartOpsExecuted);
        return this.buildResult(conversationId, {
          source: ResponseSource.SOP,
          content: reply,
          confidence: 0.9,
          cost: 0,
          metadata: { reason: 'rollback' },
        });
      }

      // RETRY — belum jelas, increment retry dan re-ask
      finalIntent = 'retry';
      const exceeded = await conversationContextService.incrementClarificationRetry(conversationId);
      if (exceeded) {
        finalIntent = 'escalate';
        // TASK C1 (Stage 2): tandai human_takeover agar owner dapat alert di
        // dashboard (human_takeoverAt != null) + balasan jujur ke customer.
        // (Bukan generic "kurang paham".)
        await this.markHumanTakeover(conversationId);
        const escalateReply = composeEscalateReply();
        await this.saveMessage({
          id: crypto.randomUUID(),
          conversationId,
          sender: 'assistant',
          content: escalateReply,
          source: ResponseSource.HUMAN,
          createdAt: new Date(),
        } as ConversationMessage);
        await conversationContextService.refreshSession(conversationId);
        this.logPipelineAudit(conversationId, stagesReached, llmCallCount, finalIntent, cartOpsExecuted);
        return this.buildResult(conversationId, {
          source: ResponseSource.HUMAN,
          content: escalateReply,
          confidence: 0.9,
          cost: 0,
          metadata: { reason: 'escalation_clarification_retry_exceeded' },
        });
      }
      const reply = pending.question ?? 'Masih kurang jelas nih. Bisa Kakak beri tahu pilihan Kakak?';
      await this.saveMessage({
        id: crypto.randomUUID(),
        conversationId,
        sender: 'assistant',
        content: reply,
        source: ResponseSource.SOP,
        createdAt: new Date(),
      } as ConversationMessage);
      await conversationContextService.refreshSession(conversationId);
      this.logPipelineAudit(conversationId, stagesReached, llmCallCount, finalIntent, cartOpsExecuted);
      return this.buildResult(conversationId, {
        source: ResponseSource.SOP,
        content: reply,
        confidence: 0.85,
        cost: 0,
        metadata: { reason: 'resolver_retry' },
      });
    }

    // ── BAGIAN 1: Normalizer (0 LLM) ───────────────────────────────────
    // I12: guard nama produk — cek produk DULU (fuzzy match), jangan dimutasi.
    stagesReached.push('normalizer');
    const storeProducts = await this.getStoreProducts(storeId);
    const productDictionary = storeProducts.map((p) => p.name);
    const normalizedMsg = normalize(customerMessage, productDictionary);
    
    // Bangun PipelineContext sekali — dibawa ke Stage 3 + Stage 4.
    const pipelineCtx: PipelineContext = await this.buildPipelineContext(
      storeId,
      customerId,
      conversationId,
      context,
      customerCity,
      conversation.customerName ?? null,
      storeProducts
    );
    
    // ── STAGE 3: Rule-based fast-path tiers (0 LLM) ────────────────────
    // I13: reply Stage 3 hanya memakai harga dari DB, tidak dari LLM.
    // getResponse kembalikan terminal fallback (source HUMAN) bila tidak ada
    // tier yang cocok; perlakukan sebagai miss agar Stage 4 (LLM) dapat jalan.
    stagesReached.push('tier3');
    const tierResult = await fallbackService.getResponse(normalizedMsg, pipelineCtx);
    if (tierResult && tierResult.source !== ResponseSource.HUMAN) {
      result = tierResult;
      finalIntent = 'fastpath';
    }
    
    // ── STAGE 4: Single LLM Interpreter (MAKS 1 CALL) ──────────────────
    // I8: cek ctx.llmCalledThisTurn sebelum panggil runOneCall.
    if (!result && !pipelineCtx.llmCalledThisTurn) {
      stagesReached.push('llm');
      pipelineCtx.llmCalledThisTurn = true;
      llmCallCount = 1;
      finalIntent = 'llm';
      const llmResult = await runOneCall(normalizedMsg, pipelineCtx);
    
      if (llmResult) {
        finalIntent = llmResult.intent ?? 'llm';
        let executedAdd = false;
    
        // I15 + P2: validateCartOpsAgainstDb — harga SELALU dari DB (bukan
        // LLM). Produk tidak ada di DB → masuk `missing` (lapor ke customer),
        // tidak dieksekusi (bukan reject transaksi total).
        if (llmResult.cart_ops && llmResult.cart_ops.length > 0) {
          const { valid, missing } = await validateCartOpsAgainstDb(llmResult.cart_ops, storeId);
          if (valid.length > 0) {
            await this.executeCartOps(valid, pipelineCtx, normalizedMsg);
            executedAdd = valid.some((o) => o.type === 'add');
            cartOpsExecuted.push(...valid);
          }
          if (missing.length > 0) {
            llmResult.missing_info = [...(llmResult.missing_info || []), ...missing];
          }
        }
    
        if (llmResult.clarification) {
          // Simpan pending BEFORE kirim pertanyaan (BAGIAN 2.2)
          await conversationContextService.setPendingClarification(conversationId, {
            question: llmResult.clarification.question,
            options: llmResult.clarification.options,
            expected_type: llmResult.clarification.expected_type,
          });
          result = this.buildResult(conversationId, {
            source: ResponseSource.SOP,
            content: llmResult.clarification.question,
            confidence: 0.85,
            cost: 0,
            metadata: { reason: 'clarification_asked' },
          });
        } else if (llmResult.reply_draft) {
          // Guardrail: reply_draft maks 2 kalimat
          result = this.buildResult(conversationId, {
            source: ResponseSource.AI,
            content: truncateTo2Sentences(llmResult.reply_draft),
            confidence: llmResult.confidence,
            cost: 0,
            metadata: {
              source: 'interpreter',
              intent: llmResult.intent,
              missing_info: llmResult.missing_info || undefined,
            },
          });
        } else if (executedAdd) {
          // Safety-net: add dieksekusi tapi LLM tidak sertakan reply_draft →
          // render keranjang dari DB state (harga dari DB, bukan LLM).
          const cart = await this.getCartFromDb(conversationId);
          const reply = await this.renderCartSummary(conversationId, cart, undefined);
          result = this.buildModifyCartResult(conversationId, reply);
        }
      }
    }
    
    // ── STAGE 5: Dead-end fallback ─────────────────────────────────────
    if (!result) {
      stagesReached.push('deadend');
      finalIntent = 'dead_end';
      result = this.buildResult(conversationId, {
        source: ResponseSource.HUMAN,
        content: 'Maaf kak, saya kurang paham. Bisa diulang?',
        confidence: 0.5,
        cost: 0,
        metadata: { reason: 'dead_end_fallback' },
      });
    }

    // ── SHADOW HOOK (log-only, background, fail-open) ──
    if (shouldRunShadow(storeId)) {
      // Background execution — tidak menambah latensi jalur kritis
      setImmediate(async () => {
        try {
          // Jalankan reasoning engine v3.2
          const reasoningOutcome = await understand(
            customerMessage,
            context as any,
            (await this.getStoreProducts(storeId)).map((p) => ({
              id: 'unknown',
              name: p.name,
              price: p.price,
              category: null,
            })),
            context.messages.map((m) => ({
              role: m.sender === 'customer' ? 'user' : 'assistant',
              content: m.content,
            })) as any,
            fallbackService,
            storeId
          );

          // Build shadow entry
          const reasoned = reasoningOutcome.outcome === 'reasoned' ? reasoningOutcome : null;
          const shadowEntry = buildShadowEntry({
            conversationId,
            messageId: crypto.randomUUID(),
            storeId,
            oldSource: result!.source,
            oldReply: result!.message.content,
            oldEntities: result!.message.metadata?.entities ?? [],
            newOutcome: reasoningOutcome.outcome,
            reasoningResult: reasoned ? reasoned.result : {
              acts: [],
              unmatched_mentions: [],
              topic_switch: false,
              draft_cart_ops: [],
              confidence: { entities: 0, intent: 0, selection: 0, topic: 0 },
            } as any,
            plannedActs: reasoned ? reasoned.plannedActs : [],
            validatorReasons: [],
            validatorRetryable: false,
            llmCalls: reasoningOutcome.llmCalls as 0 | 1 | 2,
          });

          // Log shadow entry
          logShadowEntry(shadowEntry);
        } catch (err) {
          // Fail-open: jangan ganggu respons lama
          adapters.logger.warn('Shadow reasoning failed', {
            conversationId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
    }
    
    await this.saveMessage({
      id: crypto.randomUUID(),
      conversationId,
      sender: 'customer',
      content: customerMessage,
      createdAt: new Date(),
    } as ConversationMessage);
    await this.saveMessage(result.message);
    await this.updateConversationStats(context, result);
    
    // Sinkronkan pesan ke context + refresh sesi
    await conversationContextService.appendMessage(conversationId, {
      id: crypto.randomUUID(),
      conversationId,
      sender: 'customer',
      content: customerMessage,
      createdAt: new Date(),
    } as ConversationMessage);
    await conversationContextService.appendMessage(conversationId, result.message);
    await conversationContextService.refreshSession(conversationId);
    
    // Done-ordering signal → finalize draft order to waiting_address
    if (orderService.detectDoneOrdering(normalizedMsg)) {
      await orderService.finalizeDraftOrder(conversationId);
    }
    
    // ── Audit log (DoD FASE 5) ──
    this.logPipelineAudit(conversationId, stagesReached, llmCallCount, finalIntent, cartOpsExecuted);
    
    result.metadata = {
      ...(result.metadata || {}),
      stagesReached,
      llmCallCount,
      finalIntent,
      cartOpsExecuted: cartOpsExecuted.length,
    };
    
    return result;

  }

  /**
   * Bungkus teks balasan MODIFY_CART menjadi ResponseResult standar.
   */
  /**
   * Ambil daftar produk aktif toko sebagai { name, price, stock }.
   * Dipakai I12 (guard normalizer) + validasi interpreter (validateCartOps).
   */
  private async getStoreProducts(
    storeId: string
  ): Promise<PipelineContext['storeProducts']> {
    const products = await productService.listActiveProducts(storeId);
    return products.map((p) => ({
      name: p.name,
      price: p.price ?? 0,
      stock: p.stock ?? null,
    }));
  }

  /**
   * Bangun PipelineContext (biru) dari ConversationContext DB + relasi.
   * messages sudah termasuk pesan pelanggan terbaru (dari getOrCreateContext).
   */
  private async buildPipelineContext(
    storeId: string,
    customerId: string,
    conversationId: string,
    context: ConversationContext,
    customerCity: string | null,
    customerName: string | null,
    storeProducts: PipelineContext['storeProducts']
  ): Promise<PipelineContext> {
    const ctxRow = await prisma.conversationContext.findUnique({
      where: { conversationId },
      select: { extractedEntities: true },
    });
    const entities = conversationContextService.parseExtractedEntities(ctxRow?.extractedEntities);
    const cart = entities.confirmedItems || [];

    // activeOrder: prefer 'draft' (current working cart, harga dari DB) over
    // other non-terminal statuses. 'pending' (mis. hasil createOrder katalog)
    // dan status lain hanya dipilih sebagai fallback bila memang tidak ada draft,
    // agar tidak memilih baris pending jadi order aktif dan menimpa harga
    // keranjang yang sedang dibangun di dialog ini. Lihat BUG I-3
    // (laporan-taskP4-fix.md §6 temuan #4).
    let activeOrder = await prisma.order.findFirst({
      where: {
        conversationId,
        deletedAt: null,
        orderStatus: 'draft',
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, orderStatus: true, items: true, notes: true },
    });

    // Fallback hanya bila tidak ada draft: ambil order non-terminal paling baru.
    if (!activeOrder) {
      activeOrder = await prisma.order.findFirst({
        where: {
          conversationId,
          deletedAt: null,
          orderStatus: { notIn: ['shipped', 'delivered', 'cancelled'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, orderStatus: true, items: true, notes: true },
      });
    }

    return {
      storeId,
      customerId,
      conversationId,
      messages: context.messages,
      customerCity,
      customerName,
      cart,
      activeOrder: activeOrder as PipelineContext['activeOrder'],
      pendingClarification: entities.pendingClarification ?? null,
      llmCalledThisTurn: false,
      storeProducts,
    };
  }

  /**
   * Execute (add / remove) validated cart_ops ke DB, lalu sync ke draft order.
   * Untuk remove, snapshot cart sebelum mutasi agar negasi -> rollback masih
   * memungkinkan. I15: hanya dipanggil setelah validateCartOps mengembalikan valid.
   */
  private async executeCartOps(
    ops: CartOp[],
    pipelineCtx: PipelineContext,
    message: string
  ): Promise<ConfirmedItem[]> {
    const { conversationId, storeId, customerId } = pipelineCtx;

    const hasRemove = ops.some((o) => o.type === 'remove');
    let cartBefore: ConfirmedItem[] = [];
    if (hasRemove) {
      cartBefore = await this.getCartFromDb(conversationId);
      await this.storePreviousMutation(
        conversationId,
        cartBefore.map((i) => ({ product: i.product, qty: i.qty ?? null, price: i.price ?? null })),
        message
      );
    }

    let items: ConfirmedItem[] = cartBefore;
    for (const op of ops) {
      if (op.type === 'add') {
        items = await conversationContextService.modifyCart(conversationId, 'add', {
          addedProduct: op.product,
          qty: op.qty,
          price: op.price,
        });
      } else if (op.type === 'remove') {
        items = await conversationContextService.modifyCart(conversationId, 'remove', {
          cancelledProduct: op.product,
        });
      }
    }

    if (ops.length > 0) {
      await orderService.syncCartStateToDraftOrder(conversationId, storeId, customerId, items, null);
    }
    return items;
  }

  /**
   * Baca snapshot keranjang terkonfirmasi dari DB (extractedEntities).
   */
  private async getCartFromDb(conversationId: string): Promise<ConfirmedItem[]> {
    const ctxRow = await prisma.conversationContext.findUnique({
      where: { conversationId },
      select: { extractedEntities: true },
    });
    return conversationContextService.parseExtractedEntities(ctxRow?.extractedEntities).confirmedItems || [];
  }

  /** BAGIAN 2.4 — Store previousCart snapshot untuk rollback */
  private async storePreviousMutation(
    conversationId: string,
    cartSnapshot: { product: string; qty?: number | string | null; price?: number | null }[],
    message: string
  ): Promise<void> {
    try {
      const ctxRow = await prisma.conversationContext.findUnique({
        where: { conversationId },
        select: { extractedEntities: true },
      });
      const entities = (ctxRow?.extractedEntities as Record<string, unknown>) || {};
      await prisma.conversationContext.update({
        where: { conversationId },
        data: {
          extractedEntities: {
            ...entities,
            previousMutation: { cartSnapshot, message },
          } as any,
        },
      });
    } catch (e) {
      adapters.logger.warn('Failed to store previousMutation', { error: (e as Error).message });
    }
  }

  /** BAGIAN 2.5 — Render cart state dari DB (bukan dari memory) */
  private async renderCartSummary(
    conversationId: string,
    currentItems: ConfirmedItem[],
    removedItemName?: string
  ): Promise<string> {
    let replyText: string;
    if (removedItemName) {
      replyText = `Oke Kak, *${removedItemName}* sudah dihapus dari keranjang ya. 🛒`;
    } else {
      replyText = 'Keranjang belanja Kakak sudah diperbarui ya.';
    }
    if (currentItems.length > 0) {
      const cartSummary = currentItems
        .filter((i) => Number(i.qty || 0) > 0)
        .map((i) => {
          const qty = typeof i.qty === 'number' ? i.qty : 1;
          const price = typeof i.price === 'number' ? i.price : 0;
          return `• ${i.product} ×${qty}${price > 0 ? ` — Rp ${(price * qty).toLocaleString('id-ID')}` : ''}`;
        })
        .join('\n');
      replyText += `\n\n*Keranjang sekarang:*\n${cartSummary}\n\nMau tambah yang lain atau sudah cukup Kak? 😊`;
    } else {
      replyText += '\n\nKeranjang Kakak sekarang kosong. Mau cari produk lain? 😊';
    }
    return replyText;
  }

  private buildModifyCartResult(conversationId: string, replyText: string): ResponseResult {
    const msg: ConversationMessage = {
      id: crypto.randomUUID(),
      conversationId,
      sender: 'assistant',
      content: replyText,
      source: ResponseSource.PRODUCT,
      createdAt: new Date(),
    };
    return {
      conversationId,
      message: msg,
      source: ResponseSource.PRODUCT,
      confidence: 0.95,
      cost: 0,
      requiresHumanReview: false,
      metadata: { reason: 'modify_cart' },
    };
  }

  private buildResult(conversationId: string, option: { source: ResponseSource; content: string; confidence: number; cost: number; metadata?: Record<string, any> }): ResponseResult {
    const msg: ConversationMessage = {
      id: crypto.randomUUID(),
      conversationId,
      sender: 'assistant',
      content: option.content,
      source: option.source,
      createdAt: new Date(),
    };
    return {
      conversationId,
      message: msg,
      source: option.source,
      confidence: option.confidence,
      cost: option.cost,
      requiresHumanReview: false,
      metadata: option.metadata || {},
    };
  }


  private async getOrCreateContext(
    storeId: string,
    customerId: string,
    conversationId: string,
    newMessage: string
  ): Promise<ConversationContext> {

    const history = await prisma.conversationHistory.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });

    // Rolling context window: hanya ambil pesan terakhir (efisien untuk LLM)
    const ROLLING_SIZE = 10;
    const trimmedHistory = history.slice(-ROLLING_SIZE);

    const allMessages = [
      ...trimmedHistory.map(m => ({
        id: m.id,
        conversationId: m.conversationId,
        sender: m.role === 'user' ? 'customer' : 'assistant' as const,
        content: m.content,
        source: (m.source as ResponseSource) || undefined,
        cost: m.costUSD,
        createdAt: m.createdAt,
      })),
      {
        id: crypto.randomUUID(),
        conversationId,
        sender: 'customer' as const,
        content: newMessage,
        createdAt: new Date(),
      },
    ];

    return {
      storeId,
      customerId,
      conversationId,
      messages: allMessages as ConversationMessage[],
      lastMessageAt: new Date(),
      status: 'active',
    };
  }

  private async saveMessage(message: ConversationMessage): Promise<void> {
    try {
      await prisma.conversationHistory.create({
        data: {
          id: message.id,
          conversationId: message.conversationId,
          role: message.sender === 'customer' ? 'user' : 'assistant',
          content: message.content,
          source: message.source || null,
          costUSD: message.cost || 0,
          metadata: message.metadata || undefined,
          createdAt: message.createdAt,
        },
      });
    } catch (error) {
      adapters.logger.error('Failed to save message', error as Error);
    }
  }

  private async updateConversationStats(
    context: ConversationContext,
    result: ResponseResult
  ): Promise<void> {
    const isAI = result.source === ResponseSource.AI;
    const isFAQ = result.source === ResponseSource.FAQ;

    // NOTE: human_takeover di-set hanya oleh circuit breaker (notifyHumanTakeover)
    // di MessageProcessorService. Jangan auto-set di sini karena akan
    // menimbonloop: resume AI → AI gagal → status kembali human_takeover.
    // Individual AI failures (FallbackService HUMAN) harus tetap open
    // agar bisa auto-recovery setelah circuit breaker cooldown.
    try {
      await prisma.conversation.update({
        where: { id: context.conversationId },
        data: {
          lastMessageAt: new Date(),
          status: 'open',
          aiResponseCount: isAI ? { increment: 1 } : undefined,
          faqResponseCount: isFAQ ? { increment: 1 } : undefined,
        },
      });
    } catch {
      adapters.logger.warn('Failed to update conversation stats');
    }
  }

  /**
   * TASK C1 (Stage 2): tandai conversation butuh perhatian manusia pada titik
   * ESCALATE/terminal (clarification retry terbatasi). Reuses konvensi existing:
   * status='human_takeover' + humanTakeoverAt (routes/conversations.ts:88,
   * circuit-breaker message-processor.service.ts:491).
   *
   * Alasan aman (tidak menimbonloop): cabang ESCALATE/terminal di panggil di
   * akhir turn dan tidak pernah memicu LLM lagi di turn yang sama; serta guard
   * di line 80 akan me-skip semua balasan AI sampai owner reset status lewat
   * PUT /api/conversations/:id/status. Jadi tidak ada retry otomatis ke dalam
   * loop ini. (Catatan line ~1051 tentang "jangan auto-set pada AI failure
   * biasa" tetap berlaku untuk jalur non-escalate.)
   */
  private async markHumanTakeover(conversationId: string): Promise<void> {
    try {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: escalateStatusUpdate(),
      });
      adapters.logger.info('Escalation: conversation marked for human takeover', {
        conversationId,
        status: 'human_takeover',
      });
    } catch (err) {
      adapters.logger.warn('Failed to mark human_takeover for escalation', {
        conversationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ============================================================
  // Phase 1.9.2 — Context-aware conversation methods
  // ============================================================

  /**
   * Ambil percakapan lengkap termasuk context dan orders (dengan items).
   */
  async getConversationWithContext(conversationId: string): Promise<ConversationWithContext | null> {
    const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv || conv.deletedAt) return null;

    const [context, orders] = await Promise.all([
      conversationContextService.getContext(conversationId),
      orderService.getOrdersByConversation(conversationId),
    ]);

    return this.mapConversationWithContext(conv as any, context, orders);
  }

  /**
   * Buat percakapan baru + inisialisasi context-nya sekaligus.
   */
  async createConversation(
    storeId: string,
    customerId: string,
    customerPhone: string,
    customerName?: string
  ): Promise<ConversationWithContext> {
    const conv = await prisma.conversation.create({
      data: {
        storeId,
        customerId,
        customerPhone,
        customerName: customerName ?? null,
        channel: 'whatsapp',
        status: 'open',
      },
    });

    const context = await conversationContextService.initializeContext({
      storeId,
      customerId,
      conversationId: conv.id,
    });

    adapters.logger.info('Conversation created with context', { conversationId: conv.id, storeId });
    return this.mapConversationWithContext(conv as any, context, []);
  }

  /**
   * Simpan pesan ke conversation_history DAN sinkronkan ke context
   * (appendMessage + refreshSession).
   */
  async appendMessageWithContext(conversationId: string, role: string, content: string): Promise<void> {
    const message: ConversationMessage = {
      id: crypto.randomUUID(),
      conversationId,
      sender: role === 'user' ? 'customer' : 'assistant',
      content,
      createdAt: new Date(),
    };

    await prisma.conversationHistory.create({
      data: {
        id: message.id,
        conversationId,
        role,
        content,
        createdAt: message.createdAt,
      },
    });

    await conversationContextService.appendMessage(conversationId, message);
    await conversationContextService.refreshSession(conversationId);
  }

  /**
   * Update status percakapan. Jika 'resolved', set resolvedAt.
   */
  async updateConversationStatus(conversationId: string, status: string): Promise<void> {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        status,
        ...(status === 'resolved' ? { resolvedAt: new Date() } : {}),
      },
    });
    adapters.logger.info('Conversation status updated', { conversationId, status });
  }

  /**
   * Ambil percakapan terbuka terbaru (default 50), termasuk context & orders.
   */
  async getRecentConversations(storeId: string, limit = 50): Promise<ConversationWithContext[]> {
    const limitClamped = Math.min(Math.max(1, limit), 100);
    const convs = await prisma.conversation.findMany({
      where: { storeId, deletedAt: null, status: 'open' },
      orderBy: { lastMessageAt: 'desc' },
      take: limitClamped,
    });

    const results: ConversationWithContext[] = [];
    for (const conv of convs) {
      const [context, orders] = await Promise.all([
        conversationContextService.getContext(conv.id),
        orderService.getOrdersByConversation(conv.id),
      ]);
      results.push(this.mapConversationWithContext(conv as any, context, orders));
    }
    return results;
  }

  // ============================================================
  // Private helpers
  // ============================================================

  private mapConversationWithContext(
    conv: any,
    context: ConversationContextData | null,
    orders: any[]
  ): ConversationWithContext {
    return {
      id: conv.id,
      storeId: conv.storeId,
      customerId: conv.customerId,
      customerName: conv.customerName,
      customerPhone: conv.customerPhone,
      status: conv.status,
      channel: conv.channel,
      lastMessageAt: conv.lastMessageAt,
      aiResponseCount: conv.aiResponseCount,
      faqResponseCount: conv.faqResponseCount,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      context,
      orders,
    };
  }

  async getConversationStats(conversationId: string): Promise<ConversationStats> {
    const messages = await prisma.conversationHistory.findMany({
      where: { conversationId },
    });

    const sourceDistribution: Record<string, number> = {
      cache: 0, faq: 0, knowledge: 0, ai: 0, human: 0, fallback: 0,
    };

    let totalCost = 0;

    messages.forEach((m: any) => {
      if (m.source && m.source in sourceDistribution) {
        sourceDistribution[m.source]++;
      }
      totalCost += m.costUSD || 0;
    });

    return {
      conversationId,
      totalMessages: messages.length,
      sourceDistribution: sourceDistribution as Record<ResponseSource, number>,
      totalCost,
      averageResponseTime: 0,
    };
  }

  async findAllByStore(storeId: string): Promise<ConversationListItem[]> {
    return prisma.conversation.findMany({
      where: { storeId, deletedAt: null },
      orderBy: { lastMessageAt: 'desc' },
      select: {
        id: true,
        customerId: true,
        customerName: true,
        customerPhone: true,
        status: true,
        lastMessageAt: true,
        aiResponseCount: true,
        faqResponseCount: true,
      },
    });
  }

  async findByIdWithHistory(id: string): Promise<ConversationDetail | null> {
    const conv = await prisma.conversation.findUnique({
      where: { id },
    });
    if (!conv || conv.deletedAt) return null;

    const history = await prisma.conversationHistory.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        content: true,
        source: true,
        createdAt: true,
      },
    });

    return {
      id: conv.id,
      customerId: conv.customerId,
      customerName: conv.customerName,
      customerPhone: conv.customerPhone,
      status: conv.status,
      lastMessageAt: conv.lastMessageAt,
      aiResponseCount: conv.aiResponseCount,
      faqResponseCount: conv.faqResponseCount,
      history,
    };
  }

  // ── Audit logging (DoD FASE 5) ──────────────────────────────────────────
  private logPipelineAudit(
    conversationId: string,
    stagesReached: string[],
    llmCallCount: number,
    finalIntent: string | null,
    cartOpsExecuted: CartOp[]
  ): void {
    adapters.logger.info('Pipeline audit', {
      conversationId,
      stagesReached,
      llmCallCount,
      finalIntent,
      cartOpsExecuted: cartOpsExecuted.length,
    });
  }

  // ── Flatten pending clarification options into CartOp[] ───────────────
  private flattenPendingOps(pending: PendingClarification): CartOp[] {
    const ops: CartOp[] = [];
    if (pending.options && pending.options.length > 0) {
      for (const opt of pending.options) {
        const cartOps = (opt as { cartOps?: CartOp[] })?.cartOps;
        if (cartOps) ops.push(...cartOps);
      }
    }
    return ops;
  }

  // ── Derive CartOp[] dari pending v2 (workspace) + ResolvedPayload ────
  // Opsi pending v2 adalah label string (umumnya nama produk). Untuk EXECUTE,
  // matchedNames/resolvedIndices menandakan opsi yang dipilih → add qty 1,
  // harga dari catalog/DB (I13 — bukan dari LLM/fast-path).
  private deriveResolvedCartOps(
    pending: PendingV2,
    payload: ResolvedPayload,
    catalog: Array<{ name: string; price: number }>
  ): CartOp[] {
    const priceMap = new Map<string, number>();
    for (const c of catalog) {
      priceMap.set(c.name.toLowerCase(), c.price);
    }

    const names: string[] = payload.matchedNames && payload.matchedNames.length > 0
      ? payload.matchedNames
      : (payload.resolvedIndices ?? [])
          .map((i) => pending.options[i])
          .filter((n): n is string => typeof n === 'string');

    const ops: CartOp[] = [];
    for (const name of names) {
      const product = (name || '').trim();
      if (!product) continue;
      ops.push({
        type: 'add',
        product,
        qty: 1,
        price: priceMap.get(product.toLowerCase()) ?? 0,
      });
    }
    return ops;
  }

  // ── Clear previousMutation snapshot from extractedEntities ───────────
  private async clearPreviousMutation(conversationId: string): Promise<void> {
    try {
      const ctxRow = await prisma.conversationContext.findUnique({
        where: { conversationId },
        select: { extractedEntities: true },
      });
      const entities = conversationContextService.parseExtractedEntities(ctxRow?.extractedEntities);
      await prisma.conversationContext.update({
        where: { conversationId },
        data: { extractedEntities: { ...entities, previousMutation: null } as any },
      });
    } catch (e) {
      adapters.logger.warn('Failed to clear previousMutation', { error: (e as Error).message });
    }
  }
}

export const conversationService = new ConversationService();
