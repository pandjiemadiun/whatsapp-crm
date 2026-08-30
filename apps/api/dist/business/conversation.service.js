import { adapters } from '../adapters/container.js';
import { fallbackService } from './fallback.service.js';
import { orderService } from './order.service.js';
import { cartAuthority } from './cart-authority.js';
import { executeWaCartMutation } from './action-registry.js';
import { conversationContextService } from './conversation-context.service.js';
import { prisma } from '../infrastructure/prisma.js';
import { productService } from './product.service.js';
import { canonicalConversationStateService } from './canonical-context.service.js';
import { ApiError } from '../errors/ApiError.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import { normalize } from '../services/chat/normalizer.js';
import { runOneCall, validateCartOpsAgainstDb, truncateTo2Sentences } from '../services/chat/interpreter.js';
import { getStoreEngine } from '../services/chat/engine-config.js';
import { understand } from '../services/chat/reasoning.js';
import { loadWorkspace, incrementDeferredTurns, shouldAutoDrop, dropPending } from '../services/chat/workspace.js';
import { composeReply, composeEscalateReply, escalateStatusUpdate } from '../services/chat/composer-v2.js';
import { resolvePending } from '../services/chat/pendingClarification.js';
import { shouldRunShadow } from '../services/chat/shadow-config.js';
import { buildShadowEntry, logShadowEntry } from '../services/chat/shadow-logger.js';
import { ResponseSource, } from '../domain/types.js';
export class ConversationService {
    async processCustomerMessage(storeId, customerId, conversationId, customerMessage, channel = 'whatsapp', messageId) {
        adapters.logger.info('Processing customer message', { storeId, customerId, conversationId, channel });
        // Tenant isolation: if a conversation with this id already exists, it MUST
        // belong to the calling store. The upsert below matches by PK (id) alone,
        // so without this guard a merchant could inject messages into another
        // store's conversation by supplying the victim's conversationId.
        const existingConv = await prisma.conversation.findUnique({
            where: { id: conversationId },
            select: { storeId: true },
        });
        if (existingConv && existingConv.storeId !== storeId) {
            throw new ApiError(ErrorCodes.ERR_AUTH_FORBIDDEN, 'Conversation not found for store');
        }
        const conversation = await prisma.conversation.upsert({
            where: { id: conversationId },
            update: {},
            create: {
                id: conversationId,
                storeId: storeId,
                customerId: customerId,
                customerPhone: channel === 'web' ? null : customerId, // WA: pakai customerId(=phone asli); Web: null (bukan webUid)
                channel,
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
            });
            await prisma.conversation.update({
                where: { id: conversationId, storeId },
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
            const buildSafeReply = (error) => {
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
                // 1. Load workspace — sumber kebenaran: canonical boundary (G2-D.3).
                //    V2 engine tidak baca workspace_v2 secara langsung.
                //    CanonicalConversationStateService.getV2Workspace() membaca melalui
                //    canonical boundary, dengan legacy fallback ke extractedEntities bila
                //    workspace_v2 kosong (V1→V2 transition), kemudian konversi ke
                //    WorkspaceV2 untuk V2 engine. V2 writers tidak berubah hanya
                //    pada G2-D.5 (saveWorkspaceV2 → canonical boundary). READ path
                //    sudah dimigrasi ke canonical boundary.
                let workspace;
                const loaded = await canonicalConversationStateService.getV2Workspace(conversationId);
                if (loaded) {
                    // Canonical boundary mengembalikan WorkspaceV2 yang sudah merge
                    // canonical state (pendings, resolved_facts, options_presented,
                    // conversation_summary) + V2-specific draft_cart dari workspace_v2.
                    workspace = loaded;
                }
                else {
                    // Context tidak ada (baru dibuat) → WorkspaceV2 default.
                    workspace = loadWorkspace('{}');
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
                const reasoningOutcome = await understand(customerMessage, workspace, catalog, history, fallbackService, storeId, conversationId);
                // ── FAST PATH HIT: pakai payload langsung ──
                if (reasoningOutcome.outcome === 'tier') {
                    const payload = reasoningOutcome.payload;
                    const replyText = payload?.message?.content || payload?.reply || payload?.content || 'Maaf kak, saya kurang paham.';
                    const result = this.buildResult(conversationId, {
                        source: payload?.source || ResponseSource.AI,
                        content: replyText,
                        confidence: payload?.confidence ?? 0.9,
                        cost: payload?.cost ?? 0,
                        metadata: {
                            engine: 'v2',
                            outcome: reasoningOutcome.outcome,
                            llmCalls: reasoningOutcome.llmCalls,
                            ...(payload?.metadata || {}),
                        },
                    });
                    await this.saveMessage({ id: crypto.randomUUID(), conversationId, sender: 'customer', content: customerMessage, createdAt: new Date() });
                    await this.saveMessage(result.message);
                    adapters.logger.info('Engine v2 active', { storeId, conversationId, outcome: reasoningOutcome.outcome, llmCalls: reasoningOutcome.llmCalls });
                    return result;
                }
                // ── OUTCOME 'resolved': fast-path resolver (0 LLM) ──
                if (reasoningOutcome.outcome === 'resolved') {
                    const payload = reasoningOutcome.payload;
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
                            await executeWaCartMutation(dbValid, storeId, customerId, conversationId, messageId);
                            // ── P0 SAFETY BOUNDARY: mutasi cart sukses, jangan pernah jalan ke v1 ──
                            v2MutationExecuted = true;
                        }
                    }
                    try {
                        // G2-D.5: V2 engine write → canonical boundary (primary write → workspace_v2)
                        // CanonicalConversationStateService.saveWorkspaceV2() memetakan:
                        //   - canonical fields (pendings, resolved_facts, intent, options_presented, etc.) → updateCanonical (atomic CAS)
                        //   - V2 transient (draft_cart) → adapter write to workspace_v2 JSON (NOT canonical cart)
                        // V2 engine tidak lagi menulis workspace_v2 secara langsung (updateWorkspaceV2 removed).
                        await canonicalConversationStateService.saveWorkspaceV2(conversationId, workspace);
                        // Compose reply dengan total dari DB cart
                        const resolvedCart = await this.getCartFromDb(conversationId);
                        // I-1a FIX: filter qty <= 0 (konsisten sama renderCartSummary filter :965).
                        // Sebelumnya Number(i.qty || 1) memperlakukan qty=0 sebagai qty=1,
                        // menyebabkan subtotal termasuk item yang tidak ditampilkan -> mismatch.
                        const visibleCart = resolvedCart.filter((i) => Number(i.qty || 0) > 0);
                        const resolvedSubtotal = visibleCart.reduce((sum, i) => sum + (Number(i.price) * Number(i.qty || 0)), 0);
                        let resolvedReply;
                        if (payload.action === 'EXECUTE') {
                            resolvedReply = await this.renderCartSummary(conversationId, resolvedCart);
                            if (resolvedSubtotal > 0) {
                                resolvedReply += `\n\nTotal belanja Kakak: *Rp ${resolvedSubtotal.toLocaleString('id-ID')}*.`;
                            }
                        }
                        else {
                            resolvedReply = 'Oke Kak, sudah saya batalkan ya. 🙏';
                        }
                        const resolvedResult = this.buildResult(conversationId, {
                            source: ResponseSource.SOP,
                            content: resolvedReply,
                            confidence: 0.9,
                            cost: 0,
                            metadata: { engine: 'v2', outcome: 'resolved', action: payload.action, llmCalls: reasoningOutcome.llmCalls },
                        });
                        await this.saveMessage({ id: crypto.randomUUID(), conversationId, sender: 'customer', content: customerMessage, createdAt: new Date() });
                        await this.saveMessage(resolvedResult.message);
                        adapters.logger.info('Engine v2 active', { storeId, conversationId, outcome: 'resolved', action: payload.action, llmCalls: reasoningOutcome.llmCalls });
                        return resolvedResult;
                    }
                    catch (postMutationErr) {
                        // ── P0 SAFETY BOUNDARY: mutasi SUDAH terjadi → return safe reply ke customer ──
                        if (v2MutationExecuted) {
                            return buildSafeReply(postMutationErr);
                        }
                        // Mutasi belum terjadi → throw biar outer catch fallback ke v1
                        throw postMutationErr;
                    }
                }
                // 4. Execute planned acts (jika ada cart_update)
                if (reasoningOutcome.outcome === 'reasoned' && reasoningOutcome.plannedActs.length > 0) {
                    const priceMap = new Map();
                    for (const item of catalog) {
                        priceMap.set((item.name || '').toLowerCase(), item.price ?? 0);
                    }
                    const cartActs = reasoningOutcome.plannedActs.filter((a) => {
                        const intent = ((a?.intent) || '').toLowerCase();
                        return intent.includes('cart') || intent.includes('order') || intent.includes('buy') || intent.includes('remove') || intent.includes('hapus') || intent.includes('cancel') || intent.includes('delete') || intent.includes('batal');
                    });
                    for (const act of cartActs) {
                        const actEntities = Array.isArray(act.entities) ? act.entities : [];
                        if (actEntities.length > 0) {
                            const productEntities = actEntities.filter((e) => e?.type === 'product' && typeof e.value === 'string' && e.value.trim().length > 0);
                            if (productEntities.length > 0) {
                                const intent = ((act.intent) || '').toLowerCase();
                                const isRemove = intent.includes('remove') || intent.includes('hapus') || intent.includes('cancel') || intent.includes('delete') || intent.includes('batal');
                                const qtyPerEntity = act.qty && productEntities.length === 1 ? act.qty : 1;
                                const ops = productEntities.map((e) => ({
                                    type: isRemove ? 'remove' : 'add',
                                    product: e.value,
                                    qty: qtyPerEntity,
                                    price: isRemove ? 0 : (priceMap.get(String(e.value).toLowerCase()) ?? 0),
                                    // PV-P2c-LLM-B B3.2: thread free-text variant from entity.metadata.variant
                                    // into the CartOp so CartAuthority.resolveVariantByLabel can resolve
                                    // it to variantId (DB-driven, I13). Absent for non-variant products.
                                    variant: (e.metadata && typeof e.metadata === 'object' ? e.metadata.variant : null) ?? null,
                                }));
                                // Panggil executeWaCartMutation (idempoten via claim/FOR UPDATE) — harga dari DB (I13), bukan LLM
                                await executeWaCartMutation(ops, storeId, customerId, conversationId, messageId);
                                // ── P0 SAFETY BOUNDARY: mutasi cart sukses, jangan pernah jalan ke v1 ──
                                v2MutationExecuted = true;
                            }
                        }
                    }
                }
                // G2-D.8: persist LLM clarification to canonical workspace_v2.pendings[]
                // so the next customer turn can resolve it via tryFastPath.
                const clarification = reasoningOutcome.result?.clarification;
                if (clarification) {
                    const pendingId = crypto.randomUUID();
                    const pending = {
                        id: pendingId,
                        question: clarification.question,
                        options: clarification.options,
                        status: 'active',
                        attempts: 0,
                        deferred_turns: 0,
                        asked_at: new Date().toISOString(),
                    };
                    workspace.pendings.push(pending);
                }
                try {
                    // G2-D.5: V2 engine write → canonical boundary (primary write → workspace_v2)
                    await canonicalConversationStateService.saveWorkspaceV2(conversationId, workspace);
                    // 6. Compose reply pakai composer-v2
                    const composed = composeReply({
                        plannedActs: reasoningOutcome.plannedActs || [],
                        reasoningResult: reasoningOutcome.result || { acts: [], unmatched_mentions: [], topic_switch: false, draft_cart_ops: [], confidence: { entities: 0, intent: 0, selection: 0, topic: 0 } },
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
                        confidence: reasoningOutcome.result?.confidence?.selection || 0.8,
                        cost: 0,
                        metadata: { engine: 'v2', outcome: reasoningOutcome.outcome, llmCalls: reasoningOutcome.llmCalls },
                    });
                    await this.saveMessage({ id: crypto.randomUUID(), conversationId, sender: 'customer', content: customerMessage, createdAt: new Date() });
                    await this.saveMessage(result.message);
                    adapters.logger.info('Engine v2 active', { storeId, conversationId, outcome: reasoningOutcome.outcome, error: reasoningOutcome.error, llmCalls: reasoningOutcome.llmCalls });
                    return result;
                }
                catch (postMutationErr) {
                    // ── P0 SAFETY BOUNDARY: mutasi SUDAH terjadi → return safe reply ke customer ──
                    if (v2MutationExecuted) {
                        return buildSafeReply(postMutationErr);
                    }
                    // Mutasi belum terjadi → throw biar outer catch fallback ke v1
                    throw postMutationErr;
                }
            }
            catch (err) {
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
        // Extract customerCity from canonical state (G2-D.2 V1 read migration)
        let customerCity = null;
        try {
            const raw = (await canonicalConversationStateService.getFactWithLegacyFallback(conversationId, 'customerCity'));
            if (typeof raw === 'string') {
                customerCity = raw;
            }
        }
        catch {
            // non-critical
        }
        // ── Audit tracking (DoD FASE 5: setiap pesan catat stages/llm/intent/cartOps) ──
        const stagesReached = [];
        let finalIntent = null;
        const cartOpsExecuted = [];
        let llmCallCount = 0;
        let result = null;
        // ── BAGIAN 2: Pending clarification resolver — runs FIRST, before normalizer (0 LLM) ──
        // I10: afirmatif/negasi menutup klarifikasi V0 LLM. Menggunakan resolvePending
        // (pure, action-based) dari chat/pendingClarification.js.
        //
        // G2-D.2: V1 read migrasi ke canonical boundary (workspace_v2 → extractedEntities fallback).
        const pending = await canonicalConversationStateService.getV1PendingClarification(conversationId);
        const previousMutation = await canonicalConversationStateService.getV1PreviousMutation(conversationId);
        if (pending) {
            stagesReached.push('resolver');
            const cartOps = this.flattenPendingOps(pending);
            const resolved = resolvePending({ pending: { ops: cartOps, snapshot: previousMutation?.cartSnapshot, retryCount: pending.retry_count ?? 0 } }, customerMessage);
            // Save customer message
            await this.saveMessage({
                id: crypto.randomUUID(),
                conversationId,
                sender: 'customer',
                content: customerMessage,
                createdAt: new Date(),
            });
            if (resolved.action === 'ESCALATE') {
                finalIntent = 'escalate';
                // TASK C1 (Stage 2): perubahan status DB + balasan jujur.
                // Escalate hanya dijalankan ketika clarification sudah gagal berulang
                // (retry_count >= 1 / resolvePending ESCALATE). Pada titik ini AI sudah
                // tidak bisa melanjutkan — tandai conversation butuh perhatian manusia
                // pakai konvensi yang SUDAH ADA (human_takeover + humanTakeoverAt,
                // lihat routes/conversations.ts:88) sehingga owner terlihat di dashboard
                // (admin/stores.ts:547 filter humanTakeoverAt != null).
                await this.markHumanTakeover(conversationId, storeId);
                const escalateReply = composeEscalateReply();
                await this.saveMessage({
                    id: crypto.randomUUID(),
                    conversationId,
                    sender: 'assistant',
                    content: escalateReply,
                    source: ResponseSource.HUMAN,
                    createdAt: new Date(),
                });
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
            // G2-D.4: clearPendingClarification now mirrors to canonical internally
            await this.clearPreviousMutation(conversationId);
            // G2-D.4: clearPreviousMutation now mirrors to canonical internally
            if (resolved.action === 'EXECUTE') {
                finalIntent = 'execute_pending';
                // Execute pending cart ops (0 LLM) — fix I13: harga dari DB.
                // P9: arahkan mutasi ke CartAuthority (sama dengan flow utama :661),
                // BUKAN legacy modifyCart → extractedEntities.confirmedItems.
                if (resolved.ops && resolved.ops.length > 0) {
                    // I13+P2: validasi harga pending cart_ops terhadap DB — ganti harga
                    // LLM (disimpan di pending options) dengan harga DB sebelum mutasi.
                    // Produk tidak ada di DB → tidak dieksekusi (bukan reject transaksi total).
                    const { valid: dbValid } = await validateCartOpsAgainstDb(resolved.ops, storeId);
                    if (dbValid.length > 0) {
                        await executeWaCartMutation(dbValid, storeId, customerId, conversationId, messageId);
                        cartOpsExecuted.push(...dbValid);
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
                });
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
                // P9: rollback via CartAuthority (setara restoreCart), BUKAN legacy
                // extractedEntities.confirmedItems. Snapshot kosong/null → no-op
                // (sama seperti sebelumnya; storePreviousMutation tdk dipanggil di v1).
                if (resolved.snapshot && Array.isArray(resolved.snapshot) && resolved.snapshot.length > 0) {
                    // Pastikan draft Order ada (reconcile legacy confirmedItems kalau ada),
                    // lalu restore snapshot via CartAuthority.
                    await this.executeCartOps([], {
                        conversationId,
                        storeId,
                        customerId,
                    }, customerMessage);
                    await cartAuthority.restoreFromSnapshot(conversationId, storeId, customerId, resolved.snapshot);
                }
                const reply = 'Oke Kak, sudah saya batalkan ya. 🙏';
                await this.saveMessage({
                    id: crypto.randomUUID(),
                    conversationId,
                    sender: 'assistant',
                    content: reply,
                    source: ResponseSource.SOP,
                    createdAt: new Date(),
                });
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
            // G2-D.2 CLEANUP: increment canonical retry count too
            await canonicalConversationStateService.incrementV1PendingRetry(conversationId);
            if (exceeded) {
                finalIntent = 'escalate';
                // TASK C1 (Stage 2): tandai human_takeover agar owner dapat alert di
                // dashboard (human_takeoverAt != null) + balasan jujur ke customer.
                // (Bukan generic "kurang paham".)
                await this.markHumanTakeover(conversationId, storeId);
                const escalateReply = composeEscalateReply();
                await this.saveMessage({
                    id: crypto.randomUUID(),
                    conversationId,
                    sender: 'assistant',
                    content: escalateReply,
                    source: ResponseSource.HUMAN,
                    createdAt: new Date(),
                });
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
            });
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
        const pipelineCtx = await this.buildPipelineContext(storeId, customerId, conversationId, context, customerCity, conversation.customerName ?? null, storeProducts);
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
                        await executeWaCartMutation(valid, storeId, customerId, conversationId, messageId);
                        executedAdd = valid.some((o) => o.type === 'add');
                        cartOpsExecuted.push(...valid);
                    }
                    if (missing.length > 0) {
                        llmResult.missing_info = [...(llmResult.missing_info || []), ...missing];
                    }
                }
                if (llmResult.clarification) {
                    await conversationContextService.setPendingClarification(conversationId, {
                        question: llmResult.clarification.question,
                        options: llmResult.clarification.options,
                        expected_type: llmResult.clarification.expected_type,
                    });
                    // G2-D.4: setPendingClarification now mirrors to canonical internally
                    result = this.buildResult(conversationId, {
                        source: ResponseSource.SOP,
                        content: llmResult.clarification.question,
                        confidence: 0.85,
                        cost: 0,
                        metadata: { reason: 'clarification_asked' },
                    });
                }
                else if (llmResult.reply_draft) {
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
                }
                else if (executedAdd) {
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
                    const reasoningOutcome = await understand(customerMessage, context, (await this.getStoreProducts(storeId)).map((p) => ({
                        id: 'unknown',
                        name: p.name,
                        price: p.price,
                        category: null,
                    })), context.messages.map((m) => ({
                        role: m.sender === 'customer' ? 'user' : 'assistant',
                        content: m.content,
                    })), fallbackService, storeId);
                    // Build shadow entry
                    const reasoned = reasoningOutcome.outcome === 'reasoned' ? reasoningOutcome : null;
                    const shadowEntry = buildShadowEntry({
                        conversationId,
                        messageId: crypto.randomUUID(),
                        storeId,
                        oldSource: result.source,
                        oldReply: result.message.content,
                        oldEntities: result.message.metadata?.entities ?? [],
                        newOutcome: reasoningOutcome.outcome,
                        reasoningResult: reasoned ? reasoned.result : {
                            acts: [],
                            unmatched_mentions: [],
                            topic_switch: false,
                            draft_cart_ops: [],
                            confidence: { entities: 0, intent: 0, selection: 0, topic: 0 },
                        },
                        plannedActs: reasoned ? reasoned.plannedActs : [],
                        validatorReasons: [],
                        validatorRetryable: false,
                        llmCalls: reasoningOutcome.llmCalls,
                    });
                    // Log shadow entry
                    logShadowEntry(shadowEntry);
                }
                catch (err) {
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
        });
        await this.saveMessage(result.message);
        await this.updateConversationStats(context, result);
        // Sinkronkan pesan ke context + refresh sesi
        await conversationContextService.appendMessage(conversationId, {
            id: crypto.randomUUID(),
            conversationId,
            sender: 'customer',
            content: customerMessage,
            createdAt: new Date(),
        });
        await conversationContextService.appendMessage(conversationId, result.message);
        await conversationContextService.refreshSession(conversationId);
        // Done-ordering signal → finalize draft order to waiting_address
        // Delegates to CartAuthority.checkout which enforces stock validation,
        // storeId filtering, and state machine transition via transitionOrder.
        if (orderService.detectDoneOrdering(normalizedMsg)) {
            await orderService.finalizeDraftOrder(conversationId, context.storeId);
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
    async getStoreProducts(storeId) {
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
    async buildPipelineContext(storeId, customerId, conversationId, context, customerCity, customerName, storeProducts) {
        // G2-D.2: V1 cart read — read from extractedEntities.confirmedItems (consistent with
        // V1 modifyCart writes; migration to CartAuthority is G2-D.5 after writes migrate).
        // G2-D.2: V1 pending read via canonical boundary.
        const ctxRow = await prisma.conversationContext.findUnique({
            where: { conversationId },
            select: { extractedEntities: true },
        });
        const entities = conversationContextService.parseExtractedEntities(ctxRow?.extractedEntities);
        const cart = entities.confirmedItems || [];
        const pendingClarification = await canonicalConversationStateService.getV1PendingClarification(conversationId);
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
            activeOrder: activeOrder,
            pendingClarification: pendingClarification ?? null,
            llmCalledThisTurn: false,
            storeProducts,
        };
    }
    /**
     * Execute (add / remove) validated cart_ops ke DB, lalu sync ke draft order.
     * Menggunakan CartAuthority.executeOps sebagai single authoritative path
     * yang menulis OrderItem rows, Order.items JSON, dan confirmedItems JSON
     * atomically dalam satu $transaction.
     * I15: hanya dipanggil setelah validateCartOps mengembalikan valid.
     */
    async executeCartOps(ops, pipelineCtx, message) {
        const { conversationId, storeId, customerId } = pipelineCtx;
        if (ops.length > 0) {
            return await cartAuthority.executeOps(ops, storeId, customerId, conversationId);
        }
        // Empty ops — return current cart state
        return await cartAuthority.getCartAsConfirmedItems(conversationId);
    }
    /**
     * Baca snapshot keranjang terkonfirmasi.
     * G2-D.2 Part C: V1 cart read. V1 writes still go to extractedEntities.confirmedItems
     * (write migration is G2-D.5). getCartAsConfirmedItems would miss V1 writes that
     * haven't created draft Orders yet. Until writes migrate, read from extractedEntities
     * to stay consistent with V1 modifyCart writes.
     * TODO (G2-D.5): After V1 modifyCart → CartAuthority, switch to getCartAsConfirmedItems.
     */
    async getCartFromDb(conversationId) {
        const ctxRow = await prisma.conversationContext.findUnique({
            where: { conversationId },
            select: { extractedEntities: true },
        });
        return conversationContextService.parseExtractedEntities(ctxRow?.extractedEntities).confirmedItems || [];
    }
    /**
     * BAGIAN 2.4 — Store previousCart snapshot untuk rollback.
     *
     * G2-D.6: Canonical (workspace_v2) is PRIMARY authority via
     * writeV1PreviousMutation. The extractedEntities write is backward-compat
     * mirror (kept for legacy readers/tests, atomic via atomicCas).
     */
    async storePreviousMutation(conversationId, cartSnapshot, message) {
        // 1. Canonical: PRIMARY write (authority: workspace_v2)
        try {
            await canonicalConversationStateService.writeV1PreviousMutation(conversationId, cartSnapshot, message);
        }
        catch (err) {
            adapters.logger.warn('storePreviousMutation: failed to write to canonical', {
                conversationId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
        // 2. Backward-compat mirror to extractedEntities (atomic CAS)
        try {
            await conversationContextService.atomicCasExtractedEntities(conversationId, 'storePreviousMutation', async (row) => {
                const entities = conversationContextService.parseExtractedEntities(row.extractedEntities);
                // cartSnapshot is the V1 shape ({product, qty, price}[]); the legacy
                // extractedEntities mirror field previousMutation.cartSnapshot expects
                // ConfirmedItem[]. Cast preserves the pre-existing runtime write verbatim
                // (canonical writeV1PreviousMutation is the primary authority) — type-only.
                entities.previousMutation = { cartSnapshot: cartSnapshot, message };
                const res = await prisma.conversationContext.updateMany({
                    where: { conversationId, updatedAt: row.updatedAt },
                    data: { extractedEntities: entities },
                });
                return { count: res.count, value: null };
            });
        }
        catch (e) {
            adapters.logger.warn('Failed to store previousMutation (legacy mirror)', { error: e.message });
        }
    }
    /** BAGIAN 2.5 — Render cart state dari DB (bukan dari memory) */
    async renderCartSummary(conversationId, currentItems, removedItemName) {
        let replyText;
        if (removedItemName) {
            replyText = `Oke Kak, *${removedItemName}* sudah dihapus dari keranjang ya. 🛒`;
        }
        else {
            replyText = 'Keranjang belanja Kakak sudah diperbarui ya.';
        }
        if (currentItems.length > 0) {
            const cartSummary = currentItems
                .filter((i) => Number(i.qty || 0) > 0)
                .map((i) => {
                const qty = typeof i.qty === 'number' ? i.qty : 1;
                const price = typeof i.price === 'number' ? i.price : 0;
                return `• ${i.product} x${qty}${price > 0 ? ` — Rp ${(price * qty).toLocaleString('id-ID')}` : ''}`;
            })
                .join('\n');
            replyText += `\n\n*Keranjang sekarang:*\n${cartSummary}\n\nMau tambah yang lain atau sudah cukup Kak? 😊`;
        }
        else {
            replyText += '\n\nKeranjang Kakak sekarang kosong. Mau cari produk lain? 😊';
        }
        return replyText;
    }
    buildModifyCartResult(conversationId, replyText) {
        const msg = {
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
    buildResult(conversationId, option) {
        const msg = {
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
    async getOrCreateContext(storeId, customerId, conversationId, newMessage) {
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
                sender: m.role === 'user' ? 'customer' : 'assistant',
                content: m.content,
                source: m.source || undefined,
                cost: m.costUSD,
                createdAt: m.createdAt,
            })),
            {
                id: crypto.randomUUID(),
                conversationId,
                sender: 'customer',
                content: newMessage,
                createdAt: new Date(),
            },
        ];
        return {
            storeId,
            customerId,
            conversationId,
            messages: allMessages,
            lastMessageAt: new Date(),
            status: 'active',
        };
    }
    async saveMessage(message) {
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
        }
        catch (error) {
            adapters.logger.error('Failed to save message', error);
        }
    }
    async updateConversationStats(context, result) {
        const isAI = result.source === ResponseSource.AI;
        const isFAQ = result.source === ResponseSource.FAQ;
        // NOTE: human_takeover di-set hanya oleh circuit breaker (notifyHumanTakeover)
        // di MessageProcessorService. Jangan auto-set di sini karena akan
        // menimbonloop: resume AI → AI gagal → status kembali human_takeover.
        // Individual AI failures (FallbackService HUMAN) harus tetap open
        // agar bisa auto-recovery setelah circuit breaker cooldown.
        try {
            await prisma.conversation.update({
                where: { id: context.conversationId, storeId: context.storeId },
                data: {
                    lastMessageAt: new Date(),
                    status: 'open',
                    aiResponseCount: isAI ? { increment: 1 } : undefined,
                    faqResponseCount: isFAQ ? { increment: 1 } : undefined,
                },
            });
        }
        catch {
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
    async markHumanTakeover(conversationId, storeId) {
        try {
            await prisma.conversation.update({
                where: { id: conversationId, storeId },
                data: escalateStatusUpdate(),
            });
            adapters.logger.info('Escalation: conversation marked for human takeover', {
                conversationId,
                status: 'human_takeover',
            });
        }
        catch (err) {
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
    async getConversationWithContext(conversationId, storeId) {
        const conv = await prisma.conversation.findFirst({ where: { id: conversationId, storeId, deletedAt: null } });
        if (!conv)
            return null;
        const [context, orders] = await Promise.all([
            conversationContextService.getContext(conversationId),
            orderService.getOrdersByConversation(conversationId),
        ]);
        return this.mapConversationWithContext(conv, context, orders);
    }
    /**
     * Buat percakapan baru + inisialisasi context-nya sekaligus.
     */
    async createConversation(storeId, customerId, customerPhone, customerName, channel = 'whatsapp') {
        const conv = await prisma.conversation.create({
            data: {
                storeId,
                customerId,
                customerPhone,
                customerName: customerName ?? null,
                channel,
                status: 'open',
            },
        });
        const context = await conversationContextService.initializeContext({
            storeId,
            customerId,
            conversationId: conv.id,
        });
        adapters.logger.info('Conversation created with context', { conversationId: conv.id, storeId });
        return this.mapConversationWithContext(conv, context, []);
    }
    /**
     * Simpan pesan ke conversation_history DAN sinkronkan ke context
     * (appendMessage + refreshSession).
     */
    async appendMessageWithContext(conversationId, role, content) {
        const message = {
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
    async updateConversationStatus(conversationId, storeId, status) {
        await prisma.conversation.updateMany({
            where: { id: conversationId, storeId },
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
    async getRecentConversations(storeId, limit = 50) {
        const limitClamped = Math.min(Math.max(1, limit), 100);
        const convs = await prisma.conversation.findMany({
            where: { storeId, deletedAt: null, status: 'open' },
            orderBy: { lastMessageAt: 'desc' },
            take: limitClamped,
        });
        const results = [];
        for (const conv of convs) {
            const [context, orders] = await Promise.all([
                conversationContextService.getContext(conv.id),
                orderService.getOrdersByConversation(conv.id),
            ]);
            results.push(this.mapConversationWithContext(conv, context, orders));
        }
        return results;
    }
    // ============================================================
    // Private helpers
    // ============================================================
    mapConversationWithContext(conv, context, orders) {
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
    async getConversationStats(conversationId) {
        const messages = await prisma.conversationHistory.findMany({
            where: { conversationId },
        });
        const sourceDistribution = {
            cache: 0, faq: 0, knowledge: 0, ai: 0, human: 0, fallback: 0,
        };
        let totalCost = 0;
        messages.forEach((m) => {
            if (m.source && m.source in sourceDistribution) {
                sourceDistribution[m.source]++;
            }
            totalCost += m.costUSD || 0;
        });
        return {
            conversationId,
            totalMessages: messages.length,
            sourceDistribution: sourceDistribution,
            totalCost,
            averageResponseTime: 0,
        };
    }
    async findAllByStore(storeId) {
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
    async findByIdWithHistory(id, storeId) {
        const conv = await prisma.conversation.findFirst({
            where: { id, storeId, deletedAt: null },
        });
        if (!conv)
            return null;
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
    logPipelineAudit(conversationId, stagesReached, llmCallCount, finalIntent, cartOpsExecuted) {
        adapters.logger.info('Pipeline audit', {
            conversationId,
            stagesReached,
            llmCallCount,
            finalIntent,
            cartOpsExecuted: cartOpsExecuted.length,
        });
    }
    // ── Flatten pending clarification options into CartOp[] ───────────────
    flattenPendingOps(pending) {
        const ops = [];
        if (pending.options && pending.options.length > 0) {
            for (const opt of pending.options) {
                const cartOps = opt?.cartOps;
                if (cartOps)
                    ops.push(...cartOps);
            }
        }
        return ops;
    }
    // ── Derive CartOp[] dari pending v2 (workspace) + ResolvedPayload ────
    // Opsi pending v2 adalah label string (umumnya nama produk). Untuk EXECUTE,
    // matchedNames/resolvedIndices menandakan opsi yang dipilih → add qty 1,
    // harga dari catalog/DB (I13 — bukan dari LLM/fast-path).
    deriveResolvedCartOps(pending, payload, catalog) {
        const priceMap = new Map();
        for (const c of catalog) {
            priceMap.set(c.name.toLowerCase(), c.price);
        }
        const names = payload.matchedNames && payload.matchedNames.length > 0
            ? payload.matchedNames
            : (payload.resolvedIndices ?? [])
                .map((i) => pending.options[i])
                .filter((n) => typeof n === 'string');
        const ops = [];
        for (const name of names) {
            const product = (name || '').trim();
            if (!product)
                continue;
            ops.push({
                type: 'add',
                product,
                qty: 1,
                price: priceMap.get(product.toLowerCase()) ?? 0,
            });
        }
        return ops;
    }
    /**
     * Clear previousMutation snapshot.
     *
     * G2-D.6: Canonical (workspace_v2) is PRIMARY via clearV1PreviousMutation.
     * The extractedEntities write is backward-compat mirror (atomic CAS).
     */
    async clearPreviousMutation(conversationId) {
        // 1. Canonical: PRIMARY write (authority: workspace_v2)
        try {
            await canonicalConversationStateService.clearV1PreviousMutation(conversationId);
        }
        catch (err) {
            adapters.logger.warn('clearPreviousMutation: failed to write to canonical', {
                conversationId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
        // 2. Backward-compat mirror to extractedEntities (atomic CAS)
        try {
            await conversationContextService.atomicCasExtractedEntities(conversationId, 'clearPreviousMutation', async (row) => {
                const entities = conversationContextService.parseExtractedEntities(row.extractedEntities);
                entities.previousMutation = null;
                const res = await prisma.conversationContext.updateMany({
                    where: { conversationId, updatedAt: row.updatedAt },
                    data: { extractedEntities: entities },
                });
                return { count: res.count, value: null };
            });
        }
        catch (e) {
            adapters.logger.warn('Failed to clear previousMutation (legacy mirror)', { error: e.message });
        }
    }
}
export const conversationService = new ConversationService();
//# sourceMappingURL=conversation.service.js.map